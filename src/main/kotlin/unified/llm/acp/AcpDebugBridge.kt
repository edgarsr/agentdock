package unified.llm.acp

import com.agentclientprotocol.model.ContentBlock
import com.agentclientprotocol.model.SessionUpdate
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
import unified.llm.utils.escapeForJsString
import java.util.concurrent.ConcurrentHashMap

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
    private var stopAgentQuery: JBCefJSQuery? = null
    private var respondPermissionQuery: JBCefJSQuery? = null
    private var readyQuery: JBCefJSQuery? = null
    private var loadSessionQuery: JBCefJSQuery? = null

    private val promptJobs = ConcurrentHashMap<String, Job>()

    companion object {
        const val START_AGENT_TIMEOUT_MS = 45_000L
    }

    fun install() {
        service.setOnLogEntry { pushLogEntry(it) }
        service.setOnPermissionRequest { pushPermissionRequest(it) }
        service.setOnSessionUpdate { chatId, update ->
            when (update) {
                is SessionUpdate.UserMessageChunk -> {
                    val content = update.content
                    if (content is ContentBlock.Text) {
                        pushHistoryReplay(chatId, "user", content.text)
                    }
                }
                is SessionUpdate.AgentMessageChunk -> {
                    val content = update.content
                    if (content is ContentBlock.Text) {
                        pushHistoryReplay(chatId, "assistant", content.text)
                    }
                }
                is SessionUpdate.CurrentModeUpdate -> pushMode(chatId, update.currentModeId.value)
                else -> Unit
            }
        }

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
                val (chatId, adapterName, modelId) = parseStartPayload(payload)
                if (chatId != null) {
                    scope.launch(Dispatchers.Default) {
                        pushStatus(chatId, "initializing")
                        try {
                            withTimeout(START_AGENT_TIMEOUT_MS) {
                                service.startAgent(chatId, adapterName, modelId)
                            }
                            pushStatus(chatId, service.status(chatId).name.lowercase())
                            pushSessionId(chatId, service.sessionId(chatId))
                            pushMode(chatId, service.activeModeId(chatId))
                        } catch (e: Exception) {
                            log.error("[AcpDebugBridge] Start agent failed for $chatId", e)
                            pushStatus(chatId, "error")
                            pushAgentText(chatId, "[Error: ${e.message ?: e.toString()}]")
                        }
                    }
                }
                JBCefJSQuery.Response("ok")
            }
        }

        setModelQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { payload ->
                val (chatId, modelId) = parseIdPayload(payload, "modelId")
                scope.launch(Dispatchers.Default) {
                    if (chatId == null || modelId == null) return@launch
                    pushStatus(chatId, "initializing")
                    try {
                        val ok = service.setModel(chatId, modelId)
                        if (!ok) {
                            pushAgentText(chatId, "[Error: Failed to set model '$modelId']")
                        }
                    } finally {
                        pushStatus(chatId, service.status(chatId).name.lowercase())
                    }
                }
                JBCefJSQuery.Response("ok")
            }
        }

        setModeQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { payload ->
                val (chatId, modeId) = parseIdPayload(payload, "modeId")
                scope.launch(Dispatchers.Default) {
                    if (chatId == null || modeId == null) return@launch
                    pushStatus(chatId, "initializing")
                    try {
                        val ok = service.setMode(chatId, modeId)
                        if (!ok) {
                            pushAgentText(chatId, "[Error: Failed to set mode '$modeId']")
                        }
                    } finally {
                        pushStatus(chatId, service.status(chatId).name.lowercase())
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
            addHandler { payload ->
                val (chatId, text) = parseTextPayload(payload)
                if (chatId != null) {
                    val message = text?.takeIf { it.isNotBlank() } ?: ""
                    val job = scope.launch(Dispatchers.Default) {
                        // Cancel any previous prompt via ACP protocol before starting a new one
                        service.cancel(chatId)
                        
                        pushStatus(chatId, "prompting")
                        try {
                            service.prompt(chatId, message).collect { event ->
                                when (event) {
                                    is AcpEvent.AgentText -> pushAgentText(chatId, event.text)
                                    is AcpEvent.PromptDone -> pushStatus(chatId, "ready")
                                    is AcpEvent.Error -> {
                                        log.warn("[AcpDebugBridge] Prompt error: ${event.message}")
                                        pushAgentText(chatId, "[Error: ${event.message}]")
                                    }
                                }
                            }
                        } catch (e: Exception) {
                            if (e is kotlinx.coroutines.CancellationException) {
                                log.info("[AcpDebugBridge] Prompt cancelled for $chatId")
                                pushAgentText(chatId, "[Cancelled]")
                                pushStatus(chatId, "ready")
                            } else {
                                log.error("[AcpDebugBridge] Send prompt failed", e)
                                pushAgentText(chatId, "[Error: ${e.message ?: e.toString()}]")
                                pushStatus(chatId, service.status(chatId).name.lowercase())
                            }
                        } finally {
                            promptJobs.remove(chatId)
                        }
                    }
                    promptJobs[chatId] = job
                }
                JBCefJSQuery.Response("ok")
            }
        }

        cancelPromptQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { chatIdPayload ->
                val chatId = chatIdPayload?.trim().orEmpty()
                if (chatId.isNotEmpty()) {
                    scope.launch(Dispatchers.Default) {
                        service.cancel(chatId)
                        pushStatus(chatId, "ready")
                    }
                }
                JBCefJSQuery.Response("ok")
            }
        }

        stopAgentQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { chatIdPayload ->
                val chatId = chatIdPayload?.trim().orEmpty()
                if (chatId.isNotEmpty()) {
                    log.info("[AcpDebugBridge] stopAgent requested for $chatId")
                    scope.launch(Dispatchers.Default) {
                        service.stopAgent(chatId)
                    }
                }
                JBCefJSQuery.Response("ok")
            }
        }
        
        respondPermissionQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { payload ->
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

        loadSessionQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { payload ->
                val (chatId, adapterId, sessionId, modelId, modeId) = parseLoadPayload(payload)
                if (chatId != null && adapterId != null && sessionId != null) {
                    scope.launch(Dispatchers.Default) {
                        pushStatus(chatId, "initializing")
                        try {
                            withTimeout(START_AGENT_TIMEOUT_MS) {
                                service.loadSession(chatId, adapterId, sessionId, modelId, modeId)
                            }
                            pushStatus(chatId, service.status(chatId).name.lowercase())
                            pushSessionId(chatId, service.sessionId(chatId))
                            pushMode(chatId, service.activeModeId(chatId))
                        } catch (e: Exception) {
                            log.error("[AcpDebugBridge] Load session failed for $chatId", e)
                            pushStatus(chatId, "error")
                            pushAgentText(chatId, "[Error: ${e.message ?: e.toString()}]")
                        }
                    }
                }
                JBCefJSQuery.Response("ok")
            }
        }
    }

    /**
     * First call (from onLoadEnd): inject no-op callbacks and __notifyReady so React can signal when it has set its callbacks.
     * Second call (from ready handler): inject real API.
     */
    fun injectDebugApi(cefBrowser: CefBrowser) {
        val startAgentInject = decorateQueryInject(
            startAgentQuery?.inject("JSON.stringify({ chatId: chatId, adapterId: (adapterId || ''), modelId: (modelId || '') })") ?: "",
            "startAgent"
        )
        val setModelInject = decorateQueryInject(
            setModelQuery?.inject("JSON.stringify({ chatId: chatId, modelId: modelId })") ?: "",
            "setModel"
        )
        val setModeInject = decorateQueryInject(
            setModeQuery?.inject("JSON.stringify({ chatId: chatId, modeId: modeId })") ?: "",
            "setMode"
        )
        val listAdaptersInject = decorateQueryInject(
            listAdaptersQuery?.inject("") ?: "",
            "listAdapters"
        )
        val sendPromptInject = decorateQueryInject(
            sendPromptQuery?.inject("JSON.stringify({ chatId: chatId, text: message })") ?: "",
            "sendPrompt"
        )
        val cancelPromptInject = decorateQueryInject(
            cancelPromptQuery?.inject("chatId") ?: "",
            "cancelPrompt"
        )
        val stopAgentInject = decorateQueryInject(
            stopAgentQuery?.inject("chatId") ?: "",
            "stopAgent"
        )
        val respondPermissionInject = decorateQueryInject(
            respondPermissionQuery?.inject("JSON.stringify({ requestId: requestId, decision: decision })") ?: "",
            "respondPermission"
        )
        val loadSessionInject = decorateQueryInject(
            loadSessionQuery?.inject("JSON.stringify({ chatId: chatId, adapterId: (adapterId || ''), sessionId: (sessionId || ''), modelId: (modelId || ''), modeId: (modeId || '') })") ?: "",
            "loadSession"
        )
        
        val script = """
            (function() {
                window.__requestAdapters = function() {
                    try { $listAdaptersInject } catch (e) { console.error('[UnifiedLLM] listAdapters', e); }
                };
                window.__startAgent = function(chatId, adapterId, modelId) {
                    try {
                        if (window.__onStatus) window.__onStatus(chatId, 'initializing');
                        $startAgentInject
                    } catch (e) {
                        console.error('[UnifiedLLM] startAgent error', e);
                        if (window.__onStatus) window.__onStatus(chatId, 'error');
                    }
                };
                window.__setModel = function(chatId, modelId) {
                    try { $setModelInject } catch (e) { console.error('[UnifiedLLM] setModel error', e); }
                };
                window.__setMode = function(chatId, modeId) {
                    try { $setModeInject } catch (e) { console.error('[UnifiedLLM] setMode error', e); }
                };
                window.__sendPrompt = function(chatId, message) {
                    try {
                        if (window.__onStatus) window.__onStatus(chatId, 'prompting');
                        $sendPromptInject
                    } catch (e) {
                         console.error('[UnifiedLLM] sendPrompt error', e);
                         if (window.__onStatus) window.__onStatus(chatId, 'error');
                    }
                };
                window.__cancelPrompt = function(chatId) {
                    try { $cancelPromptInject } catch (e) { console.error('[UnifiedLLM] cancelPrompt error', e); }
                };
                window.__stopAgent = function(chatId) {
                    try { $stopAgentInject } catch (e) { console.error('[UnifiedLLM] stopAgent error', e); }
                };
                window.__respondPermission = function(requestId, decision) {
                    try { $respondPermissionInject } catch (e) { console.error('[UnifiedLLM] respondPermission error', e); }
                };
                window.__loadHistorySession = function(chatId, adapterId, sessionId, modelId, modeId) {
                    try { $loadSessionInject } catch (e) { console.error('[UnifiedLLM] loadHistorySession error', e); }
                };
                
                // Try prime
                try { window.__requestAdapters(); } catch (e) {}
            })();
        """.trimIndent()
        cefBrowser.executeJavaScript(script, cefBrowser.url, 0)
    }

    fun injectReadySignal(cefBrowser: CefBrowser) {
        val readyInject = readyQuery?.inject("") ?: ""
        val script = """
            // Define stubs that accept optional chatId
            window.__onAcpLog = window.__onAcpLog || function(payload) {};
            window.__onAgentText = window.__onAgentText || function(chatId, text) {};
            window.__onStatus = window.__onStatus || function(chatId, status) {};
            window.__onSessionId = window.__onSessionId || function(chatId, id) {};
            window.__onAdapters = window.__onAdapters || function(adapters) {};
            window.__onMode = window.__onMode || function(chatId, modeId) {};
            window.__onPermissionRequest = window.__onPermissionRequest || function(request) {};
            window.__respondPermission = window.__respondPermission || function(requestId, decision) {};
            window.__stopAgent = window.__stopAgent || function(chatId) {};
            window.__onHistoryReplay = window.__onHistoryReplay || function(payload) {};
            
            window.__notifyReady = function() {
                try { $readyInject } catch (e) { console.error('[UnifiedLLM] notifyReady error', e); }
            };
        """.trimIndent()
        cefBrowser.executeJavaScript(script, cefBrowser.url, 0)
    }

    fun pushLogEntry(entry: AcpLogEntry) {
        // Global logs don't have chatId yet.
        val payload = """{"direction":"${entry.direction}","json":${escapeJsonString(entry.json)},"timestamp":${entry.timestampMillis}}"""
        val escaped = payload.escapeForJsString()
        val directionLabel = if (entry.direction == AcpLogEntry.Direction.SENT) "SENT" else "RECEIVED"
        val jsonEscaped = entry.json.replace("\\", "\\\\").replace("`", "\\`").replace("$", "\\$")
        runOnEdt {
            browser.cefBrowser.executeJavaScript(
                """
                (function() {
                    try {
                        const jsonStr = `${jsonEscaped}`;
                        const jsonObj = JSON.parse(jsonStr);
                        console.log('[ACP $directionLabel]', jsonObj);
                    } catch(e) { console.log('[ACP $directionLabel]', `${jsonEscaped}`); }
                })();
                if(window.__onAcpLog) window.__onAcpLog(JSON.parse('$escaped'));
                """.trimIndent(),
                browser.cefBrowser.url, 0
            )
        }
    }

    fun pushAgentText(chatId: String, text: String) {
        val escaped = text.escapeForJsString()
        val id = chatId.replace("\\", "\\\\").replace("'", "\\'")
        runOnEdt {
            browser.cefBrowser.executeJavaScript(
                "if(window.__onAgentText) window.__onAgentText('$id', '$escaped');",
                browser.cefBrowser.url, 0
            )
        }
    }

    fun pushStatus(chatId: String, status: String) {
        val escaped = status.replace("\\", "\\\\").replace("'", "\\'")
        val id = chatId.replace("\\", "\\\\").replace("'", "\\'")
        runOnEdt {
            browser.cefBrowser.executeJavaScript(
                "if(window.__onStatus) window.__onStatus('$id', '$escaped');",
                browser.cefBrowser.url, 0
            )
        }
    }

    fun pushMode(chatId: String, modeId: String?) {
        val value = modeId ?: ""
        val escaped = value.replace("\\", "\\\\").replace("'", "\\'")
        val id = chatId.replace("\\", "\\\\").replace("'", "\\'")
        runOnEdt {
            browser.cefBrowser.executeJavaScript(
                "if(window.__onMode) window.__onMode('$id', '$escaped');",
                browser.cefBrowser.url, 0
            )
        }
    }

    fun pushSessionId(chatId: String, sid: String?) {
        val value = sid ?: ""
        val escaped = value.replace("\\", "\\\\").replace("'", "\\'")
        val id = chatId.replace("\\", "\\\\").replace("'", "\\'")
        runOnEdt {
            browser.cefBrowser.executeJavaScript(
                "if(window.__onSessionId) window.__onSessionId('$id', '$escaped');",
                browser.cefBrowser.url, 0
            )
        }

    }

    fun pushPermissionRequest(request: PermissionRequest) {
        val jsonObject = buildJsonObject {
            put("requestId", request.requestId)
            put("chatId", request.chatId)
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
        val escaped = jsonString.escapeForJsString()

        runOnEdt {
             browser.cefBrowser.executeJavaScript(
                "if(window.__onPermissionRequest) window.__onPermissionRequest(JSON.parse('$escaped'));",
                browser.cefBrowser.url, 0
            )           
        }
    }

    fun pushHistoryReplay(chatId: String, role: String, text: String) {
        val escapedText = text.escapeForJsString()
        val escapedRole = role.replace("\\", "\\\\").replace("'", "\\'")
        val id = chatId.replace("\\", "\\\\").replace("'", "\\'")
        runOnEdt {
            browser.cefBrowser.executeJavaScript(
                "if(window.__onHistoryReplay) window.__onHistoryReplay({ chatId: '$id', role: '$escapedRole', text: '$escapedText' });",
                browser.cefBrowser.url, 0
            )
        }
    }

    fun pushAdapters() {
        try {
            val defaultName = try { AcpAdapterConfig.getDefaultAdapterName() } catch (e: Exception) { "" }
            val unique = linkedMapOf<String, AcpAdapterConfig.AdapterInfo>()
            AcpAdapterConfig.getAllAdapters().values.forEach { info -> unique[info.name] = info }
            val payload = unique.values.sortedBy { it.displayName.lowercase() }.joinToString(prefix = "[", postfix = "]") { info ->
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
            val escaped = payload.escapeForJsString()
            runOnEdt {
                browser.cefBrowser.executeJavaScript(
                    "if(window.__onAdapters) window.__onAdapters(JSON.parse('$escaped'));",
                    browser.cefBrowser.url, 0
                )
            }
        } catch (e: Exception) {
            log.error("Failed to push adapters to frontend", e)
        }
    }

    private fun runOnEdt(action: () -> Unit) = ApplicationManager.getApplication().invokeLater(action)

    private fun decorateQueryInject(injectCode: String, actionName: String): String {
        return injectCode
            .replace("onSuccess: function(response) {}", "onSuccess: function(response) { console.debug('[UnifiedLLM] $actionName ok', response); }")
            .replace("onFailure: function(error_code, error_message) {}", "onFailure: function(e, m) { console.error('[UnifiedLLM] $actionName failed', e, m); }")
    }

    private fun escapeJsonString(s: String) = "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r") + "\""
    private fun escapeJsonStringValue(s: String) = s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r")

    private fun parseStartPayload(payload: String?): Triple<String?, String?, String?> {
        val raw = payload?.trim().orEmpty()
        if (raw.isEmpty()) return Triple(null, null, null)
        return try {
            val obj = Json.parseToJsonElement(raw).jsonObject
            val chatId = obj["chatId"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }
            val adapterId = obj["adapterId"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }
            val modelId = obj["modelId"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }
            Triple(chatId, adapterId, modelId)
        } catch (_: Exception) { Triple(null, null, null) }
    }

    private fun parseIdPayload(payload: String?, idKey: String): Pair<String?, String?> {
         val raw = payload?.trim().orEmpty()
         if (raw.isEmpty()) return null to null
         return try {
             val obj = Json.parseToJsonElement(raw).jsonObject
             val chatId = obj["chatId"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }
             val idVal = obj[idKey]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }
             chatId to idVal
         } catch (_: Exception) { null to null }
    }
    
    private fun parseTextPayload(payload: String?): Pair<String?, String?> {
         val raw = payload?.trim().orEmpty()
         if (raw.isEmpty()) return null to null
         return try {
             val obj = Json.parseToJsonElement(raw).jsonObject
             val chatId = obj["chatId"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }
             val text = obj["text"]?.jsonPrimitive?.content
             chatId to text
         } catch (_: Exception) { null to null }
    }

    private fun parseLoadPayload(payload: String?): List<String?> {
        val raw = payload?.trim().orEmpty()
        if (raw.isEmpty()) return listOf(null, null, null, null, null)
        return try {
            val obj = Json.parseToJsonElement(raw).jsonObject
            val chatId = obj["chatId"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }
            val adapterId = obj["adapterId"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }
            val sessionId = obj["sessionId"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }
            val modelId = obj["modelId"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }
            val modeId = obj["modeId"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }
            listOf(chatId, adapterId, sessionId, modelId, modeId)
        } catch (_: Exception) { listOf(null, null, null, null, null) }
    }
}
