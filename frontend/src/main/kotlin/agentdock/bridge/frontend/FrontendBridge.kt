package agentdock.bridge.frontend

import agentdock.IdeTheme
import agentdock.acp.AcpAudioPlayer
import agentdock.acp.ideTerminalBridge
import agentdock.rpc.TerminalCapability
import agentdock.rpc.TerminalLaunchRequest
import agentdock.rpc.UiMessage
import agentdock.ui.AgentDockUiHost
import agentdock.utils.jsCallback
import agentdock.utils.jsStringLiteral
import com.intellij.ide.BrowserUtil
import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** A page that can show the UI: [JcefUi] or [WebUi]. Only one of a project's pages shows it at a time. */
internal interface UiSink {
    /** Runs a script in the page; the page may be gone, in which case it is dropped. */
    fun eval(js: String)

    /** Loads the page again, so its ready handshake reconstructs the state. */
    fun reload()

    /** Another page took the UI: this one shows that and offers to take it back. */
    fun supersede()

    /** Answers the commands that concern this page itself; returns `true` when it did. */
    fun handleLocally(name: String, payload: String): Boolean = false
}

/**
 * The client half of the bridge.
 *
 * All of the plugin's JavaScript enters the IDE here: the page calls
 * `window.__agentDockInvoke(name, payload)`, its [UiSink] passes the call to [dispatch], and this
 * decides whether the client answers the command itself or the backend does. Messages coming the
 * other way are applied to the page showing the UI, the settings cache or the status bar widget.
 */
internal class FrontendBridge(
    private val project: Project,
    private val scope: CoroutineScope,
) : Disposable {

    private val commands = FrontendCommands()
    private val audio = AcpAudioPlayer(scope)
    private val audioInput = AudioInputBridge(commands, ::eval, scope)
    private val audioOutput = AudioOutputBridge(commands, ::eval, scope)
    private val terminal = project.ideTerminalBridge()
    private val connection = BridgeConnection(project, scope, ::apply) { sink?.reload() }
    /** The page showing the UI. */
    @Volatile
    private var sink: UiSink? = null
    /**
     * The page's open chats, drafts and queued prompts, which only the page knows. Kept in memory
     * here, so a reloaded page gets them back while the backend restores the conversations.
     */
    @Volatile
    private var uiWorkspace = ""

    fun install() {
        installLocalCommands()
        audioInput.install()
        audioOutput.install()
        ApplicationManager.getApplication().messageBus.connect(this).subscribe(LafManagerListener.TOPIC, LafManagerListener {
            eval(IdeTheme.generateCssUpdateScript())
            eval(jsCallback("__onThemeChanged"))
            val theme = (if (IdeTheme.isDarkTheme()) "dark" else "light").jsStringLiteral()
            eval(jsCallback("__agentDockInvoke", "'themeChanged'", theme))
        })
        connection.open()
    }

    /** Set by "Open in browser" until a browser page takes the UI. */
    private var browserExpected = false

    /**
     * Makes [next] the page showing the UI, or none; the page that showed it until now is superseded.
     * With [toBrowser], the browser page that connects next gets it.
     */
    fun attach(next: UiSink?, toBrowser: Boolean = false) {
        val previous = synchronized(this) {
            browserExpected = toBrowser
            sink.also { sink = next }
        }
        if (previous != null && previous !== next) previous.supersede()
    }

    /**
     * Lets [next] show the UI unless another page does; returns whether it shows it. A browser page
     * gets it only after "Open in browser", so after an IDE restart the UI stays in the IDE.
     */
    @Synchronized
    fun claim(next: UiSink): Boolean {
        if (sink == null && (next !is WebUi || browserExpected)) {
            sink = next
            browserExpected = false
        }
        return sink === next
    }

    fun isActive(page: UiSink): Boolean = sink === page

    val shownInBrowser: Boolean get() = sink is WebUi

    /** Returns `false` when no page shows the UI. */
    fun eval(js: String): Boolean {
        val sink = sink ?: return false
        sink.eval(js)
        return true
    }

    fun dispatch(from: UiSink, raw: String?) {
        val request = raw?.takeIf { it.isNotBlank() } ?: return
        dispatch(from, runCatching { Json.parseToJsonElement(request) }.getOrNull() ?: return)
    }

    /** Handles a `{n, p}` command sent by the page [from]; only the page showing the UI reaches the rest of the IDE. */
    fun dispatch(from: UiSink, request: JsonElement) {
        val parsed = request as? JsonObject ?: return
        val name = (parsed["n"] as? JsonPrimitive)?.content ?: return
        val payload = (parsed["p"] as? JsonPrimitive)?.content.orEmpty()

        if (from.handleLocally(name, payload) || from !== sink || commands.handleLocally(name, payload)) return
        connection.invokeCommand(name, payload)
    }

    private fun apply(message: UiMessage) {
        when (message.topic) {
            UiMessage.TOPIC_JS -> eval(message.payload)
            UiMessage.TOPIC_FRONTEND_CAPABILITIES -> reportTerminalCapability()
            UiMessage.TOPIC_TERMINAL -> {
                val request = runCatching { Json.decodeFromString<TerminalLaunchRequest>(message.payload) }.getOrNull()
                    ?: return
                val terminal = terminal ?: return
                ApplicationManager.getApplication().invokeLater({ terminal.open(request) }, ModalityState.any())
            }
        }
    }

    private fun reportTerminalCapability() {
        scope.launch(Dispatchers.IO) {
            val capability = TerminalCapability(
                available = terminal != null,
                shellPath = terminal?.resolveShellPath().orEmpty(),
            )
            connection.invokeCommand("terminalCapability", Json.encodeToString(capability))
        }
    }

    private fun installLocalCommands() {
        commands.register("playSound") { sound ->
            when (sound) {
                "responseComplete" -> audio.playResponseCompleteSound()
                "permissionRequest" -> audio.playPermissionRequestSound()
                "backgroundResumed" -> audio.playBackgroundResumedSound()
            }
        }

        commands.register("openUrl", ::openUrl)

        commands.register("saveUiWorkspace") { json -> uiWorkspace = json }
        commands.register("loadUiWorkspace") {
            eval(jsCallback("__onUiWorkspace", uiWorkspace.jsStringLiteral()))
        }

        commands.register("readBrowserAddress") { AgentDockWebServer.getInstance().pushAddress(project) }

        commands.register("setAttentionBadge") { level ->
            ApplicationManager.getApplication().invokeLater({
                if (!project.isDisposed) AgentDockUiHost.getInstance(project).setAttention(level)
            }, ModalityState.any())
        }
    }

    fun openUrl(url: String) {
        if (url.isBlank()) return
        ApplicationManager.getApplication().invokeLater({
            runCatching { BrowserUtil.browse(url) }
        }, ModalityState.any())
    }

    override fun dispose() {
        // The web browser page of a closed project says the IDE is not reachable.
        (sink as? WebUi)?.close()
        sink = null
        audioInput.dispose()
        audioOutput.dispose()
        Disposer.dispose(connection)
    }
}
