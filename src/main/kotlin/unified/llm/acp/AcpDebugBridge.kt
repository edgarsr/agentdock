package unified.llm.acp

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefJSQuery
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.add
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
    private var setModelQuery: JBCefJSQuery? = null
    private var setModeQuery: JBCefJSQuery? = null
    private var listAdaptersQuery: JBCefJSQuery? = null
    private var cancelPromptQuery: JBCefJSQuery? = null
    private var respondPermissionQuery: JBCefJSQuery? = null
    private var readyQuery: JBCefJSQuery? = null

    private var currentPromptJob: Job? = null

    companion object {
        const val START_AGENT_TIMEOUT_MS = 45_000L
    }

    fun install() {
        service.setOnLogEntry { pushLogEntry(it) }
        service.setOnPermissionRequest { pushPermissionRequest(it) }

        readyQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler {
                runOnEdt {
                    injectDebugApi(browser.cefBrowser)
                    pushAdapters()
                }
                JBCefJSQuery.Response("ok")
            }
        }

        startAgentQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { payload ->
                val (adapterName, modelId) = parseStartPayload(payload)
                scope.launch(Dispatchers.Default) {
                    pushStatus("initializing")
                    try {
                        withTimeout(START_AGENT_TIMEOUT_MS) {
                            service.startAgent(adapterName, modelId)
                        }
                        pushStatus(service.status().name.lowercase())
                        pushSessionId(service.sessionId())
                        pushMode(service.activeModeId())
                    } catch (e: Exception) {
                        log.error("[AcpDebugBridge] Start agent failed", e)
                        pushStatus("error")
                        pushAgentText("[Error: ${e.message ?: e.toString()}]")
                    }
                }
                JBCefJSQuery.Response("ok")
            }
        }

        setModelQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { modelId ->
                val requestedModelId = modelId?.trim().orEmpty()
                scope.launch(Dispatchers.Default) {
                    if (requestedModelId.isEmpty()) return@launch
                    val ok = service.setModel(requestedModelId)
                    if (!ok) {
                        pushAgentText("[Error: Failed to set model '$requestedModelId']")
                    }
                }
                JBCefJSQuery.Response("ok")
            }
        }

        setModeQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { modeId ->
                val requestedModeId = modeId?.trim().orEmpty()
                scope.launch(Dispatchers.Default) {
                    if (requestedModeId.isEmpty()) return@launch
                    val ok = service.setMode(requestedModeId)
                    if (!ok) {
                        pushAgentText("[Error: Failed to set mode '$requestedModeId']")
                    }
                }
                JBCefJSQuery.Response("ok")
            }
        }

        listAdaptersQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler {
                pushAdapters()
                JBCefJSQuery.Response("ok")
            }
        }

        sendPromptQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { text ->
                val message = text?.takeIf { it.isNotBlank() } ?: ""
                // Cancel any previous prompt job if it's still running
                currentPromptJob?.cancel()
                currentPromptJob = scope.launch(Dispatchers.Default) {
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
                        if (e is kotlinx.coroutines.CancellationException) {
                            log.info("[AcpDebugBridge] Prompt cancelled")
                            pushAgentText("[Cancelled]")
                            pushStatus("ready")
                        } else {
                            log.error("[AcpDebugBridge] Send prompt failed", e)
                            pushAgentText("[Error: ${e.message ?: e.toString()}]")
                            pushStatus(service.status().name.lowercase())
                        }
                    } finally {
                        currentPromptJob = null
                    }
                }
                JBCefJSQuery.Response("ok")
            }
        }

        cancelPromptQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler {
                currentPromptJob?.cancel()
                currentPromptJob = null
                pushStatus("ready")
                JBCefJSQuery.Response("ok")
            }
        }

        respondPermissionQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { payload ->
                // payload: "requestId|decision" or JSON
                // Let's assume simple string with separator or JSON. 
                // Using JSON for robustness.
                try {
                     val obj = Json.parseToJsonElement(payload ?: "{}").jsonObject
                     val requestId = obj["requestId"]?.jsonPrimitive?.content ?: ""
                     val decision = obj["decision"]?.jsonPrimitive?.content ?: ""
                     if (requestId.isNotEmpty()) {
                        scope.launch(Dispatchers.Default) {
                            service.respondToPermissionRequest(requestId, decision)
                        }
                     }
                } catch (e: Exception) {
                    log.error("Failed to parse permission response", e)
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
            startAgentQuery?.inject("JSON.stringify({ adapterId: (adapterId || ''), modelId: (modelId || '') })") ?: "",
            "startAgent"
        )
        val setModelInject = decorateQueryInject(
            setModelQuery?.inject("modelId") ?: "",
            "setModel"
        )
        val setModeInject = decorateQueryInject(
            setModeQuery?.inject("modeId") ?: "",
            "setMode"
        )
        val listAdaptersInject = decorateQueryInject(
            listAdaptersQuery?.inject("") ?: "",
            "listAdapters"
        )
        val sendPromptInject = decorateQueryInject(
            sendPromptQuery?.inject("message") ?: "",
            "sendPrompt"
        )
        val cancelPromptInject = decorateQueryInject(
            cancelPromptQuery?.inject("") ?: "",
            "cancelPrompt"
        )
        val respondPermissionInject = decorateQueryInject(
            respondPermissionQuery?.inject("JSON.stringify({ requestId: requestId, decision: decision })") ?: "",
            "respondPermission"
        )
        val script = """
            (function() {
                window.__onAcpLog = window.__onAcpLog || function(payload) {};
                window.__onAgentText = window.__onAgentText || function(text) {};
                window.__onStatus = window.__onStatus || function(status) {};
                window.__onSessionId = window.__onSessionId || function(id) {};
                window.__onAdapters = window.__onAdapters || function(adapters) {};
                window.__onMode = window.__onMode || function(modeId) {};
                window.__onPermissionRequest = window.__onPermissionRequest || function(request) {};
                window.__requestAdapters = function() {
                    try {
                        $listAdaptersInject
                    } catch (e) {
                        console.error('[UnifiedLLM] List adapters bridge error', e);
                    }
                };
                window.__startAgent = function(adapterId, modelId) {
                    try {
                        if (window.__onStatus) window.__onStatus('initializing');
                        $startAgentInject
                    } catch (e) {
                        console.error('[UnifiedLLM] Start Agent bridge error', e);
                        if (window.__onStatus) window.__onStatus('error');
                        if (window.__onAgentText) window.__onAgentText('[Bridge error: ' + e.message + ']');
                    }
                };
                window.__setModel = function(modelId) {
                    try {
                        $setModelInject
                    } catch (e) {
                        console.error('[UnifiedLLM] Set model bridge error', e);
                        if (window.__onAgentText) window.__onAgentText('[Bridge error: ' + e.message + ']');
                    }
                };
                window.__setMode = function(modeId) {
                    try {
                        $setModeInject
                    } catch (e) {
                        console.error('[UnifiedLLM] Set mode bridge error', e);
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
                window.__cancelPrompt = function() {
                    try {
                        $cancelPromptInject
                    } catch (e) {
                        console.error('[UnifiedLLM] Cancel Prompt bridge error', e);
                    }
                };
                window.__respondPermission = function(requestId, decision) {
                    try {
                        $respondPermissionInject
                    } catch (e) {
                         console.error('[UnifiedLLM] Respond Permission bridge error', e);
                    }
                };
                // Prime adapter list automatically after bridge injection.
                try { window.__requestAdapters(); } catch (e) {}
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
            window.__onAdapters = window.__onAdapters || function(adapters) {};
            window.__setModel = window.__setModel || function(modelId) {};
            window.__setMode = window.__setMode || function(modeId) {};
            window.__onMode = window.__onMode || function(modeId) {};
            window.__onPermissionRequest = window.__onPermissionRequest || function(request) {};
            window.__respondPermission = window.__respondPermission || function(requestId, decision) {};
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

    fun pushMode(modeId: String?) {
        val value = modeId ?: ""
        val escaped = value.replace("\\", "\\\\").replace("'", "\\'")
        runOnEdt {
            browser.cefBrowser.executeJavaScript(
                "if(window.__onMode) window.__onMode('$escaped');",
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


    fun pushPermissionRequest(request: PermissionRequest) {
        val jsonObject = buildJsonObject {
            put("requestId", request.requestId)
            put("description", request.description)
            put("options", buildJsonArray {
                request.options.forEach { opt ->
                    add(buildJsonObject {
                        put("optionId", opt.optionId.toString())
                        put("label", opt.toString())
                    })
                }
            })
        }
        val jsonString = Json.encodeToString(kotlinx.serialization.json.JsonObject.serializer(), jsonObject)
        
        // Escape for JS string injection
        val escaped = jsonString.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "\\r")

        runOnEdt {
             browser.cefBrowser.executeJavaScript(
                "if(window.__onPermissionRequest) window.__onPermissionRequest(JSON.parse('$escaped'));",
                browser.cefBrowser.url,
                0
            )           
        }
    }

    fun pushAdapters() {
        try {
            val defaultName = try {
                AcpAdapterConfig.getDefaultAdapterName()
            } catch (e: Exception) {
                log.warn("Failed to resolve default adapter", e)
                ""
            }
            val unique = linkedMapOf<String, AcpAdapterConfig.AdapterInfo>()
            AcpAdapterConfig.getAllAdapters().values.forEach { info ->
                unique[info.name] = info
            }
            val payload = unique.values
                .sortedBy { it.displayName.lowercase() }
                .joinToString(prefix = "[", postfix = "]") { info ->
                    val id = escapeJsonStringValue(info.name)
                    val displayName = escapeJsonStringValue(info.displayName)
                    val isDefault = if (info.name == defaultName) "true" else "false"
                    val defaultModelId = escapeJsonStringValue(info.defaultModelId ?: "")
                    val modelsJson = info.models.joinToString(prefix = "[", postfix = "]") { model ->
                        val modelId = escapeJsonStringValue(model.id)
                        val modelDisplayName = escapeJsonStringValue(model.displayName)
                        """{"id":"$modelId","displayName":"$modelDisplayName"}"""
                    }
                    val modesJson = info.modes.joinToString(prefix = "[", postfix = "]") { mode ->
                        val modeId = escapeJsonStringValue(mode.id)
                        val modeDisplayName = escapeJsonStringValue(mode.displayName)
                        """{"id":"$modeId","displayName":"$modeDisplayName"}"""
                    }
                    val defaultModeId = escapeJsonStringValue(info.defaultModeId ?: "")
                    """{"id":"$id","displayName":"$displayName","isDefault":$isDefault,"defaultModelId":"$defaultModelId","models":$modelsJson,"defaultModeId":"$defaultModeId","modes":$modesJson}"""
                }
            val escaped = payload
                .replace("\\", "\\\\")
                .replace("'", "\\'")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
            runOnEdt {
                browser.cefBrowser.executeJavaScript(
                    "if(window.__onAdapters) window.__onAdapters(JSON.parse('$escaped'));",
                    browser.cefBrowser.url,
                    0
                )
            }
        } catch (e: Exception) {
            log.error("Failed to push adapters to frontend", e)
            pushAgentText("[Bridge error: Failed to load adapter list]")
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

    private fun escapeJsonStringValue(s: String): String {
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r")
    }

    private fun parseStartPayload(payload: String?): Pair<String?, String?> {
        val raw = payload?.trim().orEmpty()
        if (raw.isEmpty()) return null to null
        return try {
            val obj = Json.parseToJsonElement(raw).jsonObject
            val adapterId = obj["adapterId"]?.jsonPrimitive?.content?.trim().orEmpty().ifBlank { null }
            val modelId = obj["modelId"]?.jsonPrimitive?.content?.trim().orEmpty().ifBlank { null }
            adapterId to modelId
        } catch (_: Exception) {
            // Backward compatibility for old payload format that sent adapterId directly.
            raw.ifBlank { null } to null
        }
    }

}
