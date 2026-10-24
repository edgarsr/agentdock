package agentdock.bridge.frontend

import com.intellij.ide.BrowserUtil
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.util.Disposer
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery
import java.awt.Cursor
import java.awt.event.HierarchyEvent
import java.awt.event.HierarchyListener

/**
 * The UI shown in the IDE's own JCEF browser.
 *
 * Its commands enter through one query. Those touching the Swing component the browser lives in
 * (the cursor, the repaint, zoom and visibility) and moving the UI between here and a web browser
 * are answered here; the rest go to [bridge].
 */
internal class JcefUi(
    private val project: Project,
    private val browser: JBCefBrowser,
    private val bridge: FrontendBridge,
    private val load: () -> Unit,
) : UiSink, Disposable {

    private val commands = FrontendCommands()
    private val query = JBCefJSQuery.create(browser as JBCefBrowserBase)
    /** Hiding the tool window or switching away from the editor tab hides the browser component. */
    private val visibilityListener = HierarchyListener { event ->
        if ((event.changeFlags and HierarchyEvent.SHOWING_CHANGED.toLong()) != 0L) pushUiVisibility()
    }

    fun install() {
        installLocalCommands()
        browser.component.addHierarchyListener(visibilityListener)
        query.addHandler { raw ->
            bridge.dispatch(this, raw)
            JBCefJSQuery.Response("ok")
        }
    }

    /** Injected before [BridgeScripts.bridgeApi], which is written against this function. */
    fun invokeApiScript(): String = """
        window.__agentDockInvoke = function(name, payload) {
            try { ${query.inject("JSON.stringify({ n: name, p: payload })")} } catch (e) { }
        };
        window.__takeOverUi = function() { window.__agentDockInvoke('takeOverUi', ''); };
        window.__reloadUi = function() { window.__agentDockInvoke('reloadUi', ''); };
        window.__openInBrowser = function() { window.__agentDockInvoke('openInBrowser', ''); };
    """.trimIndent()

    /** Shows the UI here again; the page reloads and restores it. */
    fun takeOver() {
        bridge.attach(this)
        reload()
    }

    override fun supersede() = eval(BridgeScripts.ELSEWHERE)

    override fun eval(js: String) {
        if (browser.isDisposed) return
        ApplicationManager.getApplication().invokeLater({
            if (!browser.isDisposed) {
                browser.cefBrowser.executeJavaScript(js, browser.cefBrowser.url ?: "", 0)
            }
        }, ModalityState.any())
    }

    override fun reload() {
        ApplicationManager.getApplication().invokeLater({
            if (!browser.isDisposed) load()
        }, ModalityState.any())
    }

    override fun handleLocally(name: String, payload: String): Boolean = commands.handleLocally(name, payload)

    fun pushUiZoom(percent: Int) {
        eval("window.dispatchEvent(new CustomEvent('agent-dock-ui-zoom',{detail:$percent}));")
    }

    private fun installLocalCommands() {
        commands.register("cursor") { cursorType ->
            ApplicationManager.getApplication().invokeLater({
                if (!browser.isDisposed) {
                    browser.cefBrowser.uiComponent.cursor = Cursor.getPredefinedCursor(awtCursor(cursorType))
                }
            }, ModalityState.any())
        }

        commands.register("reloadUi") { reload() }

        commands.register("repaint") {
            ApplicationManager.getApplication().invokeLater({ forceBrowserRepaint() }, ModalityState.any())
        }

        commands.register("readUiZoom") {
            ApplicationManager.getApplication().invokeLater({
                if (!browser.isDisposed) {
                    pushUiZoom(kotlin.math.round(browser.zoomLevel * 100.0).toInt().coerceIn(25, 500))
                }
            }, ModalityState.any())
        }
        commands.register("readUiVisibility") {
            ApplicationManager.getApplication().invokeLater({ pushUiVisibility() }, ModalityState.any())
        }

        commands.register("takeOverUi") { takeOver() }
        commands.register("openInBrowser") {
            if (!FrontendSettings.current.browserAccessEnabled) return@register
            val url = AgentDockWebServer.getInstance().open(project)
            ApplicationManager.getApplication().invokeLater({
                if (url == null) {
                    Messages.showErrorDialog(project, "The web server could not be started.", "Agent Dock")
                } else {
                    bridge.attach(null, toBrowser = true)
                    BrowserUtil.browse(url)
                }
            }, ModalityState.any())
        }
    }

    private fun pushUiVisibility() {
        if (browser.isDisposed) return
        eval("window.dispatchEvent(new CustomEvent('agent-dock-ui-visibility',{detail:${browser.component.isShowing}}));")
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
        "pointer", "grab", "grabbing", "zoom-in" -> Cursor.HAND_CURSOR
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
        browser.component.removeHierarchyListener(visibilityListener)
        Disposer.dispose(query)
    }
}
