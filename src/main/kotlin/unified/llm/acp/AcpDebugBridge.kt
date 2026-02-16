package unified.llm.acp

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefJSQuery
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import org.cef.browser.CefBrowser

private val log = Logger.getInstance(AcpDebugBridge::class.java)

/**
 * Connects AcpClientService to the JCEF/React debug view.
 * Handles: startAgent, sendPrompt (from frontend); pushes log entries, agent text, status (to frontend).
 */
class AcpDebugBridge(
    private val browser: JBCefBrowser,
    private val service: AcpClientService,
    private val scope: CoroutineScope
) {
    private var sendPromptQuery: JBCefJSQuery? = null
    private var startAgentQuery: JBCefJSQuery? = null
    private var readyQuery: JBCefJSQuery? = null

    companion object {
        const val START_AGENT_TIMEOUT_MS = 45_000L
    }

    fun install() {
        service.setOnLogEntry { pushLogEntry(it) }

        readyQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler {
                runOnEdt { injectDebugApi(browser.cefBrowser) }
                JBCefJSQuery.Response("ok")
            }
        }

        startAgentQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler {
                scope.launch(Dispatchers.Default) {
                    pushStatus("initializing")
                    try {
                        withTimeout(START_AGENT_TIMEOUT_MS) {
                            service.startAgent()
                        }
                        pushStatus(service.status().name.lowercase())
                        pushSessionId(service.sessionId())
                    } catch (e: Exception) {
                        log.error("[AcpDebugBridge] Start agent failed", e)
                        pushStatus("error")
                        pushAgentText("[Error: ${e.message ?: e.toString()}]")
                    }
                }
                JBCefJSQuery.Response("ok")
            }
        }

        sendPromptQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { text ->
                val message = text?.takeIf { it.isNotBlank() } ?: ""
                scope.launch(Dispatchers.Default) {
                    pushStatus("prompting")
                    try {
                        service.prompt(message).collect { event ->
                            when (event) {
                                is AcpEvent.AgentText -> pushAgentText(event.text)
                                is AcpEvent.PromptDone -> pushStatus("ready")
                                is AcpEvent.Error -> {
                                    log.warn("[AcpDebugBridge] Prompt error: ${event.message}")
                                    pushAgentText("[Error: ${event.message}]")
                                }
                            }
                        }
                    } catch (e: Exception) {
                        log.error("[AcpDebugBridge] Send prompt failed", e)
                        pushAgentText("[Error: ${e.message ?: e.toString()}]")
                        pushStatus(service.status().name.lowercase())
                    }
                }
                JBCefJSQuery.Response("ok")
            }
        }
    }

    /**
     * First call (from onLoadEnd): inject no-op callbacks and __notifyReady so React can signal when it has set its callbacks.
     * Second call (from ready handler): inject real __startAgent and __sendPrompt so they work after React is mounted.
     */
    fun injectDebugApi(cefBrowser: CefBrowser) {
        val startAgentInject = decorateQueryInject(
            startAgentQuery?.inject("") ?: "",
            "startAgent"
        )
        val sendPromptInject = decorateQueryInject(
            sendPromptQuery?.inject("message") ?: "",
            "sendPrompt"
        )
        val script = """
            (function() {
                window.__onAcpLog = window.__onAcpLog || function(payload) {};
                window.__onAgentText = window.__onAgentText || function(text) {};
                window.__onStatus = window.__onStatus || function(status) {};
                window.__onSessionId = window.__onSessionId || function(id) {};
                window.__startAgent = function() {
                    try {
                        if (window.__onStatus) window.__onStatus('initializing');
                        $startAgentInject
                    } catch (e) {
                        console.error('[UnifiedLLM] Start Agent bridge error', e);
                        if (window.__onStatus) window.__onStatus('error');
                        if (window.__onAgentText) window.__onAgentText('[Bridge error: ' + e.message + ']');
                    }
                };
                window.__sendPrompt = function(message) {
                    try {
                        if (window.__onStatus) window.__onStatus('prompting');
                        $sendPromptInject
                    } catch (e) {
                        console.error('[UnifiedLLM] Send Prompt bridge error', e);
                        if (window.__onStatus) window.__onStatus('error');
                        if (window.__onAgentText) window.__onAgentText('[Bridge error: ' + e.message + ']');
                    }
                };
            })();
        """.trimIndent()
        cefBrowser.executeJavaScript(script, cefBrowser.url, 0)
    }

    /** Call from onLoadEnd: inject only notifyReady so React can call it when mounted; then we re-inject the real API. */
    fun injectReadySignal(cefBrowser: CefBrowser) {
        val readyInject = readyQuery?.inject("") ?: ""
        val script = """
            window.__onAcpLog = window.__onAcpLog || function(payload) {};
            window.__onAgentText = window.__onAgentText || function(text) {};
            window.__onStatus = window.__onStatus || function(status) {};
            window.__onSessionId = window.__onSessionId || function(id) {};
            window.__notifyReady = function() {
                try { $readyInject } catch (e) { console.error('[UnifiedLLM] notifyReady error', e); }
            };
        """.trimIndent()
        cefBrowser.executeJavaScript(script, cefBrowser.url, 0)
    }

    fun pushLogEntry(entry: AcpLogEntry) {
        val payload = """{"direction":"${entry.direction}","json":${escapeJsonString(entry.json)},"timestamp":${entry.timestampMillis}}"""
        val escaped = payload.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "\\r")
        val directionLabel = if (entry.direction == AcpLogEntry.Direction.SENT) "SENT" else "RECEIVED"
        val jsonEscaped = entry.json.replace("\\", "\\\\").replace("`", "\\`").replace("$", "\\$")
        runOnEdt {
            // Log JSON to console for Chromium Developer Tools
            browser.cefBrowser.executeJavaScript(
                """
                (function() {
                    try {
                        const jsonStr = `${jsonEscaped}`;
                        const jsonObj = JSON.parse(jsonStr);
                        console.log('[ACP $directionLabel]', jsonObj);
                    } catch(e) {
                        console.log('[ACP $directionLabel]', `${jsonEscaped}`);
                    }
                })();
                """.trimIndent(),
                browser.cefBrowser.url,
                0
            )
            // Also call the callback for React component
            browser.cefBrowser.executeJavaScript(
                "if(window.__onAcpLog) window.__onAcpLog(JSON.parse('$escaped'));",
                browser.cefBrowser.url,
                0
            )
        }
    }

    fun pushAgentText(text: String) {
        val escaped = text.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "\\r")
        runOnEdt {
            browser.cefBrowser.executeJavaScript(
                "if(window.__onAgentText) window.__onAgentText('$escaped');",
                browser.cefBrowser.url,
                0
            )
        }
    }

    fun pushStatus(status: String) {
        val escaped = status.replace("\\", "\\\\").replace("'", "\\'")
        runOnEdt {
            browser.cefBrowser.executeJavaScript(
                "if(window.__onStatus) window.__onStatus('$escaped');",
                browser.cefBrowser.url,
                0
            )
        }
    }

    fun pushSessionId(id: String?) {
        val value = id ?: ""
        val escaped = value.replace("\\", "\\\\").replace("'", "\\'")
        runOnEdt {
            browser.cefBrowser.executeJavaScript(
                "if(window.__onSessionId) window.__onSessionId('$escaped');",
                browser.cefBrowser.url,
                0
            )
        }
    }

    private fun runOnEdt(action: () -> Unit) {
        ApplicationManager.getApplication().invokeLater(action)
    }

    /**
     * JBCefJSQuery.inject() generates onSuccess/onFailure stubs that swallow failures.
     * Replace no-op failure handler so bridge/query failures are visible in UI + DevTools.
     */
    private fun decorateQueryInject(injectCode: String, actionName: String): String {
        val failureHandler = """
            onFailure: function(error_code, error_message) {
                console.error('[UnifiedLLM] Bridge query failed ($actionName)', error_code, error_message);
                if (window.__onStatus) window.__onStatus('error');
                if (window.__onAgentText) window.__onAgentText('[Bridge query failure][$actionName] ' + error_code + ': ' + error_message);
            }
        """.trimIndent().replace("\n", " ")
        val successHandler = "onSuccess: function(response) { console.debug('[UnifiedLLM] Bridge query ok ($actionName)', response); }"
        return injectCode
            .replace("onSuccess: function(response) {}", successHandler)
            .replace("onFailure: function(error_code, error_message) {}", failureHandler)
    }

    private fun escapeJsonString(s: String): String {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r") + "\""
    }
}
