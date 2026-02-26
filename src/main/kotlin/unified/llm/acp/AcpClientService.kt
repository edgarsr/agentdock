package unified.llm.acp

import com.agentclientprotocol.client.Client
import com.agentclientprotocol.client.ClientInfo
import com.agentclientprotocol.client.ClientOperationsFactory
import com.agentclientprotocol.client.ClientSession
import com.agentclientprotocol.common.ClientSessionOperations
import com.agentclientprotocol.common.Event
import com.agentclientprotocol.common.SessionCreationParameters
import com.agentclientprotocol.model.*
import java.io.File
import java.io.InputStream
import com.agentclientprotocol.model.LATEST_PROTOCOL_VERSION
import com.agentclientprotocol.model.AcpMethod
import com.agentclientprotocol.protocol.Protocol
import com.agentclientprotocol.rpc.JsonRpcNotification
import com.agentclientprotocol.rpc.MethodName
import com.agentclientprotocol.transport.StdioTransport
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.withContext
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.io.asSource
import kotlinx.io.buffered
import kotlinx.io.asSink
import kotlinx.serialization.json.*
import kotlinx.atomicfu.AtomicRef
import kotlinx.collections.immutable.PersistentMap
import java.io.ByteArrayOutputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicReference
import java.util.UUID

private val log = Logger.getInstance(AcpClientService::class.java)

data class PermissionRequest(
    val requestId: String,
    val chatId: String,
    val description: String,
    val options: List<PermissionOption>
)

class AcpClientService(val project: Project) {
    @Volatile
    private var logCallback: ((AcpLogEntry) -> Unit)? = null

    fun setOnLogEntry(callback: (AcpLogEntry) -> Unit) {
        logCallback = callback
    }

    private fun onLogEntry(entry: AcpLogEntry) {
        logCallback?.invoke(entry)
    }

    @Volatile
    private var permissionRequestHandler: ((PermissionRequest) -> Unit)? = null

    fun setOnPermissionRequest(handler: (PermissionRequest) -> Unit) {
        permissionRequestHandler = handler
    }
    
    @Volatile
    private var sessionUpdateHandler: ((String, SessionUpdate, Boolean, JsonElement?) -> Unit)? = null

    fun setOnSessionUpdate(handler: (String, SessionUpdate, Boolean, JsonElement?) -> Unit) {
        sessionUpdateHandler = handler
    }

    fun activeAdapterName(chatId: String): String? = sessions[chatId]?.activeAdapterNameRef?.get()

    enum class Status { NotStarted, Initializing, Ready, Prompting, Error }

    private inner class SharedProcess(val adapterName: String) {
        val mutex = Mutex()
        @Volatile var process: Process? = null
        @Volatile var client: Client? = null
        @Volatile var protocol: Protocol? = null
        @Volatile var isInitialized: Boolean = false
        @Volatile var sessionUpdateWrapped: Boolean = false
        @Volatile var sessionUpdateScope: CoroutineScope? = null
        @Volatile var sessionUpdateQueue: Channel<JsonRpcNotification>? = null
        @Volatile var sessionUpdateWorker: Job? = null

        fun stop() {
            process?.destroyForcibly()
            process = null
            client = null
            protocol = null
            isInitialized = false
            sessionUpdateQueue?.close()
            sessionUpdateQueue = null
            sessionUpdateWorker?.cancel()
            sessionUpdateWorker = null
            sessionUpdateScope?.coroutineContext?.cancel()
            sessionUpdateScope = null
            sessionUpdateWrapped = false
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val sessions = ConcurrentHashMap<String, AgentContext>()
    private val activeProcesses = ConcurrentHashMap<String, SharedProcess>()
    
    fun status(chatId: String): Status = sessions[chatId]?.statusRef?.get() ?: Status.NotStarted
    fun sessionId(chatId: String): String? = sessions[chatId]?.sessionIdRef?.get()
    fun activeModeId(chatId: String): String? = sessions[chatId]?.activeModeIdRef?.get()

    fun getAvailableModels(adapterName: String? = null): List<AcpAdapterConfig.ModelInfo> {
        val name = adapterName ?: AcpAdapterPaths.resolveAdapterName(null)
        if (!AcpAgentSettings.isEnabled(name) || !AcpAdapterPaths.isDownloaded(name)) {
            return emptyList()
        }
        return AcpAdapterPaths.getAdapterInfo(name).models
    }

    private inner class AgentContext(val chatId: String) {
        val lifecycleMutex = Mutex()
        val statusRef = AtomicReference(Status.NotStarted)
        val sessionIdRef = AtomicReference<String?>(null)
        val activeAdapterNameRef = AtomicReference<String?>(null)
        val activeModelIdRef = AtomicReference<String?>(null)
        val activeModeIdRef = AtomicReference<String?>(null)
        @Volatile var lastHistoryLoadTime: Long = System.currentTimeMillis()
        
        val pendingRequests = ConcurrentHashMap<String, CompletableDeferred<RequestPermissionResponse>>()

        @Volatile var sharedProcess: SharedProcess? = null
        @Volatile var session: ClientSession? = null
        
        fun stop() {
            session = null
            sharedProcess = null
            statusRef.set(Status.NotStarted)
            sessionIdRef.set(null)
            activeAdapterNameRef.set(null)
            activeModelIdRef.set(null)
            activeModeIdRef.set(null)
            lastHistoryLoadTime = 0
            pendingRequests.values.forEach { 
                it.complete(RequestPermissionResponse(RequestPermissionOutcome.Cancelled)) 
            }
            pendingRequests.clear()
        }
    }

    @Suppress("OPT_IN_USAGE")
    suspend fun startAgent(
        chatId: String,
        adapterName: String? = null,
        preferredModelId: String? = null,
        resumeSessionId: String? = null,
        forceRestart: Boolean = false
    ) {
        val context = sessions.computeIfAbsent(chatId) { AgentContext(chatId) }

        withContext(Dispatchers.IO) {
            context.lifecycleMutex.withLock {
                val adapterInfo = AcpAdapterPaths.getAdapterInfo(adapterName)
                val requestedAdapterName = adapterInfo.name
                val currentStatus = context.statusRef.get()

                if (currentStatus == Status.Ready && context.activeAdapterNameRef.get() == requestedAdapterName && resumeSessionId == null && !forceRestart) {
                    return@withLock
                }

                if (currentStatus != Status.NotStarted) {
                    context.stop()
                }

                if (!AcpAgentSettings.isEnabled(requestedAdapterName)) {
                    val msg = "Agent '$requestedAdapterName' is disabled in settings"
                    log.warn("[$chatId] $msg")
                    context.statusRef.set(Status.Error)
                    throw IllegalStateException(msg)
                }
                
                if (!AcpAdapterPaths.isDownloaded(requestedAdapterName)) {
                    val msg = "Agent '$requestedAdapterName' is not downloaded"
                    log.warn("[$chatId] $msg")
                    context.statusRef.set(Status.Error)
                    throw IllegalStateException(msg)
                }

                context.statusRef.set(Status.Initializing)

                try {
                    val sharedProc = activeProcesses.computeIfAbsent(requestedAdapterName) { SharedProcess(requestedAdapterName) }
                    context.sharedProcess = sharedProc

                    ensureSharedProcessStarted(sharedProc, adapterInfo, context, chatId, forceRestart)
                    ensureAsyncSessionUpdates(sharedProc)

                    val client = sharedProc.client!!
                    val cwd = project.basePath ?: System.getProperty("user.dir")
                    
                    val factory = object : ClientOperationsFactory {
                        override suspend fun createClientOperations(
                            sessionId: SessionId, 
                            sessionResponse: AcpCreatedSessionResponse
                        ): ClientSessionOperations {
                            context.sessionIdRef.compareAndSet(null, sessionId.value)
                            return this@AcpClientService.SharedSessionOperations(sessionId.value)
                        }
                    }

                    val params = SessionCreationParameters(cwd = cwd, mcpServers = emptyList())
                    val sess = if (resumeSessionId != null) {
                        try {
                            client.resumeSession(SessionId(resumeSessionId), params, factory)
                        } catch (e: Exception) {
                            log.warn("[$chatId] Resume session failed for $resumeSessionId, falling back to new session", e)
                            client.newSession(params, factory)
                        }
                    } else {
                        client.newSession(params, factory)
                    }

                    context.session = sess
                    context.sessionIdRef.set(sess.sessionId.value)

                    val selectedModelId = resolveModelToApply(preferredModelId, adapterInfo.models, adapterInfo.defaultModelId)
                    if (selectedModelId != null) {
                        try {
                            sess.setModel(ModelId(selectedModelId))
                            context.activeModelIdRef.set(selectedModelId)
                            log.info("[$chatId] Startup model set to $selectedModelId")
                        } catch (e: Exception) {
                            log.warn("[$chatId] Failed to set startup model to $selectedModelId", e)
                        }
                    }

                    val defaultModeId = adapterInfo.defaultModeId
                    if (defaultModeId != null) {
                        try {
                            sess.setMode(SessionModeId(defaultModeId))
                            context.activeModeIdRef.set(defaultModeId)
                            log.info("[$chatId] Startup mode set to $defaultModeId")
                        } catch (e: Exception) {
                            log.warn("[$chatId] Failed to set startup mode to $defaultModeId", e)
                        }
                    }

                    context.activeAdapterNameRef.set(requestedAdapterName)
                    context.statusRef.set(Status.Ready)

                } catch (e: Exception) {
                    log.error("Failed to start/attach to agent for $chatId", e)
                    context.stop()
                    context.statusRef.set(Status.Error)
                    throw e
                }
            }
        }
    }

    @Suppress("OPT_IN_USAGE")
    suspend fun loadSession(
        chatId: String,
        adapterName: String,
        sessionId: String,
        preferredModelId: String? = null,
        preferredModeId: String? = null
    ) {
        val context = sessions.computeIfAbsent(chatId) { AgentContext(chatId) }

        withContext(Dispatchers.IO) {
            context.lifecycleMutex.withLock {
                val adapterInfo = AcpAdapterPaths.getAdapterInfo(adapterName)
                val requestedAdapterName = adapterInfo.name
                val currentStatus = context.statusRef.get()

                if (currentStatus != Status.NotStarted) {
                    context.stop()
                }

                context.statusRef.set(Status.Initializing)
                context.lastHistoryLoadTime = System.currentTimeMillis()

                try {
                    val sharedProc = activeProcesses.computeIfAbsent(requestedAdapterName) { SharedProcess(requestedAdapterName) }
                    context.sharedProcess = sharedProc

                    ensureSharedProcessStarted(sharedProc, adapterInfo, context, chatId)
                    ensureAsyncSessionUpdates(sharedProc)

                    // Set sessionIdRef BEFORE client.loadSession() so that the async
                    // notification worker can match this context for the very first
                    // replay notification. Without this, early chunks (including the
                    // first user message) are lost because sessionIdRef is still null
                    // when notify() runs.
                    context.sessionIdRef.set(sessionId)

                    val client = sharedProc.client!!
                    val cwd = project.basePath ?: System.getProperty("user.dir")
                    
                    val factory = object : ClientOperationsFactory {
                        override suspend fun createClientOperations(
                            sessionId: SessionId, 
                            sessionResponse: AcpCreatedSessionResponse
                        ): ClientSessionOperations {
                            // sessionIdRef is already set above
                            return this@AcpClientService.SharedSessionOperations(sessionId.value)
                        }
                    }

                    val params = SessionCreationParameters(cwd = cwd, mcpServers = emptyList())
                    val sess = client.loadSession(SessionId(sessionId), params, factory)

                    context.session = sess

                    context.activeAdapterNameRef.set(requestedAdapterName)

                    if (sess.modesSupported) {
                        context.activeModeIdRef.set(sess.currentMode.value.value)
                    } else if (!preferredModeId.isNullOrBlank()) {
                        context.activeModeIdRef.set(preferredModeId.trim())
                    }
                    @OptIn(com.agentclientprotocol.annotations.UnstableApi::class)
                    if (sess.modelsSupported) {
                        context.activeModelIdRef.set(sess.currentModel.value.value)
                    } else if (!preferredModelId.isNullOrBlank()) {
                        context.activeModelIdRef.set(preferredModelId.trim())
                    }

                    // Drain the async notification queue BEFORE changing status.
                    // While status is Initializing, notify() delivers replay chunks.
                    // After this completes, ALL replay notifications have been dispatched.
                    awaitPendingSessionUpdates(requestedAdapterName)

                    context.statusRef.set(Status.Ready)
                } catch (e: Exception) {
                    log.error("Failed to load session for $chatId", e)
                    context.stop()
                    context.statusRef.set(Status.Error)
                    throw e
                }
            }
        }
    }

    @Suppress("OPT_IN_USAGE")
    suspend fun setModel(chatId: String, modelId: String): Boolean {
        val context = sessions[chatId] ?: return false
        val trimmedModelId = modelId.trim()
        val currentModelId = context.activeModelIdRef.get()
        if (currentModelId == trimmedModelId) {
            log.debug("[$chatId] setModel: already in model $trimmedModelId, skipping")
            return true
        }

        val adapterName = context.activeAdapterNameRef.get() ?: return false
        val adapterInfo = AcpAdapterPaths.getAdapterInfo(adapterName)
        
        return when (adapterInfo.modelChangeStrategy) {
            "restart-resume" -> {
                try {
                    startAgent(chatId, adapterName, trimmedModelId, context.sessionIdRef.get())
                    true
                } catch (e: Exception) {
                    false
                }
            }
            "restart" -> {
                try {
                    startAgent(chatId, adapterName, trimmedModelId, resumeSessionId = null, forceRestart = true)
                    true
                } catch (e: Exception) {
                    false
                }
            }
            "in-session" -> {
                val sess = context.session ?: return false
                try {
                    withContext(Dispatchers.IO) { 
                        sess.setModel(ModelId(trimmedModelId)) 
                    }
                    context.activeModelIdRef.set(trimmedModelId)
                    log.info("[$chatId] Model changed to $trimmedModelId (in-session)")
                    true
                } catch (e: Exception) {
                    log.warn("[$chatId] Failed to set model", e)
                    false
                }
            }
            else -> {
                try {
                    startAgent(chatId, adapterName, trimmedModelId)
                    true
                } catch (e: Exception) {
                    false
                }
            }
        }
    }

    @Suppress("OPT_IN_USAGE")
    suspend fun setMode(chatId: String, modeId: String): Boolean {
        val context = sessions[chatId] ?: return false
        val trimmedModeId = modeId.trim()
        if (context.activeModeIdRef.get() == trimmedModeId) {
            return true
        }

        val sess = context.session ?: return false
        return try {
            withContext(Dispatchers.IO) { 
                sess.setMode(SessionModeId(trimmedModeId)) 
            }
            context.activeModeIdRef.set(trimmedModeId)
            log.info("[$chatId] Mode changed to $trimmedModeId")
            true
        } catch (e: Exception) {
            log.warn("[$chatId] Failed to set mode", e)
            false
        }
    }

    fun respondToPermissionRequest(requestId: String, decision: String) {
        for (ctx in sessions.values) {
            val deferred = ctx.pendingRequests.remove(requestId)
            if (deferred != null) {
                val response = if (decision == "deny") {
                    RequestPermissionResponse(RequestPermissionOutcome.Cancelled)
                } else {
                    RequestPermissionResponse(RequestPermissionOutcome.Selected(PermissionOptionId(decision)))
                }
                deferred.complete(response)
                return
            }
        }
    }

    fun prompt(chatId: String, blocks: List<ContentBlock>): Flow<AcpEvent> = flow {
        val context = sessions[chatId]
        if (context == null) {
            emit(AcpEvent.Error("No session for $chatId"))
            return@flow
        }

        // Wait for any ongoing initialization/restart to finish
        val sess = context.lifecycleMutex.withLock {
            val s = context.session
            if (s == null) {
                emit(AcpEvent.Error("No session for $chatId; start agent first"))
                return@flow
            }
            s
        }

        context.statusRef.set(Status.Prompting)
        try {
            sess.prompt(blocks).collect { event ->
                when (event) {
                    is Event.SessionUpdateEvent -> {
                        val update = event.update
                        if (update is SessionUpdate.AgentMessageChunk) {
                            val content = update.content
                            if (content is ContentBlock.Text) {
                                emit(AcpEvent.AgentText(content.text))
                            }
                        } else if (update is SessionUpdate.AgentThoughtChunk) {
                            val content = update.content
                            if (content is ContentBlock.Text) {
                                emit(AcpEvent.AgentThought(content.text))
                            }
                        }
                        // Forward ToolCall/ToolCallUpdate and Plan to bridge (isReplay = false: we are in Prompting)
                        if (update is SessionUpdate.ToolCall || update is SessionUpdate.ToolCallUpdate || update.javaClass.simpleName == "Plan") {
                            // Only pass _meta if the event type supports it. For now, we'll try to access it if possible 
                            // or pass null if Event.SessionUpdateEvent doesn't have it.
                            // Assuming Event.SessionUpdateEvent does NOT have _meta based on errors.
                            sessionUpdateHandler?.invoke(chatId, update, false, null)
                        }
                    }
                    is Event.PromptResponseEvent -> {
                        emit(AcpEvent.PromptDone(event.response.stopReason.toString()))
                    }
                }
            }
        } finally {
            context.statusRef.set(Status.Ready)
        }
    }

    suspend fun cancel(chatId: String) {
        val context = sessions[chatId] ?: return
        cancelWithContext(context)
    }

    private suspend fun cancelWithContext(context: AgentContext) {
        // Wait for lock to ensure we don't cancel a session while it's being swapped
        val sess = context.lifecycleMutex.withLock { context.session } ?: return
        try {
            sess.cancel()
            log.info("[${context.chatId}] session/cancel sent")
        } catch (e: Exception) {
            log.warn("[${context.chatId}] Failed to cancel", e)
        }
    }

    suspend fun stopAgent(chatId: String) {
        val context = sessions[chatId] ?: return
        cancelWithContext(context)
        sessions.remove(chatId)
        context.stop()
    }

    fun stopSharedProcess(adapterName: String) {
        val shared = activeProcesses.remove(adapterName)
        shared?.stop()
        // Also stop any contexts using this process
        sessions.values.filter { it.sharedProcess == shared }.forEach { it.stop() }
    }

    fun shutdown() {
        scope.coroutineContext[Job]?.cancel()
        sessions.values.forEach { it.stop() }
        sessions.clear()
        activeProcesses.values.forEach { it.stop() }
        activeProcesses.clear()
    }

    /**
     * Wait for all queued session/update notifications to be processed.
     * Because the worker runs on limitedParallelism(1), scheduling a new coroutine
     * on the same scope will only execute after the worker suspends (queue drained).
     */
    suspend fun awaitPendingSessionUpdates(adapterName: String) {
        val sharedProc = activeProcesses[adapterName] ?: return
        val updateScope = sharedProc.sessionUpdateScope ?: return
        val completed = CompletableDeferred<Unit>()
        updateScope.launch { completed.complete(Unit) }
        completed.await()
    }

    private fun resolveModelToApply(
        pref: String?,
        available: List<AcpAdapterConfig.ModelInfo>,
        default: String?
    ): String? {
        val p = pref?.trim().takeUnless { it.isNullOrEmpty() }
        if (p != null && (available.isEmpty() || available.any { it.id == p })) {
            return p
        }
        return default
    }

    /**
     * Ensures that a shared ACP process is started for the given adapter.
     * If the process is already running and healthy, does nothing.
     * Otherwise, starts a new process and initializes the ACP client.
     */
    private suspend fun ensureSharedProcessStarted(
        sharedProc: SharedProcess,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        context: AgentContext,
        chatId: String,
        forceRestart: Boolean = false
    ) {
        val requestedAdapterName = adapterInfo.name
        sharedProc.mutex.withLock {
            val needsRestart = sharedProc.process == null || !sharedProc.process!!.isAlive ||
                forceRestart || sharedProc.client == null || !sharedProc.isInitialized
            if (needsRestart) {
                if (sharedProc.process != null) {
                    sharedProc.stop()
                }

                log.info("[$chatId] Starting shared process for $requestedAdapterName")
                val adapterRoot = AcpAdapterPaths.getAdapterRoot(requestedAdapterName)
                    ?: throw IllegalStateException("ACP adapter directory not found: $requestedAdapterName")

                val launchFile = java.io.File(adapterRoot, adapterInfo.launchPath)
                if (!launchFile.isFile) throw IllegalStateException("Missing launch path: ${adapterInfo.launchPath}")

                val nodeCmd = if (System.getProperty("os.name").lowercase().contains("win")) "node.exe" else "node"
                val command = mutableListOf(nodeCmd, adapterInfo.launchPath)
                command.addAll(adapterInfo.args)

                val pb = ProcessBuilder(command).directory(adapterRoot).redirectErrorStream(false)
                val env = pb.environment()
                env.putAll(System.getenv())

                // Add supporting tools to PATH if configured
                for (tool in adapterInfo.supportingTools) {
                    if (tool.addToPath) {
                        val toolDirName = tool.targetDir ?: tool.id
                        val toolDir = File(AcpAdapterPaths.getDependenciesDir(), toolDirName)
                        if (toolDir.exists()) {
                            val pathKey = if (System.getProperty("os.name").lowercase().contains("win")) "Path" else "PATH"
                            // Case-insensitive lookup for Windows
                            val actualKey = env.keys.find { it.equals(pathKey, ignoreCase = true) } ?: pathKey
                            val currentPath = env[actualKey] ?: System.getenv(actualKey) ?: ""
                            env[actualKey] = "${toolDir.absolutePath}${File.pathSeparator}$currentPath"
                            log.info("Added ${tool.name} to PATH for ${adapterInfo.name}")
                        }
                    }
                }

                val proc = withContext(Dispatchers.IO) { pb.start() }
                sharedProc.process = proc

                Thread {
                    proc.errorStream.bufferedReader().useLines { lines ->
                        lines.forEach { line -> log.warn("[Shared:${requestedAdapterName} stderr] $line") }
                    }
                }.apply { isDaemon = true; start() }

                val input = LineLoggingInputStream(proc.inputStream) { line ->
                    onLogEntry(AcpLogEntry(AcpLogEntry.Direction.RECEIVED, line))
                }.asSource().buffered()

                val output = LineLoggingOutputStream(proc.outputStream) { line ->
                    onLogEntry(AcpLogEntry(AcpLogEntry.Direction.SENT, line))
                }.asSink().buffered()

                val transport = StdioTransport(scope, Dispatchers.IO, input, output)
                val prot = Protocol(scope, transport)
                sharedProc.protocol = prot

                val clientsFactory = object : ClientOperationsFactory {
                    override suspend fun createClientOperations(
                        sessionId: SessionId,
                        sessionResponse: AcpCreatedSessionResponse
                    ): ClientSessionOperations {
                        return this@AcpClientService.SharedSessionOperations(sessionId.value)
                    }
                }

                val c = Client(prot)
                sharedProc.client = c
                prot.start()
                c.initialize(ClientInfo(LATEST_PROTOCOL_VERSION, ClientCapabilities()))
                ensureAsyncSessionUpdates(sharedProc)
                sharedProc.isInitialized = true
            }
        }
    }

    // Run session/update handlers off the protocol read loop to avoid blocking loadSession.
    private fun ensureAsyncSessionUpdates(sharedProc: SharedProcess) {
        if (sharedProc.sessionUpdateWrapped) return
        val protocol = sharedProc.protocol ?: return
        try {
            val field = Protocol::class.java.getDeclaredField("notificationHandlers")
            field.isAccessible = true
            @Suppress("UNCHECKED_CAST")
            val handlers = field.get(protocol) as AtomicRef<PersistentMap<MethodName, suspend (JsonRpcNotification) -> Unit>>
            val methodName = AcpMethod.ClientMethods.SessionUpdate.methodName
            val original = handlers.value[methodName] ?: return
            val updateScope = CoroutineScope(scope.coroutineContext + Dispatchers.Default.limitedParallelism(1))
            sharedProc.sessionUpdateScope = updateScope
            val queue = Channel<JsonRpcNotification>(Channel.UNLIMITED)
            sharedProc.sessionUpdateQueue = queue
            sharedProc.sessionUpdateWorker = updateScope.launch {
                for (notification in queue) {
                    try {
                        original(notification)
                    } catch (e: Exception) {
                        log.warn("Async session/update handler failed", e)
                    }
                }
            }
            val wrapped: suspend (JsonRpcNotification) -> Unit = { notification ->
                val result = queue.trySend(notification)
                if (!result.isSuccess) {
                    updateScope.launch {
                        runCatching { queue.send(notification) }
                            .onFailure { log.warn("Failed to enqueue session/update notification", it) }
                    }
                }
            }
            handlers.value = handlers.value.put(methodName, wrapped)
            sharedProc.sessionUpdateWrapped = true
        } catch (e: Exception) {
            log.warn("Failed to wrap session/update notifications", e)
        }
    }

    private inner class SharedSessionOperations(
        val sessionId: String
    ) : ClientSessionOperations {
        override suspend fun requestPermissions(
            toolCall: SessionUpdate.ToolCallUpdate,
            permissions: List<PermissionOption>,
            _meta: JsonElement?
        ): RequestPermissionResponse {
            if (permissions.isEmpty()) {
                return RequestPermissionResponse(RequestPermissionOutcome.Cancelled)
            }
            
            val matchingContexts = sessions.values.filter { it.sessionIdRef.get() == sessionId }
            val primaryCtx = matchingContexts.firstOrNull() ?: return RequestPermissionResponse(RequestPermissionOutcome.Cancelled)
            
            val requestId = UUID.randomUUID().toString()
            val str = toolCall.toString()
            val title = Regex("title=([^,)]+)").find(str)?.groupValues?.get(1) ?: "Action"
            val kind = Regex("kind=([^,)]+)").find(str)?.groupValues?.get(1) ?: "OTHER"
            
            val request = PermissionRequest(
                requestId, 
                primaryCtx.chatId, 
                "Action: $title\nType: $kind", 
                permissions
            )
            
            val deferred = CompletableDeferred<RequestPermissionResponse>()
            primaryCtx.pendingRequests[requestId] = deferred
            
            permissionRequestHandler?.invoke(request) ?: run { 
                deferred.complete(RequestPermissionResponse(RequestPermissionOutcome.Cancelled)) 
            }
            
            return deferred.await()
        }

        override suspend fun notify(notification: SessionUpdate, _meta: JsonElement?) {
            val matchingContexts = sessions.values.filter { it.sessionIdRef.get() == sessionId }
            matchingContexts.forEach { context ->
                if (notification is SessionUpdate.CurrentModeUpdate) {
                    context.activeModeIdRef.set(notification.currentModeId.value)
                }
                val isReplay = context.statusRef.get() != Status.Prompting
                
                // During replay, only deliver to contexts that are actively loading
                // (Initializing status). This prevents duplicate content being pushed
                // to tabs that already finished loading the same ACP session.
                if (isReplay && context.statusRef.get() != Status.Initializing) {
                    return@forEach
                }
                
                sessionUpdateHandler?.invoke(context.chatId, notification, isReplay, _meta)
            }
        }
    }
}

private class LineLoggingOutputStream(
    private val delegate: java.io.OutputStream, 
    private val onLine: (String) -> Unit
) : java.io.OutputStream() {
    private val buffer = ByteArrayOutputStream()

    override fun write(b: Int) { 
        delegate.write(b)
        appendInternal(b) 
    }

    override fun write(b: ByteArray, off: Int, len: Int) { 
        delegate.write(b, off, len)
        for (i in off until (off + len).coerceAtMost(b.size)) {
            appendInternal(b[i].toInt() and 0xff) 
        }
    }

    private fun appendInternal(b: Int) { 
        if (b == '\n'.code) {
            flushLine() 
        } else {
            buffer.write(b) 
        }
    }

    private fun flushLine() { 
        val line = buffer.toString(Charsets.UTF_8).removeSuffix("\r")
        buffer.reset()
        if (line.isNotBlank()) {
            onLine(line) 
        }
    }

    override fun flush() = delegate.flush()

    override fun close() { 
        flushLine()
        delegate.close() 
    }
}

private class LineLoggingInputStream(
    delegate: java.io.InputStream, 
    private val onLine: (String) -> Unit
) : java.io.FilterInputStream(delegate) {
    private val buffer = ByteArrayOutputStream()

    override fun read(): Int { 
        val b = super.read()
        if (b == -1) {
            flushRemainder() 
        } else {
            appendInternal(b)
        }
        return b 
    }

    override fun read(b: ByteArray, off: Int, len: Int): Int { 
        val r = super.read(b, off, len)
        if (r == -1) {
            flushRemainder() 
        } else {
            for (i in off until (off + r).coerceAtMost(b.size)) {
                appendInternal(b[i].toInt() and 0xff)
            }
        }
        return r 
    }

    private fun appendInternal(b: Int) { 
        if (b == '\n'.code) {
            flushInternal() 
        } else {
            buffer.write(b) 
        }
    }

    private fun flushInternal() { 
        val line = buffer.toString(Charsets.UTF_8).removeSuffix("\r")
        buffer.reset()
        if (line.isNotBlank()) {
            onLine(line) 
        }
    }

    private fun flushRemainder() { 
        if (buffer.size() > 0) {
            flushInternal() 
        }
    }
}

sealed class AcpEvent {
    data class AgentText(val text: String) : AcpEvent()
    data class AgentThought(val text: String) : AcpEvent()
    data class PromptDone(val stopReason: String) : AcpEvent()
    data class Error(val message: String) : AcpEvent()
}
