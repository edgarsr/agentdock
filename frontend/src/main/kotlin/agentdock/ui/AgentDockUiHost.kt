package agentdock.ui

import agentdock.AssetLoader
import agentdock.IdeTheme
import agentdock.JcefDragAndDropSupport
import agentdock.bridge.frontend.BridgeScripts
import agentdock.bridge.frontend.FrontendBridge
import agentdock.bridge.frontend.FrontendSettings
import agentdock.bridge.frontend.JcefUi
import agentdock.settings.GlobalSettings
import com.intellij.ide.IdeEventQueue
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
import com.intellij.ui.BadgeIconSupplier
import com.intellij.ui.content.ContentFactory
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.util.net.ProxySettings
import kotlinx.coroutines.CoroutineScope
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLifeSpanHandlerAdapter
import org.cef.handler.CefLoadHandlerAdapter
import org.cef.handler.CefRequestHandlerAdapter
import org.cef.network.CefRequest
import java.awt.AWTEvent
import java.awt.BorderLayout
import java.awt.FlowLayout
import java.awt.KeyboardFocusManager
import java.awt.event.ComponentAdapter
import java.awt.event.ComponentEvent
import java.awt.event.KeyEvent
import java.awt.dnd.DropTarget
import javax.swing.Icon
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
    private val badgeIcons = BadgeIconSupplier(AgentDockFileType.getIcon())
    /** The plugin icon with the open chats' dot, or `null`; the editor tab may read it off the EDT. */
    @Volatile
    var attentionIcon: Icon? = null
        private set
    private var browserStarted = false
    private var browser: JBCefBrowser? = null
    @Volatile
    private var bridge: FrontendBridge? = null
    private var jcefUi: JcefUi? = null
    private var liveContent: JComponent? = loadingPanel
    private var dropTarget: DropTarget? = null
    /** Unknown until the saved settings arrive, so the startup defaults do not move the UI. */
    private var openInEditor: Boolean? = null

    private val settingsListener: (GlobalSettings, GlobalSettings) -> Unit = { previous, settings ->
        ApplicationManager.getApplication().invokeLater({
            if (project.isDisposed) return@invokeLater
            applyOpenInEditor(settings.openInEditor)
            if (previous.uiZoomPercent != settings.uiZoomPercent) {
                applyUiZoom(settings.uiZoomPercent)
            }
            if (previous.userMessageBackgroundStyle != settings.userMessageBackgroundStyle ||
                previous.userMessageCustomColor != settings.userMessageCustomColor
            ) {
                bridge?.eval(IdeTheme.generateCssUpdateScript())
            }
        }, ModalityState.any())
    }

    init {
        FrontendSettings.addListener(settingsListener)
        // The settings may have arrived before this service was created.
        if (FrontendSettings.received) settingsListener(FrontendSettings.current, FrontendSettings.current)
        project.messageBus.connect(this).subscribe(
            ToolWindowManagerListener.TOPIC,
            object : ToolWindowManagerListener {
                override fun toolWindowShown(shown: ToolWindow) {
                    if (shown.id != TOOL_WINDOW_ID || openInEditor != true) return
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
        // The tool window stays empty until the saved settings say the UI belongs there.
        if (openInEditor == false) startBrowser()
    }

    fun show(afterShow: (() -> Unit)? = null) {
        // The web browser showing the UI gets what follows; here only "open elsewhere" would show.
        if (bridge?.shownInBrowser == true) {
            afterShow?.invoke()
            return
        }
        val window = toolWindow
            ?: ToolWindowManager.getInstance(project).getToolWindow(TOOL_WINDOW_ID)
            ?: run {
                afterShow?.invoke()
                return
            }
        if (openInEditor == true) {
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
            if (openInEditor == true) {
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

    /**
     * Mirrors the open chats' dot on the tool window button and the editor tab: `warning` while one waits for a
     * permission, `unread` while one has an unread reply, anything else clears it.
     */
    fun setAttention(level: String) {
        val icon = when (level) {
            "warning" -> badgeIcons.warningIcon
            "unread" -> badgeIcons.infoIcon
            else -> null
        }
        if (icon === attentionIcon) return
        attentionIcon = icon
        // [toolWindow] is bound only once the tool window has been shown, which a UI restored in an editor tab skips.
        (toolWindow ?: ToolWindowManager.getInstance(project).getToolWindow(TOOL_WINDOW_ID))
            ?.setIcon(icon ?: badgeIcons.originalIcon)
        FileEditorManager.getInstance(project).updateFilePresentation(virtualFile)
    }

    fun preferredFocusComponent(): JComponent = browser?.component ?: liveContent ?: homePanel

    private fun applyOpenInEditor(enabled: Boolean) {
        if (enabled == openInEditor) return
        openInEditor = enabled
        val window = toolWindow ?: return
        // Moves only a UI that is showing in the other place; one restored in the right place stays put.
        if (enabled) {
            if (window.isVisible) redirectToEditor(window)
        } else {
            startBrowser()
            if (isEditorTabOpen()) {
                closeEditorTab()
                window.activate(null, true)
            }
        }
    }

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
        moveContentTo(currentSurface())
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

    /** Runs a script in the page showing the UI; returns `false` when there is none yet. */
    internal fun eval(js: String): Boolean = bridge?.eval(js) ?: false

    /** Created by the first page that shows the UI, here or in a web browser. */
    @Synchronized
    internal fun bridge(): FrontendBridge = bridge ?: FrontendBridge(project, scope).also {
        bridge = it
        Disposer.register(this, it)
        it.install()
    }

    /** Shows the UI here again once the web server stops. */
    internal fun returnToIde() {
        val ui = jcefUi
        if (ui != null) ui.takeOver() else bridge?.attach(null)
    }

    private fun createBrowser() {
        try {
            val browser = JBCefBrowser()
            this.browser = browser
            installDirectJcefInput(browser)
            dropTarget = JcefDragAndDropSupport.install(project, browser)

            val bridge = bridge()
            val ui = JcefUi(project, browser, bridge) { loadContent(browser) }
            jcefUi = ui
            ui.install()
            bridge.claim(ui)
            installNavigationGuard(browser, bridge)

            browser.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
                override fun onLoadEnd(cefBrowser: CefBrowser, frame: CefFrame, httpStatusCode: Int) {
                    if (frame.isMain) {
                        cefBrowser.executeJavaScript(ui.invokeApiScript(), cefBrowser.url, 0)
                        val start = if (bridge.isActive(ui)) BridgeScripts.bridgeApi("jcef") else BridgeScripts.ELSEWHERE
                        cefBrowser.executeJavaScript(start, cefBrowser.url, 0)
                        cefBrowser.executeJavaScript(BridgeScripts.cursorTracking(), cefBrowser.url, 0)
                        ApplicationManager.getApplication().invokeLater({
                            applyUiZoom(FrontendSettings.current.uiZoomPercent)
                        }, ModalityState.any())
                    }
                }
            }, browser.cefBrowser)

            browser.component.addKeyListener(object : java.awt.event.KeyAdapter() {
                override fun keyPressed(e: KeyEvent) {
                    if (e.keyCode == KeyEvent.VK_F12) {
                        browser.openDevtools()
                    }
                }
            })

            Disposer.register(this, browser)
            Disposer.register(browser, ui)
            showStatus(browser.component)
            loadWhenSized(browser)
        } catch (e: Exception) {
            showStatus(JLabel("Error initializing browser: ${e.message}"))
        }
    }

    /**
     * Keeps the plugin page in the browser: any other page loaded there would receive the bridge, so navigations
     * and popups are cancelled and web links go to the system browser instead.
     */
    private fun installNavigationGuard(browser: JBCefBrowser, bridge: FrontendBridge) {
        val leave = { url: String? ->
            if (url != null && (url.startsWith("https://") || url.startsWith("http://"))) bridge.openUrl(url)
            true
        }
        browser.jbCefClient.addRequestHandler(object : CefRequestHandlerAdapter() {
            override fun onBeforeBrowse(
                cefBrowser: CefBrowser, frame: CefFrame, request: CefRequest, userGesture: Boolean, isRedirect: Boolean,
            ): Boolean = !request.url.startsWith(LOAD_HTML_URL_PREFIX) && leave(request.url)
        }, browser.cefBrowser)
        browser.jbCefClient.addLifeSpanHandler(object : CefLifeSpanHandlerAdapter() {
            override fun onBeforePopup(
                cefBrowser: CefBrowser, frame: CefFrame, targetUrl: String?, targetFrameName: String?,
            ): Boolean = leave(targetUrl)
        }, browser.cefBrowser)
    }

    /** Loads the page only once the browser has its size in its surface, so the UI never starts at a size it does not have. */
    private fun loadWhenSized(browser: JBCefBrowser) {
        val component = browser.component
        if (component.width > 0) return loadContent(browser)
        component.addComponentListener(object : ComponentAdapter() {
            override fun componentResized(e: ComponentEvent) {
                if (component.width == 0) return
                component.removeComponentListener(this)
                loadContent(browser)
            }
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
        browser.zoomLevel = target
    }

    private fun applyZoomShortcut(keyCode: Int) {
        val browser = browser ?: return
        if (browser.isDisposed) return
        val current = kotlin.math.round(browser.zoomLevel * 100.0).toInt().coerceIn(25, 500)
        val next = nextUiZoomPercent(current, keyCode)
        applyUiZoom(next)
        jcefUi?.pushUiZoom(next)
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
        dropTarget?.component = null
    }

    companion object {
        const val TOOL_WINDOW_ID = "Agent Dock"

        /** The URL `JBCefBrowser.loadHTML` gives the page it loads (`JBCefFileSchemeHandlerFactory`). */
        private const val LOAD_HTML_URL_PREFIX = "file:///jbcefbrowser/"

        fun getInstance(project: Project): AgentDockUiHost =
            project.getService(AgentDockUiHost::class.java)
    }
}

private fun KeyEvent.shouldGoDirectlyToJcef(): Boolean {
    if (id != KeyEvent.KEY_TYPED && id != KeyEvent.KEY_PRESSED && id != KeyEvent.KEY_RELEASED) {
        return false
    }
    if (isAltGraphDown) return keyChar != KeyEvent.CHAR_UNDEFINED
    if (isPluginShortcut()) return true
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

// Ctrl/Cmd plus a letter set in the shortcut settings, or a digit when those are on; F3 and Shift+F3 move between
// the chat search matches.
private fun KeyEvent.isPluginShortcut(): Boolean {
    if (isAltDown) return false
    if (keyCode == KeyEvent.VK_F3) return !isControlDown && !isMetaDown
    if (isShiftDown || isControlDown == isMetaDown) return false
    val shortcuts = FrontendSettings.current.shortcuts
    return when (keyCode) {
        in KeyEvent.VK_A..KeyEvent.VK_Z -> keyCode.toChar().toString() in shortcuts.letters
        in KeyEvent.VK_1..KeyEvent.VK_9 -> shortcuts.tabNumbers
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
