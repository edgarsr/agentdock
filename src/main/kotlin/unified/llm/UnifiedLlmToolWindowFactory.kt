package unified.llm

import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.application.ApplicationManager
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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter
import unified.llm.acp.AcpClientService
import unified.llm.acp.AcpBridge
import unified.llm.acp.injectDebugApi
import unified.llm.acp.injectReadySignal
import unified.llm.acp.shutdown
import unified.llm.history.HistoryBridge
import unified.llm.mcp.McpBridge
import unified.llm.promptlibrary.PromptLibraryBridge
import unified.llm.settings.SettingsBridge
import unified.llm.systeminstructions.SystemInstructionsBridge
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import unified.llm.utils.toProjectRelativePath
import java.awt.BorderLayout
import java.awt.Cursor
import java.awt.FlowLayout
import java.awt.datatransfer.DataFlavor
import java.awt.dnd.*
import java.io.File
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.JProgressBar


class UnifiedLlmToolWindowFactory : ToolWindowFactory, DumbAware {
    private var debugBridge: AcpBridge? = null
    private var historyBridge: HistoryBridge? = null
    private var mcpBridge: McpBridge? = null
    private var systemInstructionsBridge: SystemInstructionsBridge? = null
    private var promptLibraryBridge: PromptLibraryBridge? = null
    private var settingsBridge: SettingsBridge? = null

    companion object {
        // --- DEVELOPMENT TOGGLE ---
        // Set to true to load from Vite dev server (http://localhost:5173) instead of built resources.
        // Remember to run 'npm run dev' in the 'frontend' directory.
        private const val IS_DEV_MODE = true
        private const val DEV_URL = "http://localhost:5173"
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

        // Delay browser creation to avoid triggering JBCefApp/ProxyMigrationService during class init (IDE contract)
        // We use a background thread to "warm up" JBCefApp without blocking the UI thread's component lifecycle checks.
        ApplicationManager.getApplication().executeOnPooledThread {
            try {
                val supported = JBCefApp.isSupported()
                if (supported) {
                    try {
                        JBCefApp.getInstance()
                    } catch (e: Exception) {
                    }
                }
                
                ApplicationManager.getApplication().invokeLater({
                    if (project.isDisposed || toolWindow.isDisposed) return@invokeLater
                    
                    try {
                        if (!supported) {
                            rootPanel.removeAll()
                            rootPanel.add(JLabel("JCEF is not supported in this IDE"), BorderLayout.CENTER)
                            rootPanel.revalidate()
                            rootPanel.repaint()
                            return@invokeLater
                        }

                        val browser = JBCefBrowser()
                        ExternalCodeReferenceDispatcher.register(project, browser)

                        val dropTarget = DropTarget(browser.component, object : DropTargetAdapter() {
                            private fun isAcceptable(dtde: DropTargetDragEvent): Boolean =
                                dtde.isDataFlavorSupported(DataFlavor.javaFileListFlavor) ||
                                dtde.isDataFlavorSupported(DataFlavor.stringFlavor)

                            private fun setDragHighlight(on: Boolean) {
                                val js = if (on)
                                    "window.dispatchEvent(new CustomEvent('drag-highlight', { detail: { active: true } }));"
                                else
                                    "window.dispatchEvent(new CustomEvent('drag-highlight', { detail: { active: false } }));"
                                browser.cefBrowser.executeJavaScript(js, browser.cefBrowser.url, 0)
                            }

                            override fun dragEnter(dtde: DropTargetDragEvent) {
                                if (isAcceptable(dtde)) {
                                    dtde.acceptDrag(DnDConstants.ACTION_COPY)
                                    setDragHighlight(true)
                                } else {
                                    dtde.rejectDrag()
                                }
                            }

                            override fun dragOver(dtde: DropTargetDragEvent) {
                                if (isAcceptable(dtde)) dtde.acceptDrag(DnDConstants.ACTION_COPY) else dtde.rejectDrag()
                            }

                            override fun dragExit(dte: DropTargetEvent) {
                                setDragHighlight(false)
                            }

                            private fun handleFileDrop(dtde: DropTargetDropEvent) {
                                dtde.acceptDrop(DnDConstants.ACTION_COPY)
                                try {
                                    @Suppress("UNCHECKED_CAST")
                                    val files = dtde.transferable.getTransferData(DataFlavor.javaFileListFlavor) as List<File>
                                    files.filter { it.isFile }.forEach { file ->
                                        val reference = ExternalCodeReference(
                                            path = toProjectRelativePath(project, file.path),
                                            fileName = file.name
                                        )
                                        ExternalCodeReferenceDispatcher.dispatch(project, reference)
                                    }
                                    dtde.dropComplete(true)
                                } catch (_: Exception) {
                                    dtde.dropComplete(false)
                                }
                            }

                            private fun handleTextDrop(dtde: DropTargetDropEvent) {
                                val editor = FileEditorManager.getInstance(project).selectedTextEditor
                                if (editor == null || !editor.selectionModel.hasSelection()) {
                                    dtde.rejectDrop()
                                    return
                                }
                                val virtualFile = FileDocumentManager.getInstance().getFile(editor.document)
                                if (virtualFile == null) {
                                    dtde.rejectDrop()
                                    return
                                }

                                dtde.acceptDrop(DnDConstants.ACTION_COPY)
                                val startLine = editor.document.getLineNumber(editor.selectionModel.selectionStart) + 1
                                val endLine = editor.document.getLineNumber(editor.selectionModel.selectionEnd) + 1
                                val reference = ExternalCodeReference(
                                    path = toProjectRelativePath(project, virtualFile.path),
                                    fileName = virtualFile.name,
                                    startLine = startLine,
                                    endLine = endLine
                                )
                                ExternalCodeReferenceDispatcher.dispatch(project, reference)
                                dtde.dropComplete(true)
                            }

                            override fun drop(dtde: DropTargetDropEvent) {
                                setDragHighlight(false)
                                when {
                                    dtde.isDataFlavorSupported(DataFlavor.javaFileListFlavor) -> handleFileDrop(dtde)
                                    dtde.isDataFlavorSupported(DataFlavor.stringFlavor) -> handleTextDrop(dtde)
                                    else -> dtde.rejectDrop()
                                }
                            }
                        })

                        val service = AcpClientService.getInstance(project)
                        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
                        
                        debugBridge = AcpBridge(browser, service, scope)
                        historyBridge = HistoryBridge(browser, project, scope)
                        mcpBridge = McpBridge(browser, scope)
                        systemInstructionsBridge = SystemInstructionsBridge(browser, scope)
                        promptLibraryBridge = PromptLibraryBridge(browser, scope)
                        settingsBridge = SettingsBridge(browser, scope)

                        debugBridge?.install()
                        historyBridge?.install()
                        mcpBridge?.install()
                        systemInstructionsBridge?.install()
                        promptLibraryBridge?.install()
                        settingsBridge?.install()


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
                                    // Inject theme CSS if in dev mode (since it's not inlined in index.html)
                                    if (IS_DEV_MODE) {
                                        val themeCss = IdeTheme.generateCssBlock()
                                        val escapedThemeCss = themeCss.replace("`", "\\`").replace("$", "\\$")
                                        val themeInjection = """
                                            (function() {
                                              let style = document.getElementById('ide-theme-style');
                                              if (!style) {
                                                style = document.createElement('style');
                                                style.id = 'ide-theme-style';
                                                document.head.appendChild(style);
                                              }
                                              style.textContent = `$escapedThemeCss`;
                                            })();
                                        """.trimIndent()
                                        cefBrowser.executeJavaScript(themeInjection, cefBrowser.url, 0)
                                    }

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

                                    val repaintInjection = """
                                        window.__requestHostRepaint = function(reason) {
                                          try {
                                            ${repaintQuery.inject("reason || ''")}
                                          } catch (e) {}
                                        };
                                    """.trimIndent()
                                    cefBrowser.executeJavaScript(repaintInjection, cefBrowser.url, 0)
                                    debugBridge?.injectReadySignal(cefBrowser)
                                    debugBridge?.injectDebugApi(cefBrowser)
                                    historyBridge?.injectApi(cefBrowser)
                                    mcpBridge?.injectApi(cefBrowser)
                                    systemInstructionsBridge?.injectApi(cefBrowser)
                                    promptLibraryBridge?.injectApi(cefBrowser)
                                    settingsBridge?.injectApi(cefBrowser)
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
                        rootPanel.add(createBrowserPanel(browser), BorderLayout.CENTER)
                        rootPanel.revalidate()
                        rootPanel.repaint()

                    } catch (e: Exception) {
                        rootPanel.removeAll()
                        rootPanel.add(JLabel("Error initializing browser: ${e.message}"), BorderLayout.CENTER)
                        rootPanel.revalidate()
                    }
                }, com.intellij.openapi.application.ModalityState.any())
            } catch (e: Exception) {
            }
        }
    }

    private fun createBrowserPanel(browser: JBCefBrowser): JPanel {
        val panel = JPanel(BorderLayout())

        loadContent(browser)

        // Reload JCEF when the IntelliJ theme changes (so CSS variables update)
        val connection = ApplicationManager.getApplication().messageBus.connect(browser)
        connection.subscribe(LafManagerListener.TOPIC, LafManagerListener {
            if (IS_DEV_MODE) {
                // In dev mode, we just re-run the injection in the current page
                val themeCss = IdeTheme.generateCssBlock()
                val escapedThemeCss = themeCss.replace("`", "\\`").replace("$", "\\$")
                browser.cefBrowser.executeJavaScript("""
                    (function() {
                        const style = document.getElementById('ide-theme-style');
                        if (style) style.textContent = `$escapedThemeCss`;
                    })();
                """.trimIndent(), browser.cefBrowser.url, 0)
            } else {
                loadContent(browser)
            }
        })

        panel.add(browser.component, BorderLayout.CENTER)
        return panel
    }

    private fun loadContent(browser: JBCefBrowser) {
        if (IS_DEV_MODE) {
            browser.loadURL(DEV_URL)
        } else {
            // Load all content as a single HTML block using helper classes
            val html = AssetLoader.loadAndInlineAssets(javaClass)
            browser.loadHTML(html)
        }
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
