package unified.llm.history

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefJSQuery
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.cef.browser.CefBrowser
import unified.llm.utils.escapeForJsString

private val permissiveJson = Json {
    ignoreUnknownKeys = true
    isLenient = true
}

class HistoryBridge(
    private val browser: JBCefBrowser,
    private val project: Project,
    private val scope: CoroutineScope
) {
    private var listHistoryQuery: JBCefJSQuery? = null
    private var deleteHistoryQuery: JBCefJSQuery? = null

    fun install() {
        val defaultProjectPath = project.basePath ?: System.getProperty("user.dir")

        listHistoryQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { payload ->
                val projectPath = payload?.trim()?.takeUnless { it.isEmpty() || it == "undefined" } ?: defaultProjectPath
                scope.launch(Dispatchers.Default) {
                    try {
                        val history = UnifiedHistoryService.getHistoryList(projectPath)
                        pushHistoryList(permissiveJson.encodeToString(history))
                    } catch (e: Exception) {
                        sendJsError("Failed to list history: ${e.message}")
                    }
                }
                JBCefJSQuery.Response("ok")
            }
        }

        deleteHistoryQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { payload ->
                if (payload.isNullOrBlank()) return@addHandler JBCefJSQuery.Response(null, -1, "Empty payload")

                scope.launch(Dispatchers.Default) {
                    try {
                        val meta = permissiveJson.decodeFromString<SessionMeta>(payload)
                        val success = UnifiedHistoryService.deleteSession(meta)

                        if (success) {
                            val history = UnifiedHistoryService.getHistoryList(meta.projectPath)
                            pushHistoryList(permissiveJson.encodeToString(history))
                        } else {
                            sendJsError("Failed to delete session ${meta.sessionId}")
                        }
                    } catch (e: Exception) {
                        sendJsError("Error during deletion: ${e.message}")
                    }
                }
                JBCefJSQuery.Response("ok")
            }
        }
    }

    fun injectApi(cefBrowser: CefBrowser) {
        val listInject = listHistoryQuery?.inject("projectPath") ?: "console.error('[HistoryBridge] List query not ready')"
        val deleteInject = deleteHistoryQuery?.inject("JSON.stringify(meta)") ?: "console.error('[HistoryBridge] Delete query not ready')"

        val script = """
            (function() {
                window.__onHistoryList = window.__onHistoryList || function(list) {};

                window.__requestHistoryList = function(projectPath) {
                    try { $listInject } catch(e) { console.error('[HistoryBridge] Request error', e); }
                };

                window.__deleteHistorySession = function(meta) {
                    if (!meta) return;
                    console.log('[HistoryBridge] Triggering delete for:', meta.sessionId);
                    try {
                        $deleteInject
                    } catch(e) {
                        console.error('[HistoryBridge] Critical error during delete:', e);
                    }
                };
            })();
        """.trimIndent()
        cefBrowser.executeJavaScript(script, cefBrowser.url, 0)
    }

    private fun pushHistoryList(jsonArray: String) {
        val escaped = jsonArray.escapeForJsString()
        runOnEdt {
            browser.cefBrowser.executeJavaScript(
                "if(window.__onHistoryList) window.__onHistoryList(JSON.parse('$escaped'));",
                browser.cefBrowser.url, 0
            )
        }
    }

    private fun sendJsError(msg: String) {
        runOnEdt {
            browser.cefBrowser.executeJavaScript("console.error('[HistoryBridge] ' + '${msg.escapeForJsString()}');", browser.cefBrowser.url, 0)
        }
    }

    private fun runOnEdt(action: () -> Unit) = ApplicationManager.getApplication().invokeLater(action)
}
