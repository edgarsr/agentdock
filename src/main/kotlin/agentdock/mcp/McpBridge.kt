package agentdock.mcp

import com.intellij.openapi.application.ApplicationManager
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefJSQuery
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.cef.browser.CefBrowser
import agentdock.utils.escapeForJsString

private val json = Json { ignoreUnknownKeys = true }

class McpBridge(
    private val browser: JBCefBrowser,
    private val scope: CoroutineScope
) {
    private var loadQuery: JBCefJSQuery? = null
    private var saveQuery: JBCefJSQuery? = null
    private var checkStatusQuery: JBCefJSQuery? = null
    private val statusJobMutex = Mutex()
    private var statusJob: Job? = null
    private var nextStatusRunId = 0L

    fun install() {
        loadQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler {
                scope.launch(Dispatchers.IO) {
                    push(McpConfigStore.load())
                }
                JBCefJSQuery.Response("ok")
            }
        }

        saveQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { payload ->
                if (!payload.isNullOrBlank()) {
                    scope.launch(Dispatchers.IO) {
                        val servers = runCatching {
                            json.decodeFromString<List<McpServerConfig>>(payload)
                        }.getOrNull()
                        if (servers != null) {
                            McpConfigStore.save(servers)
                            push(servers)
                        }
                    }
                }
                JBCefJSQuery.Response("ok")
            }
        }

        checkStatusQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler {
                requestStatusCheck()
                JBCefJSQuery.Response("ok")
            }
        }
    }

    fun injectApi(cefBrowser: CefBrowser) {
        val loadInject = loadQuery?.inject("") ?: "console.error('[McpBridge] Load query not ready')"
        val saveInject = saveQuery?.inject("json") ?: "console.error('[McpBridge] Save query not ready')"
        val checkStatusInject = checkStatusQuery?.inject("") ?: "console.error('[McpBridge] Status query not ready')"

        val script = """
            (function() {
                window.__onMcpServers = window.__onMcpServers || function(servers) {};
                window.__onMcpStatus = window.__onMcpStatus || function(update) {};
                window.__loadMcpServers = function() {
                    try { $loadInject } catch(e) { console.error('[McpBridge] Load error', e); }
                };
                window.__saveMcpServers = function(json) {
                    if (!json) return;
                    try { $saveInject } catch(e) { console.error('[McpBridge] Save error', e); }
                };
                window.__checkMcpStatus = function() {
                    try { $checkStatusInject } catch(e) { console.error('[McpBridge] Status check error', e); }
                };
            })();
        """.trimIndent()
        cefBrowser.executeJavaScript(script, cefBrowser.url, 0)
    }

    private fun requestStatusCheck(serversSnapshot: List<McpServerConfig>? = null) {
        scope.launch(Dispatchers.IO) {
            statusJobMutex.withLock {
                val servers = serversSnapshot ?: McpConfigStore.load()
                val runId = nextStatusRunId++
                pushInitialStatus(servers, runId)
                statusJob?.cancelAndJoin()
                statusJob = scope.launch(Dispatchers.IO) {
                    runStatusCheck(servers, runId)
                }
            }
        }
    }

    private suspend fun runStatusCheck(servers: List<McpServerConfig>, runId: Long) {
        if (servers.isEmpty()) return

        // Probe each server sequentially so we never spawn many processes / sockets at once.
        servers.forEach { server ->
            val result = McpStatusChecker.check(server).copy(runId = runId)
            pushStatus(result)
        }
    }

    private fun pushInitialStatus(servers: List<McpServerConfig>, runId: Long) {
        // Announce a loading state for enabled servers and disabled for the rest, so the UI can
        // show the yellow indicator immediately before each probe completes.
        servers.forEach { server ->
            val initial = if (server.enabled) {
                McpStatusUpdate(server.id, McpStatus.LOADING, "Checking…", runId)
            } else {
                McpStatusUpdate(server.id, McpStatus.DISABLED, "Disabled", runId)
            }
            pushStatus(initial)
        }
    }

    private fun push(servers: List<McpServerConfig>) {
        val escaped = Json.encodeToString(ListSerializer(McpServerConfig.serializer()), servers).escapeForJsString()
        ApplicationManager.getApplication().invokeLater {
            browser.cefBrowser.executeJavaScript(
                "if(window.__onMcpServers) window.__onMcpServers(JSON.parse('$escaped'));",
                browser.cefBrowser.url, 0
            )
        }
    }

    private fun pushStatus(update: McpStatusUpdate) {
        val escaped = json.encodeToString(update).escapeForJsString()
        ApplicationManager.getApplication().invokeLater {
            browser.cefBrowser.executeJavaScript(
                "if(window.__onMcpStatus) window.__onMcpStatus(JSON.parse('$escaped'));",
                browser.cefBrowser.url, 0
            )
        }
    }
}
