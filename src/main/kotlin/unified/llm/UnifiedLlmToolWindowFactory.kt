package unified.llm

import com.intellij.icons.AllIcons
import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.openapi.diagnostic.Logger
import com.intellij.ui.content.ContentFactory
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefJSQuery
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter
import unified.llm.acp.AcpClientService
import unified.llm.acp.AcpDebugBridge
import unified.llm.history.HistoryBridge
import java.awt.BorderLayout
import java.awt.Cursor
import javax.swing.JLabel
import javax.swing.JPanel


class UnifiedLlmToolWindowFactory : ToolWindowFactory, DumbAware {
    private val log = Logger.getInstance(UnifiedLlmToolWindowFactory::class.java)
    private var debugBridge: AcpDebugBridge? = null
    private var historyBridge: HistoryBridge? = null

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val rootPanel = JPanel(BorderLayout())
        rootPanel.add(JLabel("Initializing AI Chat..."), BorderLayout.CENTER)
        val content = ContentFactory.getInstance().createContent(rootPanel, "", false)
        toolWindow.contentManager.addContent(content)

        ApplicationManager.getApplication().invokeLater {
            if (project.isDisposed || toolWindow.isDisposed) return@invokeLater
            
            try {
                if (!JBCefApp.isSupported()) {
                    rootPanel.removeAll()
                    rootPanel.add(JLabel("JCEF is not supported in this IDE"), BorderLayout.CENTER)
                    rootPanel.revalidate()
                    rootPanel.repaint()
                    return@invokeLater
                }

                val browser = JBCefBrowser()
                val service = AcpClientService(project)
                val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
                
                // Persist bridges as members to prevent garbage collection
                // Note: In some versions, these might need to be stored in the content's user data
                debugBridge = AcpDebugBridge(browser, service, scope)
                historyBridge = HistoryBridge(browser, project, scope)
                
                debugBridge?.install()
                historyBridge?.install()

                // Create Header Actions
                val newChatAction = object : AnAction("AI Chat", "Open AI chat", AllIcons.General.Balloon) {
                    override fun actionPerformed(e: AnActionEvent) {
                        browser.cefBrowser.executeJavaScript("if(window.setView) window.setView('chat')", browser.cefBrowser.url, 0)
                    }
                }
                val agentManagementAction = object : AnAction("ACP Agents", "Manage ACP agents", AllIcons.Nodes.Plugin) {
                    override fun actionPerformed(e: AnActionEvent) {
                        browser.cefBrowser.executeJavaScript("if(window.setView) window.setView('management')", browser.cefBrowser.url, 0)
                    }
                }
                val designSystemAction = object : AnAction("Design System", "View design system demo", AllIcons.Actions.Colors) {
                    override fun actionPerformed(e: AnActionEvent) {
                        browser.cefBrowser.executeJavaScript("if(window.setView) window.setView('demo')", browser.cefBrowser.url, 0)
                    }
                }

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

                browser.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
                    override fun onLoadEnd(cefBrowser: CefBrowser, frame: CefFrame, httpStatusCode: Int) {
                        if (frame.isMain) {
                            val cursorInjection = """
                                window.__lastSentCursor = 'default';
                                document.addEventListener('mousemove', function(e) {
                                  const cursor = window.getComputedStyle(e.target).cursor;
                                  if (window.__lastSentCursor !== cursor) {
                                    window.__lastSentCursor = cursor;
                                    ${cursorQuery.inject("cursor")}
                                  }
                                });
                            """.trimIndent()
                            cefBrowser.executeJavaScript(cursorInjection, cefBrowser.url, 0)
                            debugBridge?.injectReadySignal(cefBrowser)
                            debugBridge?.injectDebugApi(cefBrowser)
                            historyBridge?.injectApi(cefBrowser)
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

                val actionGroup = DefaultActionGroup().apply {
                    add(newChatAction)
                    add(agentManagementAction)
                    add(designSystemAction)
                }
                content.setActions(actionGroup, ActionPlaces.TOOLWINDOW_TITLE, null)
                toolWindow.setTitleActions(listOf(newChatAction, agentManagementAction, designSystemAction))

                // Swap placeholder with real browser
                rootPanel.removeAll()
                rootPanel.add(createBrowserPanel(browser), BorderLayout.CENTER)
                rootPanel.revalidate()
                rootPanel.repaint()

            } catch (e: Exception) {
                log.error("Failed to initialize JCEF browser", e)
                rootPanel.removeAll()
                rootPanel.add(JLabel("Error initializing browser: ${e.message}"), BorderLayout.CENTER)
                rootPanel.revalidate()
            }
        }
    }

    private fun createBrowserPanel(browser: JBCefBrowser): JPanel {
        val panel = JPanel(BorderLayout())

        loadContent(browser)

        // Reload JCEF when the IntelliJ theme changes (so CSS variables update)
        val connection = ApplicationManager.getApplication().messageBus.connect(browser)
        connection.subscribe(LafManagerListener.TOPIC, LafManagerListener {
            loadContent(browser)
        })

        panel.add(browser.component, BorderLayout.CENTER)
        return panel
    }

    private fun loadContent(browser: JBCefBrowser) {
        // Load all content as a single HTML block using helper classes
        val html = AssetLoader.loadAndInlineAssets(javaClass)
        browser.loadHTML(html)
    }
}
