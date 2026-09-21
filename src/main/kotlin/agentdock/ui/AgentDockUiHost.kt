@file:Suppress("UnstableApiUsage")

package agentdock.ui

import agentdock.AssetLoader
import agentdock.ExternalCodeReferenceDispatcher
import agentdock.IdeTheme
import agentdock.JcefDragAndDropSupport
import agentdock.bridge.frontend.BridgeScripts
import agentdock.bridge.frontend.FrontendBridge
import agentdock.bridge.frontend.FrontendSettings
import agentdock.settings.GlobalSettings
import agentdock.utils.jsStringLiteral
import com.intellij.ide.IdeEventQueue
import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.components.Service
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.openapi.wm.ex.ToolWindowManagerListener
import com.intellij.ui.content.ContentFactory
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.util.net.ProxySettings
import kotlinx.coroutines.CoroutineScope
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter
import java.awt.AWTEvent
import java.awt.BorderLayout
import java.awt.FlowLayout
import java.awt.KeyboardFocusManager
import java.awt.event.KeyEvent
import java.awt.dnd.DropTarget
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.JProgressBar
import javax.swing.SwingUtilities

/**
 * Owns the single JCEF browser for a project and places it either in the tool window or in one
 * editor tab. Closing the editor tab hides the UI without disposing the browser, matching a hidden
 * tool window.
 */
@Service(Service.Level.PROJECT)
class AgentDockUiHost(
    private val project: Project,
    private val scope: CoroutineScope,
) : Disposable {

    private val homePanel = JPanel(BorderLayout())
    private val loadingPanel = JPanel(FlowLayout(FlowLayout.CENTER, 0, 0)).apply {
        isOpaque = false
        add(JProgressBar().apply {
            isIndeterminate = true
            isBorderPainted = false
            isStringPainted = false
        })
    }
    private val virtualFile = AgentDockVirtualFile()
    private val editorSurfaces = LinkedHashSet<JPanel>()

    private var toolWindow: ToolWindow? = null
    private var browserStarted = false
    private var browser: JBCefBrowser? = null
    private var bridge: FrontendBridge? = null
    private var liveContent: JComponent? = loadingPanel
    private var dropTarget: DropTarget? = null
    private var openInEditor = FrontendSettings.current.openInEditor

    private val settingsListener: (GlobalSettings) -> Unit = { settings ->
        ApplicationManager.getApplication().invokeLater({
            if (project.isDisposed) return@invokeLater
            applyOpenInEditor(settings.openInEditor)
            applyUiZoom(settings.uiZoomPercent)
            bridge?.eval(IdeTheme.generateCssUpdateScript())
        }, ModalityState.any())
    }

    init {
        homePanel.add(loadingPanel, BorderLayout.CENTER)
        FrontendSettings.addListener(settingsListener)
        project.messageBus.connect(this).subscribe(
            ToolWindowManagerListener.TOPIC,
            object : ToolWindowManagerListener {
                override fun toolWindowShown(shown: ToolWindow) {
                    if (shown.id != TOOL_WINDOW_ID || !openInEditor) return
                    if (isEditorTabOpen()) {
                        shown.hide(null)
                        closeEditorTab()
                        return
                    }
                    redirectToEditor(shown)
                }
            },
        )
    }

    fun bindToolWindow(toolWindow: ToolWindow) {
        if (this.toolWindow != null) return
        this.toolWindow = toolWindow
        val content = ContentFactory.getInstance().createContent(homePanel, "", false)
        toolWindow.contentManager.addContent(content)
        startBrowser()
    }

    fun show(afterShow: (() -> Unit)? = null) {
        val window = toolWindow
            ?: ToolWindowManager.getInstance(project).getToolWindow(TOOL_WINDOW_ID)
            ?: run {
                afterShow?.invoke()
                return
            }
        if (openInEditor && toolWindow != null) {
            redirectToEditor(window, afterShow)
            return
        }
        window.activate(afterShow, true)
    }

    /**
     * Opens the editor tab after the current UI event. Doing it synchronously from
     * [ToolWindowManagerListener.toolWindowShown] during layout restoration created the tab while
     * the editor splitters were still being restored, so the tab was dropped or left unfocused and
     * the plugin appeared not to open on the first start.
     */
    private fun redirectToEditor(window: ToolWindow, afterShow: (() -> Unit)? = null) {
        ApplicationManager.getApplication().invokeLater({
            if (project.isDisposed) return@invokeLater
            if (openInEditor) {
                window.hide(null)
                openEditorTab()
            }
            afterShow?.invoke()
        }, ModalityState.nonModal(), project.disposed)
    }

    fun attachEditor(panel: JPanel) {
        editorSurfaces.add(panel)
        startBrowser()
        moveContentTo(panel)
    }

    fun detachEditor(panel: JPanel) {
        editorSurfaces.remove(panel)
        if (project.isDisposed) return
        if (liveContent?.parent === panel) {
            moveContentTo(editorSurfaces.lastOrNull() ?: homePanel)
        }
    }

    fun preferredFocusComponent(): JComponent = browser?.component ?: liveContent ?: homePanel

    private fun applyOpenInEditor(enabled: Boolean) {
        if (enabled == openInEditor) return
        val showing = isShowing()
        openInEditor = enabled
        val window = toolWindow
        if (window == null || !showing) return
        if (enabled) {
            redirectToEditor(window)
        } else {
            closeEditorTab()
            window.activate(null, true)
        }
    }

    private fun isShowing(): Boolean = isEditorTabOpen() || toolWindow?.isVisible == true

    private fun isEditorTabOpen(): Boolean =
        FileEditorManager.getInstance(project).isFileOpen(virtualFile)

    private fun openEditorTab() {
        FileEditorManager.getInstance(project).openFile(virtualFile, true)
    }

    private fun closeEditorTab() {
        if (isEditorTabOpen()) {
            FileEditorManager.getInstance(project).closeFile(virtualFile)
        }
    }

    private fun currentSurface(): JPanel = editorSurfaces.lastOrNull() ?: homePanel

    private fun moveContentTo(target: JPanel) {
        val content = liveContent ?: return
        val parent = content.parent
        if (parent === target) {
            target.revalidate()
            target.repaint()
            return
        }
        parent?.remove(content)
        target.removeAll()
        target.add(content, BorderLayout.CENTER)
        parent?.revalidate()
        parent?.repaint()
        target.revalidate()
        target.repaint()
    }

    private fun showStatus(component: JComponent) {
        liveContent = component
        moveContentTo(currentSurface())
    }

    private fun startBrowser() {
        if (browserStarted) return
        browserStarted = true
        ApplicationManager.getApplication().executeOnPooledThread {
            var startupError: Exception? = null
            val supported = try {
                ProxySettings.getInstance().getProxyConfiguration()
                JBCefApp.isSupported()
            } catch (e: Exception) {
                startupError = e
                false
            }

            ApplicationManager.getApplication().invokeLater({
                if (project.isDisposed) return@invokeLater
                when {
                    startupError != null -> showStatus(
                        JLabel("Error initializing proxy settings: ${startupError.message}"),
                    )
                    !supported -> showStatus(JLabel("JCEF is not supported in this IDE"))
                    else -> createBrowser()
                }
            }, ModalityState.any())
        }
    }

    private fun createBrowser() {
        try {
            val browser = JBCefBrowser()
            this.browser = browser
            ExternalCodeReferenceDispatcher.register(project, browser)
            installDirectJcefInput(browser)
            dropTarget = JcefDragAndDropSupport.install(project, browser)

            val bridge = FrontendBridge(project, browser, scope) { loadContent(browser) }
            this.bridge = bridge
            bridge.install()

            browser.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
                override fun onLoadEnd(cefBrowser: CefBrowser, frame: CefFrame, httpStatusCode: Int) {
                    if (frame.isMain) {
                        cefBrowser.executeJavaScript(bridge.invokeApiScript(), cefBrowser.url, 0)
                        cefBrowser.executeJavaScript(BridgeScripts.bridgeApi(), cefBrowser.url, 0)
                        cefBrowser.executeJavaScript(BridgeScripts.cursorTracking(), cefBrowser.url, 0)
                        ApplicationManager.getApplication().invokeLater({
                            applyUiZoom(FrontendSettings.current.uiZoomPercent)
                        }, ModalityState.any())
                    }
                }
            }, browser.cefBrowser)

            browser.component.addKeyListener(object : java.awt.event.KeyAdapter() {
                override fun keyPressed(e: java.awt.event.KeyEvent) {
                    if (e.keyCode == java.awt.event.KeyEvent.VK_F12) {
                        browser.openDevtools()
                    }
                }
            })

            Disposer.register(this, browser)
            Disposer.register(this, bridge)
            installBrowserChrome(browser, bridge)
            showStatus(browser.component)
        } catch (e: Exception) {
            showStatus(JLabel("Error initializing browser: ${e.message}"))
        }
    }

    private fun installBrowserChrome(browser: JBCefBrowser, bridge: FrontendBridge) {
        loadContent(browser)

        val connection = ApplicationManager.getApplication().messageBus.connect(browser)
        connection.subscribe(LafManagerListener.TOPIC, LafManagerListener {
            bridge.eval(IdeTheme.generateCssUpdateScript())
            bridge.eval("if(window.__onThemeChanged) window.__onThemeChanged();")
            val theme = (if (IdeTheme.isDarkTheme()) "dark" else "light").jsStringLiteral()
            bridge.eval("window.__agentDockInvoke && window.__agentDockInvoke('themeChanged', $theme);")
        })
    }

    private fun loadContent(browser: JBCefBrowser) {
        browser.loadHTML(AssetLoader.loadAndInlineAssets(javaClass))
    }

    private fun applyUiZoom(percent: Int) {
        val browser = browser ?: return
        if (browser.isDisposed) return
        val target = percent.coerceIn(25, 500) / 100.0
        if (kotlin.math.abs(browser.zoomLevel - target) < 0.005) return
        browser.setZoomLevel(target)
    }

    private fun applyZoomShortcut(keyCode: Int) {
        val browser = browser ?: return
        if (browser.isDisposed) return
        val current = kotlin.math.round(browser.zoomLevel * 100.0).toInt().coerceIn(25, 500)
        val next = nextUiZoomPercent(current, keyCode)
        applyUiZoom(next)
        bridge?.eval("window.dispatchEvent(new CustomEvent('agent-dock-ui-zoom',{detail:$next}));")
    }

    private fun installDirectJcefInput(browser: JBCefBrowser) {
        val dispatcher = object : IdeEventQueue.NonLockedEventDispatcher {
            override fun dispatch(e: AWTEvent): Boolean {
                if (e !is KeyEvent) return false

                val focusOwner = KeyboardFocusManager.getCurrentKeyboardFocusManager().focusOwner
                if (focusOwner == null ||
                    focusOwner !== browser.component &&
                    !SwingUtilities.isDescendingFrom(focusOwner, browser.component)
                ) {
                    return false
                }

                if (e.isControlDown && !e.isAltDown && !e.isMetaDown && e.isZoomShortcut()) {
                    if (e.id == KeyEvent.KEY_PRESSED) {
                        applyZoomShortcut(e.keyCode)
                    }
                    return e.id == KeyEvent.KEY_PRESSED ||
                        e.id == KeyEvent.KEY_RELEASED ||
                        e.id == KeyEvent.KEY_TYPED
                }

                if (!e.shouldGoDirectlyToJcef()) return false
                browser.cefBrowser.sendKeyEvent(e)
                return true
            }
        }
        IdeEventQueue.getInstance().addDispatcher(dispatcher, this)
    }

    override fun dispose() {
        FrontendSettings.removeListener(settingsListener)
        browser?.let { ExternalCodeReferenceDispatcher.unregister(project, it) }
        dropTarget?.component = null
    }

    companion object {
        const val TOOL_WINDOW_ID = "Agent Dock"

        fun getInstance(project: Project): AgentDockUiHost =
            project.getService(AgentDockUiHost::class.java)
    }
}

private fun KeyEvent.shouldGoDirectlyToJcef(): Boolean {
    if (id != KeyEvent.KEY_TYPED && id != KeyEvent.KEY_PRESSED && id != KeyEvent.KEY_RELEASED) {
        return false
    }
    if (isAltGraphDown) return keyChar != KeyEvent.CHAR_UNDEFINED
    if (isAltDown || isMetaDown) return false
    if (isControlDown) return isTextControlShortcut()

    val isBrowserCharacter = when (keyChar) {
        KeyEvent.CHAR_UNDEFINED -> false
        '\b', '\t', '\n', '\r', '\u001B' -> true
        else -> !Character.isISOControl(keyChar)
    }
    return isBrowserCharacter || when (keyCode) {
        KeyEvent.VK_BACK_SPACE,
        KeyEvent.VK_DELETE,
        KeyEvent.VK_LEFT,
        KeyEvent.VK_RIGHT,
        KeyEvent.VK_UP,
        KeyEvent.VK_DOWN,
        KeyEvent.VK_HOME,
        KeyEvent.VK_END,
        KeyEvent.VK_PAGE_UP,
        KeyEvent.VK_PAGE_DOWN,
        KeyEvent.VK_ENTER,
        KeyEvent.VK_TAB,
        KeyEvent.VK_ESCAPE,
        KeyEvent.VK_INSERT -> true
        else -> false
    }
}

private fun KeyEvent.isTextControlShortcut(): Boolean {
    if (isShiftDown) {
        return when (keyCode) {
            KeyEvent.VK_Z,
            KeyEvent.VK_LEFT,
            KeyEvent.VK_RIGHT,
            KeyEvent.VK_HOME,
            KeyEvent.VK_END -> true
            else -> false
        }
    }

    return when (keyCode) {
        KeyEvent.VK_A,
        KeyEvent.VK_C,
        KeyEvent.VK_X,
        KeyEvent.VK_V,
        KeyEvent.VK_Z,
        KeyEvent.VK_Y,
        KeyEvent.VK_INSERT,
        KeyEvent.VK_BACK_SPACE,
        KeyEvent.VK_DELETE,
        KeyEvent.VK_LEFT,
        KeyEvent.VK_RIGHT,
        KeyEvent.VK_HOME,
        KeyEvent.VK_END -> true
        else -> false
    }
}

private fun KeyEvent.isZoomShortcut(): Boolean = when (keyCode) {
    KeyEvent.VK_EQUALS,
    KeyEvent.VK_PLUS,
    KeyEvent.VK_ADD,
    KeyEvent.VK_MINUS,
    KeyEvent.VK_SUBTRACT,
    KeyEvent.VK_0,
    KeyEvent.VK_NUMPAD0 -> true
    else -> false
}

private val UI_ZOOM_PRESETS = intArrayOf(50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300)

private fun nextUiZoomPercent(current: Int, keyCode: Int): Int = when (keyCode) {
    KeyEvent.VK_0, KeyEvent.VK_NUMPAD0 -> 100
    KeyEvent.VK_MINUS, KeyEvent.VK_SUBTRACT ->
        UI_ZOOM_PRESETS.lastOrNull { it < current } ?: UI_ZOOM_PRESETS.first()
    else ->
        UI_ZOOM_PRESETS.firstOrNull { it > current } ?: UI_ZOOM_PRESETS.last()
}
