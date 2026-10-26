package agentdock.bridge.frontend

import agentdock.AssetLoader
import agentdock.settings.GlobalSettings
import agentdock.ui.AgentDockUiHost
import agentdock.utils.jsStringLiteral
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.util.text.StringUtil
import com.intellij.util.ConcurrencyUtil
import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.URI
import java.net.URLDecoder
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.zip.GZIPOutputStream

/**
 * Serves the UI to a web browser: the page, its events and its commands, for every open project.
 *
 * Runs while "Browser Access" is on in the settings, which also give the port and the access key,
 * so a browser can open the UI before the IDE does. It listens on 127.0.0.1
 * only. A page address brings the access key in `?k=` once; after that every request has to carry
 * it in a cookie, which other web pages in the browser cannot send along. Wrong codes are limited
 * to [MAX_FAILURES] an hour: guessing a 4-character code of letters, digits, `-` and `_` then takes
 * about 96 years on average, one of digits only about 3 weeks.
 */
@Service(Service.Level.APP)
internal class AgentDockWebServer : Disposable {

    private var server: HttpServer? = null
    /** The port and code settings [server] was started with. */
    private var startedWith: Pair<Int, String?>? = null
    /** Each open event stream holds one of its threads. */
    private var executor: ExecutorService? = null
    /** Keyed by project and page ID. */
    private val pages = ConcurrentHashMap<String, WebUi>()

    /** Wrong codes given since [windowStart]; past [MAX_FAILURES] no code is accepted until the hour ends. */
    private val attempts = Any()
    private var failures = 0
    private var windowStart = 0L

    private val settingsListener: (GlobalSettings, GlobalSettings) -> Unit = { _, _ -> update() }

    init {
        FrontendSettings.addListener(settingsListener)
    }

    /** Runs the server while "Browser Access" is on in the settings; a new port or code restarts it. */
    @Synchronized
    fun update() {
        if (!FrontendSettings.received) return
        val settings = FrontendSettings.current
        if (!settings.browserAccessEnabled || startedWith != settings.browserAccessPort to settings.browserAccessCode) stop()
        if (settings.browserAccessEnabled) start()
    }

    /** Starts the server if needed and returns the address of [project]'s page, or `null` when it cannot start. */
    @Synchronized
    fun open(project: Project): String? = start()?.let { address(it, project) }

    /** Tells [project]'s page the address of its page here, or an empty one while the server does not run. */
    fun pushAddress(project: Project) {
        val address = server?.let { address(it, project) }.orEmpty()
        AgentDockUiHost.getInstance(project)
            .eval("window.dispatchEvent(new CustomEvent('agent-dock-browser-address',{detail:${address.jsStringLiteral()}}));")
    }

    private fun address(server: HttpServer, project: Project): String {
        val code = FrontendSettings.current.browserAccessCode.orEmpty()
        return "http://localhost:${server.address.port}${pagePath(project)}?k=$code"
    }

    private fun start(): HttpServer? {
        server?.let { return it }
        if (!FrontendSettings.received) return null
        val settings = FrontendSettings.current
        // A port in use gives way to one of the next ones, and those to any free one.
        val port = settings.browserAccessPort
        val created = ((port until minOf(port + PORT_COUNT, 65536)) + 0).firstNotNullOfOrNull {
            try {
                HttpServer.create(InetSocketAddress(InetAddress.getLoopbackAddress(), it), 0)
            } catch (_: IOException) {
                null
            }
        } ?: return null
        val executor = Executors.newCachedThreadPool(ConcurrencyUtil.newNamedThreadFactory("Agent Dock web server", true, Thread.NORM_PRIORITY))
        created.createContext("/") { exchange ->
            try {
                handle(exchange)
            } catch (_: Exception) {
                // A malformed request, such as a bad `%` in the address, gets an answer instead of a dropped connection.
                if (exchange.responseCode == -1) runCatching { respond(exchange, 400) }
            } finally {
                exchange.close()
            }
        }
        created.executor = executor
        created.start()
        this.server = created
        this.executor = executor
        startedWith = settings.browserAccessPort to settings.browserAccessCode
        ProjectManager.getInstance().openProjects.forEach(::pushAddress)
        return created
    }

    /** Ends the open pages' streams, so the pages say the IDE is not reachable, and shows their UI in the IDE again. */
    private fun stop() {
        val server = server ?: return
        server.stop(0)
        executor?.shutdownNow()
        this.server = null
        executor = null
        startedWith = null
        // Turning "Browser Access" off and on, or a new code, lifts a limit the user reached.
        synchronized(attempts) { failures = 0 }
        ProjectManager.getInstance().openProjects.forEach(::pushAddress)
        val projectHashes = pages.keys.map { it.substringBefore('/') }.toSet()
        pages.clear()
        ApplicationManager.getApplication().invokeLater {
            ProjectManager.getInstance().openProjects.filter { it.locationHash in projectHashes }.forEach {
                val host = AgentDockUiHost.getInstance(it)
                if (host.bridge().shownInBrowser) host.returnToIde()
            }
        }
    }

    private fun handle(exchange: HttpExchange) {
        exchange.responseHeaders.set("Referrer-Policy", "no-referrer")
        exchange.responseHeaders.set("Cache-Control", "no-store")
        // Another web page could otherwise take the UI over unseen in a frame.
        exchange.responseHeaders.set("Content-Security-Policy", "frame-ancestors 'none'")
        val query = exchange.requestURI.rawQuery.orEmpty().split('&').associate {
            val (name, value) = (it.split('=', limit = 2) + "").take(2)
            name to URLDecoder.decode(value, Charsets.UTF_8)
        }
        val path = exchange.requestURI.path
        val match = PAGE_PATH.matchEntire(path)
        val isPage = path == "/" || match?.groupValues?.get(2) == ""
        // Other web pages may link to the pages but not send the requests that control the UI.
        val site = exchange.requestHeaders.getFirst("Sec-Fetch-Site")
        if (!isPage && (site == "cross-site" || site == "same-site")) return respond(exchange, 403)
        val code = FrontendSettings.current.browserAccessCode?.takeIf { it.isNotEmpty() } ?: return respond(exchange, 403)
        // Ports tell apart the cookies of several IDEs, which the browser sends to every port of the host.
        val cookieName = "agentDock${exchange.localAddress.port}"
        val cookies = exchange.requestHeaders["Cookie"].orEmpty().flatMap { it.split(';') }
            .associate { it.trim().substringBefore('=') to it.trim().substringAfter('=') }
        val viaAddress = isPage && accepts(query["k"], code)
        if (!viaAddress && !accepts(cookies[cookieName], code)) {
            return if (attemptsExhausted()) respond(exchange, 429, TOO_MANY_FAILURES) else respond(exchange, 403)
        }
        // A page keeps the code in a cookie for 400 days from its last load, and its address loses the code.
        if (isPage) exchange.responseHeaders.set("Set-Cookie", "$cookieName=$code; Path=/; Max-Age=34560000; HttpOnly; SameSite=Lax")
        if (viaAddress) {
            exchange.responseHeaders.set("Location", exchange.requestURI.rawPath)
            return respond(exchange, 303)
        }

        if (path == "/") return respond(exchange, 200, projectList(), HTML)
        val (name, action) = match?.destructured ?: return respond(exchange, 404)
        val project = ProjectManager.getInstance().openProjects.firstOrNull { pathName(it) == name || hashedPathName(it) == name }
            ?: return respond(exchange, 404)
        if (action.isEmpty()) return respond(exchange, 200, page(), HTML)

        val bridge = AgentDockUiHost.getInstance(project).bridge()
        val key = "${project.locationHash}/${query["c"] ?: return respond(exchange, 400)}"
        when (action) {
            "events" -> {
                val page = pages.computeIfAbsent(key) { WebUi() }
                exchange.responseHeaders.set("Content-Type", "text/event-stream")
                exchange.sendResponseHeaders(200, 0)
                if (bridge.claim(page)) {
                    page.stream(exchange.responseBody)
                } else {
                    WebUi.write(exchange.responseBody, WebUi.frame("elsewhere", ""))
                }
                if (!bridge.isActive(page)) pages.remove(key, page)
            }
            "commands" -> {
                val page = pages[key] ?: return respond(exchange, 409)
                val body = exchange.requestBody.readBytes().toString(Charsets.UTF_8)
                Json.parseToJsonElement(body).jsonArray.forEach { bridge.dispatch(page, it) }
                respond(exchange, 204)
            }
            "takeover" -> {
                bridge.attach(pages.computeIfAbsent(key) { WebUi() })
                respond(exchange, 204)
            }
            else -> respond(exchange, 404)
        }
    }

    /** The inlined script contains `</body>` too, so the bridge goes before the last one. */
    private fun page(): String {
        val html = AssetLoader.loadAndInlineAssets(javaClass)
        val end = html.lastIndexOf("</body>")
        val bridge = "<script>window.addEventListener('load', function() {\n${BridgeScripts.browserBridge()}\n});</script>"
        return if (end < 0) html else html.substring(0, end) + bridge + html.substring(end)
    }

    /** A missing code is not counted: a page that has the cookie loads without `?k=`. */
    private fun accepts(given: String?, code: String): Boolean {
        if (given.isNullOrEmpty()) return false
        synchronized(attempts) {
            if (attemptsExhausted()) return false
            if (isCode(given, code)) return true
            val now = System.currentTimeMillis()
            if (now - windowStart >= ATTEMPT_WINDOW_MS) {
                windowStart = now
                failures = 0
            }
            failures++
            return false
        }
    }

    private fun attemptsExhausted(): Boolean = synchronized(attempts) {
        failures >= MAX_FAILURES && System.currentTimeMillis() - windowStart < ATTEMPT_WINDOW_MS
    }

    private fun isCode(given: String, code: String): Boolean = MessageDigest.isEqual(given.toByteArray(), code.toByteArray())

    /**
     * The project's name; the ones opened after another project of the same name add their location hash,
     * so opening or closing a project does not change the addresses of the others.
     */
    private fun pathName(project: Project): String =
        if (ProjectManager.getInstance().openProjects.first { it.name == project.name } === project) project.name
        else hashedPathName(project)

    /** Reaches the project also once it has become the first of its name. */
    private fun hashedPathName(project: Project): String = "${project.name}-${project.locationHash}"

    private fun pagePath(project: Project): String = URI(null, null, "/${pathName(project)}/", null).toASCIIString()

    private fun projectList(): String {
        val links = ProjectManager.getInstance().openProjects.joinToString("") {
            "<li><a href=\"${pagePath(it).substring(1)}\">${StringUtil.escapeXmlEntities(it.name)}</a></li>"
        }
        return "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Agent Dock</title></head><body><ul>$links</ul></body></html>"
    }

    private fun respond(exchange: HttpExchange, status: Int, body: String = "", type: String = "text/plain; charset=utf-8") {
        var bytes = body.toByteArray(Charsets.UTF_8)
        if (bytes.isEmpty()) {
            exchange.sendResponseHeaders(status, -1)
            return
        }
        // The page inlines all of its assets, which a phone loads again after every reconnect.
        if (exchange.requestHeaders.getFirst("Accept-Encoding").orEmpty().contains("gzip")) {
            bytes = ByteArrayOutputStream().also { out -> GZIPOutputStream(out).use { it.write(bytes) } }.toByteArray()
            exchange.responseHeaders.set("Content-Encoding", "gzip")
        }
        exchange.responseHeaders.set("Content-Type", type)
        exchange.sendResponseHeaders(status, bytes.size.toLong())
        exchange.responseBody.write(bytes)
    }

    override fun dispose() {
        FrontendSettings.removeListener(settingsListener)
        server?.stop(0)
        executor?.shutdownNow()
    }

    companion object {
        private const val PORT_COUNT = 20
        /** Above what typos and the pages left open with an old code usually cause; the 429 page says how to lift it. */
        private const val MAX_FAILURES = 10
        private const val ATTEMPT_WINDOW_MS = 60 * 60 * 1000L
        private const val TOO_MANY_FAILURES =
            "Too many wrong access codes. Try again within an hour, or turn Browser Access off and on in the Agent Dock settings."
        private const val HTML = "text/html; charset=utf-8"
        private val PAGE_PATH = Regex("/(.+)/(\\w*)")

        fun getInstance(): AgentDockWebServer = ApplicationManager.getApplication().getService(AgentDockWebServer::class.java)
    }
}
