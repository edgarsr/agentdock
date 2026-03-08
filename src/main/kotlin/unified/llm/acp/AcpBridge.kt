package unified.llm.acp

import com.agentclientprotocol.model.*
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
import java.io.BufferedInputStream
import javax.sound.sampled.AudioFormat
import javax.sound.sampled.AudioSystem
import javax.sound.sampled.Clip
import javax.sound.sampled.LineEvent
import org.cef.browser.CefBrowser
import unified.llm.utils.escapeForJsString
import java.util.concurrent.ConcurrentHashMap
import com.intellij.openapi.application.ApplicationManager
import unified.llm.changes.AgentDiffViewer
import unified.llm.changes.ChangesState
import unified.llm.changes.ChangesStateService
import unified.llm.changes.UndoFileHandler
import unified.llm.changes.UndoOperation


@Serializable
private data class AdapterModelPayload(val modelId: String, val name: String)

@Serializable
private data class AdapterModePayload(val id: String, val name: String)

@Serializable
private data class AdapterPayload(
    val id: String,
    val name: String,
    val iconPath: String,
    val defaultModelId: String,
    val models: List<AdapterModelPayload>,
    val defaultModeId: String,
    val modes: List<AdapterModePayload>,
    val downloaded: Boolean,
    val enabled: Boolean,
    val downloadPath: String,
    val hasAuthentication: Boolean,
    val authAuthenticated: Boolean,
    val authPath: String,
    val authenticating: Boolean,
    val downloading: Boolean,
    val downloadStatus: String
)

private val adapterJson = Json { encodeDefaults = true }

/**
 * Connects AcpClientService to the JCEF/React UI.
 * Handles: startAgent, sendPrompt, loadSession (from frontend);
 * pushes content chunks, status, adapters, permissions (to frontend).
 */
class AcpBridge(
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
    private var openUrlQuery: JBCefJSQuery? = null
    private var attachFileQuery: JBCefJSQuery? = null

    private val promptJobs = ConcurrentHashMap<String, Job>()
    private val lastStatusByChatId = ConcurrentHashMap<String, String>()
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
                    // During live prompting the frontend already adds the user message,
                    // so only push the echo during replay to reconstruct the conversation.
                    if (isReplay) {
                        pushContentBlock(chatId, "user", update.content, isThought = false, isReplay = true)
                    }
                }
                is SessionUpdate.AgentMessageChunk -> {
                    pushContentBlock(chatId, "assistant", update.content, isThought = false, isReplay = isReplay)
                }
                is SessionUpdate.AgentThoughtChunk -> {
                    pushContentBlock(chatId, "assistant", update.content, isThought = true, isReplay = isReplay)
                }
                is SessionUpdate.CurrentModeUpdate -> pushMode(chatId, update.currentModeId.value)
                is SessionUpdate.ToolCall -> {
                    if (!isReplay) removeProcessedFilesForDiffs(chatId, update.content)
                    val json = try { Json.encodeToString(update) } catch (_: Exception) { update.toString() }
                    pushToolCallChunk(chatId, json, isReplay)
                }
                is SessionUpdate.ToolCallUpdate -> {
                    if (!isReplay) removeProcessedFilesForDiffs(chatId, update.content)
                    val json = try { Json.encodeToString(update) } catch (_: Exception) { update.toString() }
                    pushToolCallUpdateChunk(chatId, update.toolCallId.value, json, isReplay)
                }
                else -> {
                    if (isPlanUpdate(update, _meta)) {
                        pushPlanChunk(chatId, update, isReplay, _meta)
                } else {
                }
                }
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
                            val targetDir = File(AcpAdapterPaths.getDependenciesDir(), adapterInfo.id)
                            
                            val statusCallback = { status: String ->
                                downloadStatuses[adapterId] = status
                                pushAdapters()
                            }
                            
                            val success = AcpAdapterPaths.installAdapterRuntime(targetDir, adapterInfo, statusCallback)
                            
                            if (success) {
                                downloadStatuses.remove(adapterId)
                                pushAdapters()
                            } else {
                                downloadStatuses[adapterId] = "Error: Download failed"
                                pushAdapters()
                            }
                        } catch (e: Exception) {
                            downloadStatuses[adapterId] = "Error: ${e.message}"
                            pushAdapters()
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
                            pushContentChunk(chatId, "assistant", "text", text = "[Error: Agent is not authenticated. Please login in settings.]", isReplay = false)
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
                            pushStatus(chatId, "error")
                            pushContentChunk(chatId, "assistant", "text", text = "[Error: ${e.message ?: e.toString()}]", isReplay = false)
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
                            pushContentChunk(chatId, "assistant", "text", text = "[Error: Failed to set model '$modelId']", isReplay = false)
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
                            pushContentChunk(chatId, "assistant", "text", text = "[Error: Failed to set mode '$modeId']", isReplay = false)
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
                                    is AcpEvent.AgentText -> Unit
                                    is AcpEvent.AgentThought -> Unit
                                    is AcpEvent.PromptDone -> pushStatus(chatId, "ready")
                                    is AcpEvent.Error -> {
                                        pushContentChunk(chatId, "assistant", "text", text = "[Error: ${event.message}]", isReplay = false)
                                    }
                                }
                            }
                        } catch (e: kotlinx.coroutines.CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            pushContentChunk(chatId, "assistant", "text", text = "[Error: ${e.message ?: e.toString()}]", isReplay = false)
                            pushStatus(chatId, service.status(chatId).name.lowercase())
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
                        pushContentChunk(chatId, "assistant", "text", text = "\n\n[Cancelled]\n\n", isReplay = false)
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
                            // awaitPendingSessionUpdates is now called inside loadSession()
                            // before status transitions to Ready, guaranteeing all replay
                            // chunks have been dispatched.
                            pushStatus(chatId, service.status(chatId).name.lowercase())
                            pushSessionId(chatId, service.sessionId(chatId))
                            pushMode(chatId, service.activeModeId(chatId))
                        } catch (e: Exception) {
                            pushStatus(chatId, "error")
                            pushContentChunk(chatId, "assistant", "text", text = "[Error: ${e.message ?: e.toString()}]", isReplay = false)
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
                        val state = ChangesStateService.loadState(sessionId, adapterName)
                        val hasPluginEdits = state != null
                        pushChangesState(chatId, state ?: ChangesState(sessionId, adapterName), hasPluginEdits)
                    }
                } catch (e: Exception) {
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
                                val resolvedFile = File(resolved)
                                val base = service.project.basePath
                                val finalFile = if (resolvedFile.isAbsolute) {
                                    resolvedFile
                                } else if (!base.isNullOrBlank()) {
                                    File(base, resolved)
                                } else {
                                    resolvedFile
                                }
                                
                                val canonical = try { finalFile.canonicalPath } catch (_: Exception) { finalFile.path }
                                
                                val vf = LocalFileSystem.getInstance().refreshAndFindFileByIoFile(File(canonical))
                                if (vf != null && vf.exists()) {
                                    val line = obj["line"]?.jsonPrimitive?.intOrNull ?: -1
                                    if (line >= 0) {
                                        val descriptor = com.intellij.openapi.fileEditor.OpenFileDescriptor(service.project, vf, line, 0)
                                        FileEditorManager.getInstance(service.project).openEditor(descriptor, true)
                                    } else {
                                        FileEditorManager.getInstance(service.project).openFile(vf, true)
                                    }
                                }
                            } catch (_: Exception) {}
                        }
                    }
                } catch (_: Exception) {}
                JBCefJSQuery.Response("ok")
            }
        }

        openUrlQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { url ->
                if (url != null && url.isNotBlank()) {
                    runOnEdt {
                        try {
                            com.intellij.ide.BrowserUtil.browse(url)
                        } catch (_: Exception) {}
                    }
                }
                JBCefJSQuery.Response("ok")
            }
        }

        attachFileQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { chatId ->
                val id = chatId?.trim().orEmpty().replace("\\", "\\\\").replace("'", "\\'")
                if (id.isNotEmpty()) {
                    runOnEdt {
                        val descriptor = com.intellij.openapi.fileChooser.FileChooserDescriptor(true, false, false, false, false, true)
                        descriptor.title = "Select Files to Attach"
                        com.intellij.openapi.fileChooser.FileChooser.chooseFiles(descriptor, service.project, null) { files ->
                            val results = files.map { file ->
                                val ioFile = File(file.path)
                                val size = ioFile.length()
                                val name = file.name
                                val mimeType = java.net.URLConnection.guessContentTypeFromName(name) ?: "application/octet-stream"
                                val base64 = if (size < 2 * 1024 * 1024) {
                                    try {
                                        java.util.Base64.getEncoder().encodeToString(ioFile.readBytes())
                                    } catch (e: Exception) {
                                        null
                                    }
                                } else {
                                    null
                                }

                                val fileId = java.util.UUID.randomUUID().toString().substring(0, 8)
                                buildJsonObject {
                                    put("id", fileId)
                                    put("name", name)
                                    put("mimeType", mimeType)
                                    if (base64 != null) {
                                        put("data", base64)
                                    } else {
                                        put("path", file.path)
                                    }
                                }.toString()
                            }
                            
                            val jsonArrayStr = results.joinToString(",")
                            browser.cefBrowser.executeJavaScript(
                                "if(window.__onAttachmentsAdded) window.__onAttachmentsAdded('$id', [$jsonArrayStr]);",
                                browser.cefBrowser.url, 0
                            )
                        }
                    }
                }
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
        val openUrlInject = decorateQueryInject(
            openUrlQuery?.inject("url") ?: "",
            "openUrl"
        )
        val attachFileInject = decorateQueryInject(
            attachFileQuery?.inject("chatId") ?: "",
            "attachFile"
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
                window.__openUrl = function(url) {
                    try { $openUrlInject } catch (e) { }
                };
                window.__attachFile = function(chatId) {
                    try { $attachFileInject } catch (e) { }
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
            window.__onContentChunk = window.__onContentChunk || function(payload) {};
            window.__onStatus = window.__onStatus || function(chatId, status) {};
            window.__onSessionId = window.__onSessionId || function(chatId, id) {};
            window.__onAdapters = window.__onAdapters || function(adapters) {};
            window.__onMode = window.__onMode || function(chatId, modeId) {};
            window.__onPermissionRequest = window.__onPermissionRequest || function(request) {};
            window.__respondPermission = window.__respondPermission || function(requestId, decision) {};
            window.__stopAgent = window.__stopAgent || function(chatId) {};
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
            window.__attachFile = window.__attachFile || function(chatId) {};
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

    /**
     * Unified content delivery: ALL content (live streaming + history replay) goes
     * through this single method → single __onContentChunk JS callback.
     * The frontend processes every chunk with one and the same code path.
     */
    fun pushContentChunk(chatId: String, role: String, type: String, text: String? = null, data: String? = null, mimeType: String? = null, isReplay: Boolean = false) {
        val parts = mutableListOf<String>()
        parts.add("\"chatId\":${escapeJsonString(chatId)}")
        parts.add("\"role\":${escapeJsonString(role)}")
        parts.add("\"type\":${escapeJsonString(type)}")
        if (text != null) parts.add("\"text\":${escapeJsonString(text)}")
        if (data != null) parts.add("\"data\":${escapeJsonString(data)}")
        if (mimeType != null) parts.add("\"mimeType\":${escapeJsonString(mimeType)}")
        parts.add("\"isReplay\":$isReplay")
        val json = "{${parts.joinToString(",")}}"
        runOnEdt {
            browser.cefBrowser.executeJavaScript(
                "if(window.__onContentChunk) window.__onContentChunk($json);",
                browser.cefBrowser.url, 0
            )
        }
    }

    /** Convenience: send a ContentBlock from the ACP SDK through the unified pipeline. */
    private fun pushContentBlock(chatId: String, role: String, content: ContentBlock, isThought: Boolean, isReplay: Boolean) {
        when (content) {
            is ContentBlock.Text -> {
                val type = if (isThought) "thinking" else "text"
                pushContentChunk(chatId, role, type, text = content.text, isReplay = isReplay)
            }
            is ContentBlock.Image -> {
                pushContentChunk(chatId, role, "image", data = content.data, mimeType = content.mimeType, isReplay = isReplay)
            }
            is ContentBlock.Audio -> {
                pushContentChunk(chatId, role, "audio", data = content.data, mimeType = content.mimeType, isReplay = isReplay)
            }
            is ContentBlock.ResourceLink -> {
                // Determine if it's a data URI or a real path
                if (content.uri.startsWith("data:")) {
                    val base64 = content.uri.substringAfter("base64,")
                    pushContentChunk(chatId, role, "file", data = base64, mimeType = content.mimeType, isReplay = isReplay)
                } else {
                    pushContentChunk(chatId, role, "file", text = "[File: ${content.uri}]", mimeType = content.mimeType, isReplay = isReplay)
                }
            }
            is ContentBlock.Resource -> {
                when (val res = content.resource) {
                    is EmbeddedResourceResource.BlobResourceContents -> {
                        pushContentChunk(chatId, role, "file", data = res.blob, mimeType = res.mimeType, isReplay = isReplay)
                    }
                    is EmbeddedResourceResource.TextResourceContents -> {
                        pushContentChunk(chatId, role, "file", text = res.text, mimeType = res.mimeType, isReplay = isReplay)
                    }
                }
            }
        }
    }

    fun pushToolCallChunk(chatId: String, rawJson: String, isReplay: Boolean = false) {
        val parsed = try { Json.parseToJsonElement(rawJson).jsonObject } catch (_: Exception) { null }
        val toolCallId = parsed?.get("toolCallId")?.jsonPrimitive?.contentOrNull ?: ""
        val kind = parsed?.get("kind")?.jsonPrimitive?.contentOrNull ?: ""
        val title = parsed?.get("title")?.jsonPrimitive?.contentOrNull ?: ""
        val status = parsed?.get("status")?.jsonPrimitive?.contentOrNull ?: ""

        val parts = mutableListOf<String>()
        parts.add("\"chatId\":${escapeJsonString(chatId)}")
        parts.add("\"role\":\"assistant\"")
        parts.add("\"type\":\"tool_call\"")
        parts.add("\"isReplay\":$isReplay")
        parts.add("\"toolCallId\":${escapeJsonString(toolCallId)}")
        parts.add("\"toolKind\":${escapeJsonString(kind)}")
        parts.add("\"toolTitle\":${escapeJsonString(title)}")
        parts.add("\"toolStatus\":${escapeJsonString(status)}")
        parts.add("\"toolRawJson\":${escapeJsonString(rawJson)}")
        val json = "{${parts.joinToString(",")}}"
        runOnEdt {
            browser.cefBrowser.executeJavaScript(
                "if(window.__onContentChunk) window.__onContentChunk($json);",
                browser.cefBrowser.url, 0
            )
        }
    }

    fun pushToolCallUpdateChunk(chatId: String, toolCallId: String, rawJson: String, isReplay: Boolean = false) {
        val parts = mutableListOf<String>()
        parts.add("\"chatId\":${escapeJsonString(chatId)}")
        parts.add("\"role\":\"assistant\"")
        parts.add("\"type\":\"tool_call_update\"")
        parts.add("\"isReplay\":$isReplay")
        parts.add("\"toolCallId\":${escapeJsonString(toolCallId)}")
        parts.add("\"toolRawJson\":${escapeJsonString(rawJson)}")
        val json = "{${parts.joinToString(",")}}"
        runOnEdt {
            browser.cefBrowser.executeJavaScript(
                "if(window.__onContentChunk) window.__onContentChunk($json);",
                browser.cefBrowser.url, 0
            )
        }
    }


    private fun isPlanUpdate(update: SessionUpdate, _meta: JsonElement?): Boolean {
        // Check via raw JSON-RPC metadata (available during replay)
        if (_meta is JsonObject) {
            val updateObj = _meta["update"]?.jsonObject ?: _meta
            if (updateObj["sessionUpdate"]?.jsonPrimitive?.contentOrNull == "plan") return true
        }
        // Check via serialized update object (available during prompting)
        return try {
            val parsed = Json.parseToJsonElement(Json.encodeToString(update)).jsonObject
            parsed["sessionUpdate"]?.jsonPrimitive?.contentOrNull == "plan"
        } catch (_: Exception) { false }
    }

    private fun extractPlanEntries(plan: SessionUpdate, _meta: JsonElement?): JsonArray? {
        // 1. Try _meta (raw JSON-RPC params, available during replay)
        if (_meta is JsonObject) {
            val updateObj = _meta["update"]?.jsonObject ?: _meta
            updateObj["entries"]?.jsonArray?.let { return it }
        }
        // 2. Fallback: serialize the plan object (during prompting, _meta is null)
        return try {
            Json.parseToJsonElement(Json.encodeToString(plan)).jsonObject["entries"]?.jsonArray
        } catch (_: Exception) { null }
    }

    fun pushPlanChunk(chatId: String, plan: SessionUpdate, isReplay: Boolean = false, _meta: JsonElement? = null) {
        val entries = try {
            extractPlanEntries(plan, _meta)
        } catch (e: Exception) {
            null
        }

        if (entries == null || entries.isEmpty()) {
            return
        }

        val chunk = buildJsonObject {
            put("chatId", chatId)
            put("role", "assistant")
            put("type", "plan")
            put("isReplay", isReplay)
            put("planEntries", entries)
        }

        val json = chunk.toString()
        runOnEdt {
            browser.cefBrowser.executeJavaScript(
                "if(window.__onContentChunk) window.__onContentChunk($json);",
                browser.cefBrowser.url, 0
            )
        }
    }


    fun pushStatus(chatId: String, status: String) {
        val previousStatus = lastStatusByChatId.put(chatId, status)
        val escaped = status.replace("\\", "\\\\").replace("'", "\\'")
        val id = chatId.replace("\\", "\\\\").replace("'", "\\'")
        runOnEdt {
            browser.cefBrowser.executeJavaScript(
                "if(window.__onStatus) window.__onStatus('$id', '$escaped');",
                browser.cefBrowser.url, 0
            )
        }
        if (previousStatus == "prompting" && status == "ready") {
            playResponseCompleteSound()
        }
    }

    fun pushMode(chatId: String, modeId: String?) {
        if (modeId == null) return
        val escaped = modeId.replace("\\", "\\\\").replace("'", "\\'")
        val id = chatId.replace("\\", "\\\\").replace("'", "\\'")
        runOnEdt {
            browser.cefBrowser.executeJavaScript(
                "if(window.__onMode) window.__onMode('$id', '$escaped');",
                browser.cefBrowser.url, 0
            )
        }
    }

    fun pushSessionId(chatId: String, sid: String?) {
        if (sid == null) return
        val escaped = sid.replace("\\", "\\\\").replace("'", "\\'")
        val id = chatId.replace("\\", "\\\\").replace("'", "\\'")
        runOnEdt {
            browser.cefBrowser.executeJavaScript(
                "if(window.__onSessionId) window.__onSessionId('$id', '$escaped');",
                browser.cefBrowser.url, 0
            )
        }
    }

    fun pushPermissionRequest(request: PermissionRequest) {
        val escapedTitle = request.title.escapeForJsString()
        val escapedChatId = request.chatId.replace("\\", "\\\\").replace("'", "\\'")
        val optionsJson = request.options.joinToString(",") { opt ->
            "{optionId: '${opt.optionId.value.escapeForJsString()}', label: '${opt.name.escapeForJsString()}'}"
        }
        runOnEdt {
            browser.cefBrowser.executeJavaScript(
                "if(window.__onPermissionRequest) window.__onPermissionRequest({ requestId: '${request.requestId}', chatId: '$escapedChatId', title: '$escapedTitle', options: [$optionsJson] });",
                browser.cefBrowser.url, 0
            )
        }
        playPermissionRequestSound()
    }

    private fun playResponseCompleteSound() {
        playSound("/sounds/notification.wav")
    }

    private fun playPermissionRequestSound() {
        playSound("/sounds/request.wav")
    }

    private fun playSound(resourcePath: String) {
        scope.launch(Dispatchers.IO) {
            try {
                val resourceStream = AcpBridge::class.java.getResourceAsStream(resourcePath)
                if (resourceStream == null) {
                    return@launch
                }
                BufferedInputStream(resourceStream).use { bufferedStream ->
                    AudioSystem.getAudioInputStream(bufferedStream).use { sourceStream ->
                        val sourceFormat = sourceStream.format
                        val decodedFormat = AudioFormat(
                            AudioFormat.Encoding.PCM_SIGNED,
                            sourceFormat.sampleRate,
                            16,
                            sourceFormat.channels,
                            sourceFormat.channels * 2,
                            sourceFormat.sampleRate,
                            false
                        )

                        val playableStream =
                            if (sourceFormat.encoding == AudioFormat.Encoding.PCM_SIGNED && sourceFormat.sampleSizeInBits == 16) {
                                sourceStream
                            } else {
                                AudioSystem.getAudioInputStream(decodedFormat, sourceStream)
                            }

                        playableStream.use { audioStream ->
                            val clip = AudioSystem.getClip()
                            clip.addLineListener { event ->
                                if (event.type == LineEvent.Type.STOP) {
                                    clip.close()
                                }
                            }
                            clip.open(audioStream)
                            clip.start()
                        }
                    }
                }
            } catch (e: Exception) {
            }
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

    fun pushChangesState(chatId: String, state: ChangesState, hasPluginEdits: Boolean) {
        val hasPluginEditsStr = if (hasPluginEdits) "true" else "false"
        val processedJson = state.processedFiles.joinToString(",") { escapeJsonString(it) }
        val payload = """{"sessionId":${escapeJsonString(state.sessionId)},"adapterName":${escapeJsonString(state.adapterName)},"baseToolCallIndex":${state.baseToolCallIndex},"processedFiles":[$processedJson],"hasPluginEdits":$hasPluginEditsStr}"""
        val id = chatId.replace("\\", "\\\\").replace("'", "\\'")
        val escaped = payload.escapeForJsString()
        runOnEdt {
            browser.cefBrowser.executeJavaScript(
                "if(window.__onChangesState) window.__onChangesState('$id', JSON.parse('$escaped'));",
                browser.cefBrowser.url, 0
            )
        }
    }

    /**
     * When the agent modifies files in a live (non-replay) tool call, remove those paths from
     * processedFiles so they show again in Edits. Only called when isReplay == false.
     */
    private fun removeProcessedFilesForDiffs(chatId: String, content: List<ToolCallContent>?) {
        val sessionId = service.sessionId(chatId) ?: return
        val adNameValue = service.activeAdapterName(chatId) ?: return
        val diffs = content?.filterIsInstance<ToolCallContent.Diff>() ?: return
        if (diffs.isEmpty()) return

        // First live diff from this plugin should persist state file and mark Edits panel as plugin-owned.
        if (!ChangesStateService.hasState(sessionId, adNameValue)) {
            ChangesStateService.ensureState(sessionId, adNameValue)
        }

        val paths = diffs.map { it.path }
        ChangesStateService.removeProcessedFiles(sessionId, adNameValue, paths)
        val state = ChangesStateService.loadState(sessionId, adNameValue) ?: ChangesStateService.ensureState(sessionId, adNameValue)
        pushChangesState(chatId, state, true)
    }

    fun pushAdapters() {
        try {
            val unique = linkedMapOf<String, AcpAdapterConfig.AdapterInfo>()
            AcpAdapterConfig.getAllAdapters().values.forEach { info -> unique[info.id] = info }

            val adapters = unique.values.sortedBy { it.name.lowercase() }.map { info ->
                val downloaded = AcpAdapterPaths.isDownloaded(info.id)
                val authStatus = AcpAuthService.getAuthStatus(info.id)
                val dlStatus = downloadStatuses[info.id] ?: ""

                // Inline SVG icons as base64 so they load correctly in JCEF
                val iconBase64 = info.iconPath?.let { path ->
                    try {
                        val stream = AcpAdapterConfig::class.java.getResourceAsStream(path)
                        if (stream != null) {
                            val bytes = stream.use { it.readBytes() }
                            val b64 = java.util.Base64.getEncoder().encodeToString(bytes)
                            "data:image/svg+xml;base64,$b64"
                        } else ""
                    } catch (e: Exception) {
                        ""
                    }
                } ?: ""

                AdapterPayload(
                    id = info.id,
                    name = info.name,
                    iconPath = iconBase64,
                    defaultModelId = info.defaultModelId ?: "",
                    models = info.models.map { AdapterModelPayload(it.modelId, it.name) },
                    defaultModeId = info.defaultModeId ?: "",
                    modes = info.modes.map { AdapterModePayload(it.id, it.name) },
                    downloaded = downloaded,
                    enabled = AcpAgentSettings.isEnabled(info.id),
                    downloadPath = if (downloaded) AcpAdapterPaths.getDownloadPath(info.id) else "",
                    hasAuthentication = info.authConfig != null,
                    authAuthenticated = authStatus.authenticated,
                    authPath = authStatus.authPath ?: "",
                    authenticating = AcpAuthService.isAuthenticating(info.id),
                    downloading = dlStatus.isNotEmpty() && !dlStatus.startsWith("Error"),
                    downloadStatus = dlStatus
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
    
    /** Converts a file/video frontend block into an ACP ContentBlock. */
    private fun fileOrVideoBlock(name: String, mimeType: String, data: String?, path: String?): ContentBlock {
        if (data != null) {
            val uri = if (path != null) "file:///${path.replace("\\", "/").trimStart('/')}" else "file:///$name"
            return ContentBlock.Resource(
                resource = EmbeddedResourceResource.BlobResourceContents(blob = data, uri = uri, mimeType = mimeType)
            )
        }
        if (path != null) {
            return ContentBlock.ResourceLink(
                name = name, uri = "file:///${path.replace("\\", "/").trimStart('/')}", mimeType = mimeType
            )
        }
        return ContentBlock.Text("[File: $name]")
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

    private fun codeRefBlockToText(blockObj: JsonObject): ContentBlock.Text {
        val path = blockObj["path"]?.jsonPrimitive?.content ?: ""
        val startLine = blockObj["startLine"]?.jsonPrimitive?.intOrNull
        val endLine = blockObj["endLine"]?.jsonPrimitive?.intOrNull ?: startLine
        val text = if (path.isNotBlank() && startLine != null && startLine > 0) {
            if (startLine == endLine) "@${path}#L${startLine}" else "@${path}#L${startLine}-${endLine}"
        } else if (path.isNotBlank()) {
            "@${path}"
        } else {
            blockObj["text"]?.jsonPrimitive?.content ?: ""
        }
        return ContentBlock.Text(text)
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
                        "audio" -> {
                            val data = blockObj["data"]?.jsonPrimitive?.content ?: ""
                            val mimeType = blockObj["mimeType"]?.jsonPrimitive?.content ?: "audio/wav"
                            ContentBlock.Audio(data, mimeType)
                        }
                         "video", "file" -> {
                             val data = blockObj["data"]?.jsonPrimitive?.content
                             val path = blockObj["path"]?.jsonPrimitive?.content
                             val defaultMime = if (type == "video") "video/mp4" else "application/octet-stream"
                             val mimeType = blockObj["mimeType"]?.jsonPrimitive?.content ?: defaultMime
                             val name = blockObj["name"]?.jsonPrimitive?.content ?: type!!
                             fileOrVideoBlock(name, mimeType, data, path)
                         }
                        "code_ref" -> codeRefBlockToText(blockObj)
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
                            "audio" -> {
                                val data = blockObj["data"]?.jsonPrimitive?.content ?: ""
                                val mimeType = blockObj["mimeType"]?.jsonPrimitive?.content ?: "audio/wav"
                                ContentBlock.Audio(data, mimeType)
                            }
                            "video", "file" -> {
                                val data = blockObj["data"]?.jsonPrimitive?.content
                                val path = blockObj["path"]?.jsonPrimitive?.content
                                val defaultMime = if (type == "video") "video/mp4" else "application/octet-stream"
                                val mimeType = blockObj["mimeType"]?.jsonPrimitive?.content ?: defaultMime
                                val name = blockObj["name"]?.jsonPrimitive?.content ?: type!!
                                fileOrVideoBlock(name, mimeType, data, path)
                            }
                            "code_ref" -> codeRefBlockToText(blockObj)
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
