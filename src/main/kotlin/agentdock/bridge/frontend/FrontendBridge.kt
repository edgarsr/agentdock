package agentdock.bridge.frontend

import agentdock.acp.AcpAudioPlayer
import agentdock.acp.ideTerminalBridge
import agentdock.rpc.TerminalCapability
import agentdock.rpc.TerminalLaunchRequest
import agentdock.rpc.UiMessage
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.awt.Cursor

/**
 * The client half of the bridge.
 *
 * All of the plugin's JavaScript enters the IDE through the single query created here: the page
 * calls `window.__agentDockInvoke(name, payload)`, this decides whether the client answers the
 * command itself or the backend does, and messages coming the other way are applied to the browser,
 * the settings cache or the status bar widget.
 */
internal class FrontendBridge(
    private val project: Project,
    private val browser: JBCefBrowser,
    private val scope: CoroutineScope,
    private val reloadUi: () -> Unit,
) : Disposable {

    private val commands = FrontendCommands()
    private val query = JBCefJSQuery.create(browser as JBCefBrowserBase)
    private val audio = AcpAudioPlayer(scope)
    private val terminal = project.ideTerminalBridge()
    private val connection = BridgeConnection(project, scope, ::apply) {
        ApplicationManager.getApplication().invokeLater({
            if (!browser.isDisposed) reloadUi()
        }, ModalityState.any())
    }

    fun install() {
        installLocalCommands()
        AudioInputBridge(commands, ::eval, scope).install()

        query.addHandler { raw ->
            dispatch(raw)
            JBCefJSQuery.Response("ok")
        }

        connection.open()
    }

    /** Injected before [BridgeScripts.bridgeApi], which is written against this function. */
    fun invokeApiScript(): String = """
        window.__agentDockInvoke = function(name, payload) {
            try { ${query.inject("JSON.stringify({ n: name, p: payload })")} } catch (e) { }
        };
    """.trimIndent()

    fun eval(js: String) {
        if (browser.isDisposed) return
        ApplicationManager.getApplication().invokeLater({
            if (!browser.isDisposed) {
                browser.cefBrowser.executeJavaScript(js, browser.cefBrowser.url ?: "", 0)
            }
        }, ModalityState.any())
    }

    private fun dispatch(raw: String?) {
        val request = raw?.takeIf { it.isNotBlank() } ?: return
        val parsed = runCatching { Json.parseToJsonElement(request).jsonObject }.getOrNull() ?: return
        val name = parsed["n"]?.jsonPrimitive?.content ?: return
        val payload = parsed["p"]?.jsonPrimitive?.content.orEmpty()

        if (commands.handleLocally(name, payload)) return
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
        commands.register("cursor") { cursorType ->
            ApplicationManager.getApplication().invokeLater({
                if (!browser.isDisposed) {
                    browser.component.cursor = Cursor.getPredefinedCursor(awtCursor(cursorType))
                }
            }, ModalityState.any())
        }

        commands.register("repaint") {
            ApplicationManager.getApplication().invokeLater({ forceBrowserRepaint() }, ModalityState.any())
        }

        commands.register("playSound") { sound ->
            when (sound) {
                "responseComplete" -> audio.playResponseCompleteSound()
                "permissionRequest" -> audio.playPermissionRequestSound()
            }
        }

        commands.register("openUrl", ::openUrl)
    }

    private fun openUrl(url: String) {
        if (url.isBlank()) return
        ApplicationManager.getApplication().invokeLater({
            runCatching { BrowserUtil.browse(url) }
        }, ModalityState.any())
    }

    private fun forceBrowserRepaint() {
        val component = browser.component
        component.invalidate()
        component.revalidate()
        component.repaint()

        component.parent?.let { parent ->
            parent.invalidate()
            parent.revalidate()
            parent.repaint()
        }
    }

    private fun awtCursor(cursorType: String): Int = when (cursorType) {
        "pointer", "grab", "grabbing" -> Cursor.HAND_CURSOR
        "text" -> Cursor.TEXT_CURSOR
        "move", "all-scroll" -> Cursor.MOVE_CURSOR
        "wait", "progress" -> Cursor.WAIT_CURSOR
        "crosshair" -> Cursor.CROSSHAIR_CURSOR
        "n-resize", "ns-resize", "row-resize" -> Cursor.N_RESIZE_CURSOR
        "s-resize" -> Cursor.S_RESIZE_CURSOR
        "e-resize", "ew-resize", "col-resize" -> Cursor.E_RESIZE_CURSOR
        "w-resize" -> Cursor.W_RESIZE_CURSOR
        "ne-resize", "nesw-resize" -> Cursor.NE_RESIZE_CURSOR
        "nw-resize", "nwse-resize" -> Cursor.NW_RESIZE_CURSOR
        "se-resize" -> Cursor.SE_RESIZE_CURSOR
        "sw-resize" -> Cursor.SW_RESIZE_CURSOR
        else -> Cursor.DEFAULT_CURSOR
    }

    override fun dispose() {
        Disposer.dispose(connection)
        Disposer.dispose(query)
    }
}
