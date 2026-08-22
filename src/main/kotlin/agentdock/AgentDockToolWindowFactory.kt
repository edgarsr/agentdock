package agentdock

import agentdock.bridge.frontend.BridgeScripts
import agentdock.bridge.frontend.FrontendBridge
import agentdock.bridge.frontend.FrontendSettings
import agentdock.utils.jsStringLiteral
import com.intellij.ide.IdeEventQueue
import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.util.net.ProxySettings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter
import java.awt.AWTEvent
import java.awt.BorderLayout
import java.awt.FlowLayout
import java.awt.KeyboardFocusManager
import java.awt.event.KeyEvent
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.JProgressBar
import javax.swing.SwingUtilities


/**
 * Creates the tool window in whichever process owns the UI: the IDE itself, or the JetBrains Client
 * in Remote Development. It only builds the browser and hands it to [FrontendBridge]; the agents,
 * the history and the settings all stay on the side that has the project files.
 */
class AgentDockToolWindowFactory : ToolWindowFactory, DumbAware {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val rootPanel = JPanel(BorderLayout())
        val loadingPanel = JPanel(FlowLayout(FlowLayout.CENTER, 0, 0))
        loadingPanel.isOpaque = false
        val progress = JProgressBar().apply {
            isIndeterminate = true
            isBorderPainted = false
            isStringPainted = false
        }
        loadingPanel.add(progress)
        rootPanel.add(loadingPanel, BorderLayout.CENTER)
        val content = ContentFactory.getInstance().createContent(rootPanel, "", false)
        toolWindow.contentManager.addContent(content)

        // Initialize proxy settings before JCEF starts. JBCefApp startup reads proxy state,
        // and touching the service here keeps proxy migration outside JBCefApp static init.
        ApplicationManager.getApplication().executeOnPooledThread {
            var startupError: Exception? = null
            val supported = try {
                initializeProxySettings()
                JBCefApp.isSupported()
            } catch (e: Exception) {
                startupError = e
                false
            }

            try {
                ApplicationManager.getApplication().invokeLater({
                    if (project.isDisposed || toolWindow.isDisposed) return@invokeLater

                    try {
                        if (startupError != null) {
                            rootPanel.removeAll()
                            rootPanel.add(JLabel("Error initializing proxy settings: ${startupError.message}"), BorderLayout.CENTER)
                            rootPanel.revalidate()
                            rootPanel.repaint()
                            return@invokeLater
                        }

                        if (!supported) {
                            rootPanel.removeAll()
                            rootPanel.add(JLabel("JCEF is not supported in this IDE"), BorderLayout.CENTER)
                            rootPanel.revalidate()
                            rootPanel.repaint()
                            return@invokeLater
                        }

                        val browser = JBCefBrowser()
                        ExternalCodeReferenceDispatcher.register(project, browser)
                        installDirectJcefInput(browser, content)

                        val dropTarget = JcefDragAndDropSupport.install(project, browser)

                        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
                        val bridge = FrontendBridge(project, browser, scope) { loadContent(browser) }
                        bridge.install()

                        browser.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
                            override fun onLoadEnd(cefBrowser: CefBrowser, frame: CefFrame, httpStatusCode: Int) {
                                if (frame.isMain) {
                                    // The invoke function first: everything else is written against it.
                                    cefBrowser.executeJavaScript(bridge.invokeApiScript(), cefBrowser.url, 0)
                                    cefBrowser.executeJavaScript(BridgeScripts.bridgeApi(), cefBrowser.url, 0)
                                    cefBrowser.executeJavaScript(BridgeScripts.cursorTracking(), cefBrowser.url, 0)
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

                        Disposer.register(content, browser)
                        Disposer.register(content, bridge)
                        Disposer.register(content, object : Disposable {
                            override fun dispose() {
                                ExternalCodeReferenceDispatcher.unregister(project, browser)
                                dropTarget.component = null
                                scope.coroutineContext[Job]?.cancel()
                            }
                        })

                        // Swap placeholder with real browser
                        rootPanel.removeAll()
                        rootPanel.add(createBrowserPanel(browser, bridge), BorderLayout.CENTER)
                        rootPanel.revalidate()
                        rootPanel.repaint()

                    } catch (e: Exception) {
                        rootPanel.removeAll()
                        rootPanel.add(JLabel("Error initializing browser: ${e.message}"), BorderLayout.CENTER)
                        rootPanel.revalidate()
                    }
                }, ModalityState.any())
            } catch (e: Exception) {
                ApplicationManager.getApplication().invokeLater({
                    if (project.isDisposed || toolWindow.isDisposed) return@invokeLater
                    rootPanel.removeAll()
                    rootPanel.add(JLabel("Error initializing browser: ${e.message}"), BorderLayout.CENTER)
                    rootPanel.revalidate()
                    rootPanel.repaint()
                }, ModalityState.any())
            }
        }
    }

    private fun initializeProxySettings() {
        ProxySettings.getInstance().getProxyConfiguration()
    }

    private fun installDirectJcefInput(browser: JBCefBrowser, parentDisposable: Disposable) {
        val dispatcher = object : IdeEventQueue.NonLockedEventDispatcher {
            override fun dispatch(e: AWTEvent): Boolean {
                if (e !is KeyEvent || !e.shouldGoDirectlyToJcef()) return false

                val focusOwner = KeyboardFocusManager.getCurrentKeyboardFocusManager().focusOwner
                if (focusOwner == null ||
                    focusOwner !== browser.component &&
                    !SwingUtilities.isDescendingFrom(focusOwner, browser.component)
                ) {
                    return false
                }

                browser.cefBrowser.sendKeyEvent(e)
                return true
            }
        }
        IdeEventQueue.getInstance().addDispatcher(dispatcher, parentDisposable)
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

    private fun createBrowserPanel(browser: JBCefBrowser, bridge: FrontendBridge): JPanel {
        val panel = JPanel(BorderLayout())

        loadContent(browser)

        // Update CSS variables when the IntelliJ theme changes (without reloading the page,
        // which would steal focus and cause the tool window to reopen).
        val connection = ApplicationManager.getApplication().messageBus.connect(browser)
        connection.subscribe(LafManagerListener.TOPIC, LafManagerListener {
            bridge.eval(IdeTheme.generateCssUpdateScript())
            bridge.eval("if(window.__onThemeChanged) window.__onThemeChanged();")
            // File icons are rendered where the agents run, so the invalidation has to travel there.
            val theme = (if (IdeTheme.isDarkTheme()) "dark" else "light").jsStringLiteral()
            bridge.eval("window.__agentDockInvoke && window.__agentDockInvoke('themeChanged', $theme);")
        })

        // The font size and the user message style come from the backend's settings file.
        val settingsListener: (agentdock.settings.GlobalSettings) -> Unit = {
            bridge.eval(IdeTheme.generateCssUpdateScript())
        }
        FrontendSettings.addListener(settingsListener)
        Disposer.register(browser) { FrontendSettings.removeListener(settingsListener) }

        panel.add(browser.component, BorderLayout.CENTER)
        return panel
    }

    private fun loadContent(browser: JBCefBrowser) {
        val html = AssetLoader.loadAndInlineAssets(javaClass)
        browser.loadHTML(html)
    }
}
