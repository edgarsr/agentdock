package agentdock

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
import com.intellij.ui.jcef.JBCefJSQuery
import com.intellij.util.net.ProxySettings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter
import agentdock.acp.AcpClientService
import agentdock.acp.AcpBridge
import agentdock.acp.pushAdapters
import agentdock.acp.injectDebugApi
import agentdock.acp.injectReadySignal
import agentdock.acp.shutdown
import agentdock.history.HistoryBridge
import agentdock.mcp.McpBridge
import agentdock.promptlibrary.PromptLibraryBridge
import agentdock.settings.SettingsBridge
import agentdock.systeminstructions.SystemInstructionsBridge
import java.awt.BorderLayout
import java.awt.Cursor
import java.awt.FlowLayout
import java.awt.KeyEventDispatcher
import java.awt.KeyboardFocusManager
import java.awt.event.KeyEvent
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.JProgressBar
import javax.swing.SwingUtilities


class AgentDockToolWindowFactory : ToolWindowFactory, DumbAware {
    companion object {
        private val IS_DEV_MODE = BuildConfig.IS_DEV
    }

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

                        val dropTarget = JcefDragAndDropSupport.install(project, browser)

                        val service = AcpClientService.getInstance(project)
                        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
                        
                        val acpBridge = AcpBridge(browser, service, scope)
                        val historyBridge = HistoryBridge(browser, project, scope)
                        val mcpBridge = McpBridge(browser, scope)
                        val systemInstructionsBridge = SystemInstructionsBridge(browser, scope)
                        val promptLibraryBridge = PromptLibraryBridge(browser, scope)
                        val settingsBridge = SettingsBridge(browser, scope)

                        acpBridge.install()
                        historyBridge.install()
                        mcpBridge.install()
                        systemInstructionsBridge.install()
                        promptLibraryBridge.install()
                        settingsBridge.install()


                        // Solve JCEF cursor: pointer not working issue on Windows
                        val cursorQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase)
                        cursorQuery.addHandler { cursorType ->
                            ApplicationManager.getApplication().invokeLater {
                                val component = browser.component
                                val awtCursor = when (cursorType) {
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
                                component.cursor = Cursor.getPredefinedCursor(awtCursor)
                            }
                            JBCefJSQuery.Response("ok")
                        }

                        val repaintQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase)
                        repaintQuery.addHandler {
                            ApplicationManager.getApplication().invokeLater({
                                forceBrowserRepaint(browser)
                            }, com.intellij.openapi.application.ModalityState.any())
                            JBCefJSQuery.Response("ok")
                        }

                        browser.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
                            override fun onLoadEnd(cefBrowser: CefBrowser, frame: CefFrame, httpStatusCode: Int) {
                                if (frame.isMain) {
                                    val cursorInjection = """
                                        window.__lastSentCursor = 'default';
                                        window.__cursorThrottleTimer = null;
                                        document.addEventListener('mousemove', function(e) {
                                          if (window.__cursorThrottleTimer !== null) return;
                                          window.__cursorThrottleTimer = setTimeout(function() {
                                            window.__cursorThrottleTimer = null;
                                            const cursor = window.getComputedStyle(e.target).cursor;
                                            if (window.__lastSentCursor !== cursor) {
                                              window.__lastSentCursor = cursor;
                                              ${cursorQuery.inject("cursor")}
                                            }
                                          }, 50);
                                        });
                                    """.trimIndent()
                                    cefBrowser.executeJavaScript(cursorInjection, cefBrowser.url, 0)

                                    val repaintInjection = """
                                        window.__requestHostRepaint = function(reason) {
                                          try {
                                            ${repaintQuery.inject("reason || ''")}
                                          } catch (e) {}
                                        };
                                    """.trimIndent()
                                    cefBrowser.executeJavaScript(repaintInjection, cefBrowser.url, 0)
                                    acpBridge.injectReadySignal(cefBrowser)
                                    acpBridge.injectDebugApi(cefBrowser)
                                    historyBridge.injectApi(cefBrowser)
                                    mcpBridge.injectApi(cefBrowser)
                                    systemInstructionsBridge.injectApi(cefBrowser)
                                    promptLibraryBridge.injectApi(cefBrowser)
                                    settingsBridge.injectApi(cefBrowser)
                                }
                            }
                        }, browser.cefBrowser)

                        var devtoolsDispatcher: KeyEventDispatcher? = null
                        if (IS_DEV_MODE) {
                            devtoolsDispatcher = KeyEventDispatcher { event ->
                                if (event.id == KeyEvent.KEY_PRESSED && event.keyCode == KeyEvent.VK_F12) {
                                    val focusOwner = KeyboardFocusManager.getCurrentKeyboardFocusManager().focusOwner
                                    if (focusOwner == browser.component || SwingUtilities.isDescendingFrom(focusOwner, browser.component)) {
                                        browser.openDevtools()
                                        true
                                    } else {
                                        false
                                    }
                                } else {
                                    false
                                }
                            }
                            KeyboardFocusManager.getCurrentKeyboardFocusManager().addKeyEventDispatcher(devtoolsDispatcher)
                        }

                        Disposer.register(content, browser)
                        Disposer.register(content, object : Disposable {
                            override fun dispose() {
                                devtoolsDispatcher?.let {
                                    KeyboardFocusManager.getCurrentKeyboardFocusManager().removeKeyEventDispatcher(it)
                                }
                                ExternalCodeReferenceDispatcher.unregister(project, browser)
                                dropTarget.component = null
                            }
                        })
                        Disposer.register(content, object : Disposable {
                            override fun dispose() {
                                scope.coroutineContext[Job]?.cancel()
                            }
                        })
                        Disposer.register(content, object : Disposable {
                            override fun dispose() {
                                service.shutdown()
                            }
                        })


                        // Swap placeholder with real browser
                        rootPanel.removeAll()
                        rootPanel.add(createBrowserPanel(browser, acpBridge), BorderLayout.CENTER)
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

    private fun createBrowserPanel(browser: JBCefBrowser, acpBridge: AcpBridge): JPanel {
        val panel = JPanel(BorderLayout())

        loadContent(browser)

        // Update CSS variables when the IntelliJ theme changes (without reloading the page,
        // which would steal focus and cause the tool window to reopen).
        val connection = ApplicationManager.getApplication().messageBus.connect(browser)
        connection.subscribe(LafManagerListener.TOPIC, LafManagerListener {
            val script = IdeTheme.generateCssUpdateScript()
            ApplicationManager.getApplication().invokeLater({
                browser.cefBrowser.executeJavaScript(script, browser.cefBrowser.url ?: "", 0)
            }, ModalityState.any())
            acpBridge.pushAdapters()
        })

        panel.add(browser.component, BorderLayout.CENTER)
        return panel
    }

    private fun loadContent(browser: JBCefBrowser) {
        val html = AssetLoader.loadAndInlineAssets(javaClass)
        browser.loadHTML(html)
    }

    private fun forceBrowserRepaint(browser: JBCefBrowser) {
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
}
