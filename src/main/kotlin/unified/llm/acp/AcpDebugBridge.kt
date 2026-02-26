package unified.llm.acp

import com.agentclientprotocol.model.*
import unified.llm.changes.AgentDiffViewer
import unified.llm.changes.ChangesState
import unified.llm.changes.ChangesStateService
import unified.llm.changes.UndoFileHandler
import unified.llm.changes.UndoOperation
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefJSQuery
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import java.io.File
import org.cef.browser.CefBrowser
import unified.llm.utils.escapeForJsString
import java.util.concurrent.ConcurrentHashMap

private val log = Logger.getInstance(AcpDebugBridge::class.java)

@Serializable
private data class AdapterToolPayload(val name: String, val path: String)

@Serializable
private data class AdapterModelPayload(val id: String, val displayName: String)

@Serializable
private data class AdapterModePayload(val id: String, val displayName: String)

@Serializable
private data class AdapterPayload(
    val id: String,
    val displayName: String,
    val isDefault: Boolean,
    val defaultModelId: String,
    val models: List<AdapterModelPayload>,
    val defaultModeId: String,
    val modes: List<AdapterModePayload>,
    val downloaded: Boolean,
    val enabled: Boolean,
    val downloadPath: String,
    val authAuthenticated: Boolean,
    val authPath: String,
    val authenticating: Boolean,
    val downloading: Boolean,
    val downloadStatus: String,
    val supportingTools: List<AdapterToolPayload>
)

private val adapterJson = Json { encodeDefaults = true }

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
    private var downloadAgentQuery: JBCefJSQuery? = null
    private var deleteAgentQuery: JBCefJSQuery? = null
    private var toggleAgentEnabledQuery: JBCefJSQuery? = null
    private var loginAgentQuery: JBCefJSQuery? = null
    private var logoutAgentQuery: JBCefJSQuery? = null
    private var undoFileQuery: JBCefJSQuery? = null
    private var undoAllFilesQuery: JBCefJSQuery? = null
    private var processFileQuery: JBCefJSQuery? = null
    private var keepAllQuery: JBCefJSQuery? = null
    private var removeProcessedFilesQuery: JBCefJSQuery? = null
    private var getChangesStateQuery: JBCefJSQuery? = null
    private var showDiffQuery: JBCefJSQuery? = null
    private var openFileQuery: JBCefJSQuery? = null

    private val promptJobs = ConcurrentHashMap<String, Job>()
    private val downloadStatuses = ConcurrentHashMap<String, String>()

    companion object {
        const val START_AGENT_TIMEOUT_MS = 45_000L
    }

    fun install() {
        service.setOnLogEntry { pushLogEntry(it) }
        // Each JS query below: frontend calls window.__* → JBCefJSQuery → addHandler → Kotlin logic → Response
        service.setOnPermissionRequest { pushPermissionRequest(it) }
        service.setOnSessionUpdate { chatId: String, update: SessionUpdate, isReplay: Boolean, _meta: JsonElement? ->
            when (update) {
                is SessionUpdate.UserMessageChunk -> {
                    pushHistoryReplay(chatId, "user", update.content)
                }
                is SessionUpdate.AgentMessageChunk -> {
                    pushHistoryReplay(chatId, "assistant", update.content)
                }
                is SessionUpdate.AgentThoughtChunk -> {
                    val content = update.content
                    if (isReplay) {
                        pushHistoryReplay(chatId, "assistant", content, isThought = true)
                    } else if (content is ContentBlock.Text) {
                        pushAgentThought(chatId, content.text)
                    }
                }
                is SessionUpdate.CurrentModeUpdate -> pushMode(chatId, update.currentModeId.value)
                else -> {}
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

        downloadAgentQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { payload ->
                val adapterId = parseIdOnlyPayload(payload)
                if (adapterId != null) {
                    scope.launch(Dispatchers.IO) {
                        try {
                            downloadStatuses[adapterId] = "Starting download..."
                            pushAdapters()
                            
                            service.stopSharedProcess(adapterId)
                            val adapterInfo = AcpAdapterPaths.getAdapterInfo(adapterId)
                            val targetDir = File(AcpAdapterPaths.getDependenciesDir(), adapterInfo.resourceName)
                            
                            val statusCallback = { status: String ->
                                downloadStatuses[adapterId] = status
                                pushAdapters()
                            }
                            
                            var success = AcpAdapterPaths.downloadFromNpm(targetDir, adapterInfo, statusCallback) && 
                                           AcpAdapterPaths.runNpmInstall(targetDir, statusCallback)
                            
                            // Download generic supporting tools
                            if (success) {
                                for (tool in adapterInfo.supportingTools) {
                                    if (!AcpAdapterPaths.downloadSupportingTool(tool, statusCallback)) {
                                        success = false
                                        break
                                    }
                                }
                            }
                            
                            if (success) {
                                // Apply patches immediately after install
                                AcpAdapterPaths.applyPatches(targetDir, adapterInfo, statusCallback)
                                downloadStatuses.remove(adapterId)
                                pushAdapters()
                            } else {
                                downloadStatuses[adapterId] = "Error: Download failed"
                                pushAdapters()
                                log.error("Manual download of $adapterId failed")
                            }
                        } catch (e: Exception) {
                            downloadStatuses[adapterId] = "Error: ${e.message}"
                            pushAdapters()
                            log.error("Failed to download agent $adapterId", e)
                        }
                    }
                }
                JBCefJSQuery.Response("ok")
            }
        }

        deleteAgentQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { payload ->
                val adapterId = parseIdOnlyPayload(payload)
                if (adapterId != null) {
                    scope.launch(Dispatchers.IO) {
                        service.stopSharedProcess(adapterId)
                        AcpAdapterPaths.deleteAdapter(adapterId)
                        pushAdapters()
                    }
                }
                JBCefJSQuery.Response("ok")
            }
        }

        toggleAgentEnabledQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { payload ->
                try {
                    val obj = Json.parseToJsonElement(payload ?: "{}").jsonObject
                    val adapterId = obj["adapterId"]?.jsonPrimitive?.content ?: ""
                    val enabled = obj["enabled"]?.jsonPrimitive?.booleanOrNull ?: true
                    if (adapterId.isNotEmpty()) {
                        AcpAgentSettings.setEnabled(adapterId, enabled)
                        pushAdapters()
                    }
                } catch (e: Exception) {
                    log.error("Failed to toggle agent enablement", e)
                }
                JBCefJSQuery.Response("ok")
            }
        }

        loginAgentQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { payload ->
                val adapterId = parseIdOnlyPayload(payload)
                if (adapterId != null) {
                    scope.launch(Dispatchers.Default) {
                        try {
                            AcpAuthService.incrementActive(adapterId)
                            pushAdapters() // Show loading state immediately
                            val projectPath = service.project.basePath
                            AcpAuthService.login(adapterId, projectPath) {
                                pushAdapters()
                            }
                        } finally {
                            AcpAuthService.decrementActive(adapterId)
                            pushAdapters() // Refresh UI after attempt
                        }
                    }
                }
                JBCefJSQuery.Response("ok")
            }
        }

        logoutAgentQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { payload ->
                val adapterId = parseIdOnlyPayload(payload)
                if (adapterId != null) {
                    scope.launch(Dispatchers.Default) {
                        try {
                            AcpAuthService.incrementActive(adapterId)
                            pushAdapters() // Show loading state immediately
                            AcpAuthService.logout(adapterId)
                        } finally {
                            AcpAuthService.decrementActive(adapterId)
                            pushAdapters() // Refresh UI after attempt
                        }
                    }
                }
                JBCefJSQuery.Response("ok")
            }
        }

        startAgentQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { payload ->
                val (chatId, adapterName, modelId) = parseStartPayload(payload)
                if (chatId != null) {
                    scope.launch(Dispatchers.Default) {
                        val authStatus = AcpAuthService.getAuthStatus(adapterName ?: "")
                        if (!authStatus.authenticated) {
                            pushStatus(chatId, "error")
                            pushAgentText(chatId, "[Error: Agent is not authenticated. Please login in settings.]")
                            return@launch
                        }

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
                val (chatId, blocks) = parseBlocksPayload(payload)
                if (chatId != null && blocks.isNotEmpty()) {
                    val job = scope.launch(Dispatchers.Default) {
                        // Cancel any previous prompt via ACP protocol before starting a new one
                        service.cancel(chatId)
                        
                        pushStatus(chatId, "prompting")
                        try {
                            service.prompt(chatId, blocks).collect { event ->
                                when (event) {
                                    is AcpEvent.AgentText -> pushAgentText(chatId, event.text)
                                    is AcpEvent.AgentThought -> pushAgentThought(chatId, event.text)
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

        undoFileQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { payload ->
                try {
                    val raw = payload ?: "{}"
                    val obj = Json.parseToJsonElement(raw).jsonObject
                    val chatId = obj["chatId"]?.jsonPrimitive?.content ?: ""
                    val filePath = obj["filePath"]?.jsonPrimitive?.content ?: ""
                    val status = obj["status"]?.jsonPrimitive?.content ?: "M"
                    val ops = obj["operations"]?.jsonArray?.map { opEl ->
                        val opObj = opEl.jsonObject
                        UndoOperation(
                            opObj["oldText"]?.jsonPrimitive?.content ?: "",
                            opObj["newText"]?.jsonPrimitive?.content ?: ""
                        )
                    } ?: emptyList()

                    if (chatId.isNotEmpty() && filePath.isNotEmpty()) {
                        runOnEdt {
                            val result = UndoFileHandler.undoSingleFile(service.project, filePath, status, ops)
                            pushUndoResult(chatId, result)
                        }
                    }
                } catch (e: Exception) {
                    log.error("Failed to parse undo file payload", e)
                }
                JBCefJSQuery.Response("ok")
            }
        }

        undoAllFilesQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { payload ->
                try {
                    val obj = Json.parseToJsonElement(payload ?: "{}").jsonObject
                    val chatId = obj["chatId"]?.jsonPrimitive?.content ?: ""
                    val filesArr = obj["files"]?.jsonArray ?: return@addHandler JBCefJSQuery.Response("ok")
                    val files = filesArr.map { fEl ->
                        val fObj = fEl.jsonObject
                        val path = fObj["filePath"]?.jsonPrimitive?.content ?: ""
                        val st = fObj["status"]?.jsonPrimitive?.content ?: "M"
                        val ops = fObj["operations"]?.jsonArray?.map { opEl ->
                            val opObj = opEl.jsonObject
                            UndoOperation(
                                opObj["oldText"]?.jsonPrimitive?.content ?: "",
                                opObj["newText"]?.jsonPrimitive?.content ?: ""
                            )
                        } ?: emptyList()
                        Triple(path, st, ops)
                    }
                    if (chatId.isNotEmpty()) {
                        runOnEdt {
                            val result = UndoFileHandler.undoAllFiles(service.project, files)
                            pushUndoResult(chatId, result)
                        }
                    }
                } catch (e: Exception) {
                    log.error("Failed to parse undo all files payload", e)
                }
                JBCefJSQuery.Response("ok")
            }
        }

        processFileQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { payload ->
                try {
                    val obj = Json.parseToJsonElement(payload ?: "{}").jsonObject
                    val sessionId = obj["sessionId"]?.jsonPrimitive?.content ?: ""
                    val adapterName = obj["adapterName"]?.jsonPrimitive?.content ?: ""
                    val filePath = obj["filePath"]?.jsonPrimitive?.content ?: ""
                    if (sessionId.isNotEmpty() && adapterName.isNotEmpty() && filePath.isNotEmpty()) {
                        ChangesStateService.addProcessedFile(sessionId, adapterName, filePath)
                    }
                } catch (e: Exception) {
                    log.error("Failed to process file", e)
                }
                JBCefJSQuery.Response("ok")
            }
        }

        keepAllQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { payload ->
                try {
                    val obj = Json.parseToJsonElement(payload ?: "{}").jsonObject
                    val sessionId = obj["sessionId"]?.jsonPrimitive?.content ?: ""
                    val adapterName = obj["adapterName"]?.jsonPrimitive?.content ?: ""
                    val toolCallIndex = obj["toolCallIndex"]?.jsonPrimitive?.content?.toIntOrNull() ?: 0
                    if (sessionId.isNotEmpty() && adapterName.isNotEmpty()) {
                        ChangesStateService.setBaseIndex(sessionId, adapterName, toolCallIndex)
                    }
                } catch (e: Exception) {
                    log.error("Failed to keep all", e)
                }
                JBCefJSQuery.Response("ok")
            }
        }

        removeProcessedFilesQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { payload ->
                try {
                    val obj = Json.parseToJsonElement(payload ?: "{}").jsonObject
                    val sessionId = obj["sessionId"]?.jsonPrimitive?.content ?: ""
                    val adapterName = obj["adapterName"]?.jsonPrimitive?.content ?: ""
                    val filePaths = obj["filePaths"]?.jsonArray?.mapNotNull { it.jsonPrimitive?.content } ?: emptyList()
                    if (sessionId.isNotEmpty() && adapterName.isNotEmpty() && filePaths.isNotEmpty()) {
                        ChangesStateService.removeProcessedFiles(sessionId, adapterName, filePaths)
                    }
                } catch (e: Exception) {
                    log.error("Failed to remove processed files", e)
                }
                JBCefJSQuery.Response("ok")
            }
        }

        getChangesStateQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { payload ->
                try {
                    val obj = Json.parseToJsonElement(payload ?: "{}").jsonObject
                    val chatId = obj["chatId"]?.jsonPrimitive?.content ?: ""
                    val sessionId = obj["sessionId"]?.jsonPrimitive?.content ?: ""
                    val adapterName = obj["adapterName"]?.jsonPrimitive?.content ?: ""
                    if (chatId.isNotEmpty() && sessionId.isNotEmpty() && adapterName.isNotEmpty()) {
                        val state = ChangesStateService.loadState(sessionId, adapterName) ?: ChangesState(sessionId, adapterName)
                        pushChangesState(chatId, state)
                    }
                } catch (e: Exception) {
                    log.error("Failed to get changes state", e)
                }
                JBCefJSQuery.Response("ok")
            }
        }

        showDiffQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { payload ->
                try {
                    val obj = Json.parseToJsonElement(payload ?: "{}").jsonObject
                    val filePath = obj["filePath"]?.jsonPrimitive?.content ?: ""
                    val status = obj["status"]?.jsonPrimitive?.content ?: "M"
                    val ops = obj["operations"]?.jsonArray?.map { opEl ->
                        val opObj = opEl.jsonObject
                        UndoOperation(
                            opObj["oldText"]?.jsonPrimitive?.content ?: "",
                            opObj["newText"]?.jsonPrimitive?.content ?: ""
                        )
                    } ?: emptyList()
                    if (filePath.isNotEmpty()) {
                        runOnEdt {
                            AgentDiffViewer.showAgentDiff(service.project, filePath, status, ops)
                        }
                    }
                } catch (e: Exception) {
                    log.error("Failed to show agent diff", e)
                }
                JBCefJSQuery.Response("ok")
            }
        }

        openFileQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { payload ->
                try {
                    val obj = Json.parseToJsonElement(payload ?: "{}").jsonObject
                    val filePath = obj["filePath"]?.jsonPrimitive?.content ?: ""
                    if (filePath.isNotEmpty()) {
                        runOnEdt {
                            try {
                                val resolved = UndoFileHandler.resolveFilePath(service.project, filePath)
                                val base = service.project.basePath ?: return@runOnEdt
                                if (!File(resolved).canonicalPath.startsWith(File(base).canonicalPath)) return@runOnEdt
                                val vf = LocalFileSystem.getInstance().refreshAndFindFileByIoFile(File(resolved))
                                if (vf != null && vf.exists()) {
                                    FileEditorManager.getInstance(service.project).openFile(vf, true)
                                }
                            } catch (_: Exception) {}
                        }
                    }
                } catch (_: Exception) {}
                JBCefJSQuery.Response("ok")
            }
        }
    }

    /**
     * Injects the real JS bridge: window.__startAgent, __sendPrompt, __undoFile, etc.
     * Called from the ready handler after React has called __notifyReady() and set window.__on* callbacks.
     * (injectReadySignal runs first on page load and only sets no-op stubs for __on* and __downloadAgent etc.)
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
        val downloadAgentInject = decorateQueryInject(
            downloadAgentQuery?.inject("adapterId") ?: "",
            "downloadAgent"
        )
        val deleteAgentInject = decorateQueryInject(
            deleteAgentQuery?.inject("adapterId") ?: "",
            "deleteAgent"
        )
        val toggleAgentEnabledInject = decorateQueryInject(
            toggleAgentEnabledQuery?.inject("JSON.stringify({ adapterId: adapterId, enabled: enabled })") ?: "",
            "toggleAgentEnabled"
        )
        val loginAgentInject = decorateQueryInject(
            loginAgentQuery?.inject("adapterId") ?: "",
            "loginAgent"
        )
        val logoutAgentInject = decorateQueryInject(
            logoutAgentQuery?.inject("adapterId") ?: "",
            "logoutAgent"
        )
        val undoFileInject = decorateQueryInject(
            undoFileQuery?.inject("payload") ?: "",
            "undoFile"
        )
        val undoAllFilesInject = decorateQueryInject(
            undoAllFilesQuery?.inject("payload") ?: "",
            "undoAllFiles"
        )
        val processFileInject = decorateQueryInject(
            processFileQuery?.inject("payload") ?: "",
            "processFile"
        )
        val keepAllInject = decorateQueryInject(
            keepAllQuery?.inject("payload") ?: "",
            "keepAll"
        )
        val removeProcessedFilesInject = decorateQueryInject(
            removeProcessedFilesQuery?.inject("payload") ?: "",
            "removeProcessedFiles"
        )
        val getChangesStateInject = decorateQueryInject(
            getChangesStateQuery?.inject("payload") ?: "",
            "getChangesState"
        )
        val showDiffInject = decorateQueryInject(
            showDiffQuery?.inject("payload") ?: "",
            "showDiff"
        )
        val openFileInject = decorateQueryInject(
            openFileQuery?.inject("payload") ?: "",
            "openFile"
        )

        val script = """
            (function() {
                window.__requestAdapters = function() {
                    try { $listAdaptersInject } catch (e) { }
                };
                window.__startAgent = function(chatId, adapterId, modelId) {
                    try {
                        if (window.__onStatus) window.__onStatus(chatId, 'initializing');
                        $startAgentInject
                    } catch (e) { }
                };
                window.__setModel = function(chatId, modelId) {
                    try { $setModelInject } catch (e) { }
                };
                window.__setMode = function(chatId, modeId) {
                    try { $setModeInject } catch (e) { }
                };
                window.__sendPrompt = function(chatId, message) {
                    try {
                        if (window.__onStatus) window.__onStatus(chatId, 'prompting');
                        $sendPromptInject
                    } catch (e) { }
                };
                window.__cancelPrompt = function(chatId) {
                    try { $cancelPromptInject } catch (e) { }
                };
                window.__stopAgent = function(chatId) {
                    try { $stopAgentInject } catch (e) { }
                };
                window.__respondPermission = function(requestId, decision) {
                    try { $respondPermissionInject } catch (e) { }
                };
                window.__loadHistorySession = function(chatId, adapterId, sessionId, modelId, modeId) {
                    try { $loadSessionInject } catch (e) { }
                };
                window.__downloadAgent = function(adapterId) {
                    try { $downloadAgentInject } catch (e) { }
                };
                window.__deleteAgent = function(adapterId) {
                    try { $deleteAgentInject } catch (e) { }
                };
                window.__toggleAgentEnabled = function(adapterId, enabled) {
                    try { $toggleAgentEnabledInject } catch (e) { }
                };
                window.__loginAgent = function(adapterId) {
                    try { $loginAgentInject } catch (e) { }
                };
                window.__logoutAgent = function(adapterId) {
                    try { $logoutAgentInject } catch (e) { }
                };
                window.__undoFile = function(payload) {
                    try { $undoFileInject } catch (e) { }
                };
                window.__undoAllFiles = function(payload) {
                    try { $undoAllFilesInject } catch (e) { }
                };
                window.__processFile = function(payload) {
                    try { $processFileInject } catch (e) { }
                };
                window.__keepAll = function(payload) {
                    try { $keepAllInject } catch (e) { }
                };
                window.__removeProcessedFiles = function(payload) {
                    try { $removeProcessedFilesInject } catch (e) { }
                };
                window.__getChangesState = function(payload) {
                    try { $getChangesStateInject } catch (e) { }
                };
                window.__showDiff = function(payload) {
                    try { $showDiffInject } catch (e) { }
                };
                window.__openFile = function(payload) {
                    try { $openFileInject } catch (e) { }
                };

                // Try prime
                try { window.__requestAdapters(); } catch (e) {}
            })();
        """.trimIndent()
        cefBrowser.executeJavaScript(script, cefBrowser.url, 0)
    }

    /**
     * Injected on first page load (onLoadEnd). Registers no-op stubs for all __on* and action callbacks
     * so the page does not break before React mounts. When React is ready it calls __notifyReady(),
     * which triggers injectDebugApi() to replace these with the real implementations.
     */
    fun injectReadySignal(cefBrowser: CefBrowser) {
        val readyInject = readyQuery?.inject("") ?: ""
        val script = """
            // No-op stubs until injectDebugApi runs after __notifyReady()
            window.__onAcpLog = window.__onAcpLog || function(payload) {};
            window.__onAgentText = window.__onAgentText || function(chatId, text) {};
            window.__onAgentThought = window.__onAgentThought || function(chatId, text) {};
            window.__onStatus = window.__onStatus || function(chatId, status) {};
            window.__onSessionId = window.__onSessionId || function(chatId, id) {};
            window.__onAdapters = window.__onAdapters || function(adapters) {};
            window.__onMode = window.__onMode || function(chatId, modeId) {};
            window.__onPermissionRequest = window.__onPermissionRequest || function(request) {};
            window.__respondPermission = window.__respondPermission || function(requestId, decision) {};
            window.__stopAgent = window.__stopAgent || function(chatId) {};
            window.__onHistoryReplay = window.__onHistoryReplay || function(payload) {};
            window.__onToolCall = window.__onToolCall || function(chatId, payload) {};
            window.__onToolCallUpdate = window.__onToolCallUpdate || function(chatId, payload) {};
            window.__onPlan = window.__onPlan || function(chatId, payload) {};
            window.__onUndoResult = window.__onUndoResult || function(chatId, result) {};
            window.__onChangesState = window.__onChangesState || function(chatId, state) {};

            window.__notifyReady = function() {
                try { $readyInject } catch (e) { }
            };
            window.__downloadAgent = window.__downloadAgent || function(id) {};
            window.__deleteAgent = window.__deleteAgent || function(id) {};
            window.__toggleAgentEnabled = window.__toggleAgentEnabled || function(id, e) {};
            window.__loginAgent = window.__loginAgent || function(id) {};
            window.__logoutAgent = window.__logoutAgent || function(id) {};
        """.trimIndent()
        cefBrowser.executeJavaScript(script, cefBrowser.url, 0)
    }

    fun pushLogEntry(entry: AcpLogEntry) {
        val payload = """{"direction":"${entry.direction}","json":${escapeJsonString(entry.json)},"timestamp":${entry.timestampMillis}}"""
        val escaped = payload.escapeForJsString()
        runOnEdt {
            browser.cefBrowser.executeJavaScript(
                "if(window.__onAcpLog) window.__onAcpLog(JSON.parse('$escaped'));",
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

    fun pushAgentThought(chatId: String, text: String) {
        val escaped = text.escapeForJsString()
        val id = chatId.replace("\\", "\\\\").replace("'", "\\'")
        runOnEdt {
            browser.cefBrowser.executeJavaScript(
                "if(window.__onAgentThought) window.__onAgentThought('$id', '$escaped');",
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
        val escapedDec = request.description.escapeForJsString()
        runOnEdt {
            browser.cefBrowser.executeJavaScript(
                "if(window.__onPermissionRequest) window.__onPermissionRequest({ requestId: '${request.requestId}', chatId: '${request.chatId}', description: '$escapedDec' });",
                browser.cefBrowser.url, 0
            )
        }
    }

    fun pushHistoryReplay(chatId: String, role: String, content: ContentBlock, isThought: Boolean = false) {
        val payload = when (content) {
            is ContentBlock.Text -> {
                if (isThought) {
                    """{"type":"thinking","text":${escapeJsonString(content.text)}}"""
                } else {
                    """{"type":"text","text":${escapeJsonString(content.text)}}"""
                }
            }
            is ContentBlock.Image -> """{"type":"image","data":"${content.data}","mimeType":"${content.mimeType}"}"""
            else -> null
        }
        if (payload == null) return

        val escapedRole = role.replace("\\", "\\\\").replace("'", "\\'")
        val id = chatId.replace("\\", "\\\\").replace("'", "\\'")
        runOnEdt {
            browser.cefBrowser.executeJavaScript(
                "if(window.__onHistoryReplay) window.__onHistoryReplay({ chatId: '$id', role: '$escapedRole', content: $payload });",
                browser.cefBrowser.url, 0
            )
        }
    }

    fun pushUndoResult(chatId: String, result: unified.llm.changes.UndoResult) {
        val successStr = if (result.success) "true" else "false"
        val msgEscaped = result.message.escapeForJsString()
        val id = chatId.replace("\\", "\\\\").replace("'", "\\'")
        runOnEdt {
            browser.cefBrowser.executeJavaScript(
                "if(window.__onUndoResult) window.__onUndoResult('$id', {success:$successStr,message:'$msgEscaped'});",
                browser.cefBrowser.url, 0
            )
        }
    }

    fun pushChangesState(chatId: String, state: ChangesState) {
        val processedJson = state.processedFiles.joinToString(",") { escapeJsonString(it) }
        val payload = """{"sessionId":${escapeJsonString(state.sessionId)},"adapterName":${escapeJsonString(state.adapterName)},"baseToolCallIndex":${state.baseToolCallIndex},"processedFiles":[$processedJson]}"""
        val id = chatId.replace("\\", "\\\\").replace("'", "\\'")
        val escaped = payload.escapeForJsString()
        runOnEdt {
            browser.cefBrowser.executeJavaScript(
                "if(window.__onChangesState) window.__onChangesState('$id', JSON.parse('$escaped'));",
                browser.cefBrowser.url, 0
            )
        }
    }



    fun pushAdapters() {
        try {
            val defaultName = try { AcpAdapterConfig.getDefaultAdapterName() } catch (e: Exception) { "" }
            val unique = linkedMapOf<String, AcpAdapterConfig.AdapterInfo>()
            AcpAdapterConfig.getAllAdapters().values.forEach { info -> unique[info.name] = info }

            val adapters = unique.values.sortedBy { it.displayName.lowercase() }.map { info ->
                val downloaded = AcpAdapterPaths.isDownloaded(info.name)
                val authStatus = AcpAuthService.getAuthStatus(info.name)
                val dlStatus = downloadStatuses[info.name] ?: ""

                AdapterPayload(
                    id = info.name,
                    displayName = info.displayName,
                    isDefault = info.name == defaultName,
                    defaultModelId = info.defaultModelId ?: "",
                    models = info.models.map { AdapterModelPayload(it.id, it.displayName) },
                    defaultModeId = info.defaultModeId ?: "",
                    modes = info.modes.map { AdapterModePayload(it.id, it.displayName) },
                    downloaded = downloaded,
                    enabled = AcpAgentSettings.isEnabled(info.name),
                    downloadPath = if (downloaded) AcpAdapterPaths.getDownloadPath(info.name) else "",
                    authAuthenticated = authStatus.authenticated,
                    authPath = authStatus.authPath ?: "",
                    authenticating = AcpAuthService.isAuthenticating(info.name),
                    downloading = dlStatus.isNotEmpty() && !dlStatus.startsWith("Error"),
                    downloadStatus = dlStatus,
                    supportingTools = info.supportingTools.map { tool ->
                        val toolDirName = tool.targetDir ?: tool.id
                        val toolDir = File(AcpAdapterPaths.getDependenciesDir(), toolDirName)
                        AdapterToolPayload(tool.name, toolDir.absolutePath)
                    }
                )
            }

            val payload = adapterJson.encodeToString(adapters)
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
            .replace("onSuccess: function(response) {}", "onSuccess: function(response) {}")
            .replace("onFailure: function(error_code, error_message) {}", "onFailure: function(e, m) {}")
    }

    private fun escapeJsonString(s: String) = "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r") + "\""

    private fun parseIdOnlyPayload(payload: String?): String? {
        return payload?.trim()?.takeIf { it.isNotEmpty() }
    }

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

    private fun parseBlocksPayload(payload: String?): Pair<String?, List<ContentBlock>> {
        val raw = payload?.trim().orEmpty()
        if (raw.isEmpty()) return null to emptyList()
        return try {
            val obj = Json.parseToJsonElement(raw).jsonObject
            val chatId = obj["chatId"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }
            
            // 1. Try to get blocks directly if present
            val blocksElement = obj["blocks"]
            if (blocksElement != null) {
                val blocks = blocksElement.jsonArray.map { blockEl ->
                    val blockObj = blockEl.jsonObject
                    val type = blockObj["type"]?.jsonPrimitive?.content
                    when (type) {
                        "image" -> {
                            val data = blockObj["data"]?.jsonPrimitive?.content ?: ""
                            val mimeType = blockObj["mimeType"]?.jsonPrimitive?.content ?: "image/png"
                            ContentBlock.Image(data, mimeType)
                        }
                        else -> {
                            val text = blockObj["text"]?.jsonPrimitive?.content ?: ""
                            ContentBlock.Text(text)
                        }
                    }
                }
                return chatId to blocks
            }
            
            // 2. Fallback to text field
            val textValue = obj["text"]?.jsonPrimitive?.content ?: ""
            
            // 3. If textValue looks like a JSON array of blocks, try to parse it (compatibility with current UI)
            if (textValue.startsWith("[") && textValue.endsWith("]")) {
                try {
                    val blocks = Json.parseToJsonElement(textValue).jsonArray.map { blockEl ->
                        val blockObj = blockEl.jsonObject
                        val type = blockObj["type"]?.jsonPrimitive?.content
                        when (type) {
                            "image" -> {
                                val data = blockObj["data"]?.jsonPrimitive?.content ?: ""
                                val mimeType = blockObj["mimeType"]?.jsonPrimitive?.content ?: "image/png"
                                ContentBlock.Image(data, mimeType)
                            }
                            else -> {
                                val text = blockObj["text"]?.jsonPrimitive?.content ?: ""
                                ContentBlock.Text(text)
                            }
                        }
                    }
                    if (blocks.isNotEmpty()) return chatId to blocks
                } catch (_: Exception) {}
            }
            
            // 4. Final fallback: treat as plain text
            return chatId to listOf(ContentBlock.Text(textValue))
        } catch (_: Exception) { null to emptyList() }
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
