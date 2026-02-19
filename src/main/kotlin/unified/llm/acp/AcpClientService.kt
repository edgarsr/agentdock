package unified.llm.acp

import com.agentclientprotocol.client.Client
import com.agentclientprotocol.client.ClientInfo
import com.agentclientprotocol.client.ClientOperationsFactory
import com.agentclientprotocol.client.ClientSession
import com.agentclientprotocol.common.ClientSessionOperations
import com.agentclientprotocol.common.Event
import com.agentclientprotocol.common.SessionCreationParameters
import com.agentclientprotocol.model.AcpCreatedSessionResponse
import com.agentclientprotocol.model.ClientCapabilities
import com.agentclientprotocol.model.ContentBlock
import com.agentclientprotocol.model.ModelId
import com.agentclientprotocol.model.SessionModeId

import com.agentclientprotocol.model.PermissionOption
import com.agentclientprotocol.model.PermissionOptionId
import com.agentclientprotocol.model.RequestPermissionOutcome
import com.agentclientprotocol.model.RequestPermissionResponse
import com.agentclientprotocol.model.SessionId
import com.agentclientprotocol.model.SessionUpdate
import com.agentclientprotocol.protocol.Protocol
import com.agentclientprotocol.transport.StdioTransport
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.io.asSource
import kotlinx.io.buffered
import kotlinx.io.asSink
import kotlinx.serialization.json.JsonElement
import java.io.ByteArrayOutputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicReference
import java.util.UUID

private val log = Logger.getInstance(AcpClientService::class.java)

data class PermissionRequest(
    val requestId: String,
    val description: String,
    val options: List<PermissionOption>
)

/**
 * Minimal ACP client service: spawns the configured ACP adapter process, runs protocol with raw message logging.
 * No auth UI, no capabilities advertised, auto-allow all permissions.
 * The adapter name is configurable via system property "unified.llm.acp.adapter.name".
 */
class AcpClientService(private val project: Project) {
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

    enum class Status { NotStarted, Initializing, Ready, Prompting, Error }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lifecycleMutex = Mutex()
    private val statusRef = AtomicReference(Status.NotStarted)
    private val sessionIdRef = AtomicReference<String?>(null)
    private val activeAdapterNameRef = AtomicReference<String?>(null)
    private val activeModelIdRef = AtomicReference<String?>(null)

    private val activeModeIdRef = AtomicReference<String?>(null)
    
    // Map of requestId -> Deferred response
    private val pendingRequests = ConcurrentHashMap<String, CompletableDeferred<RequestPermissionResponse>>()

    @Volatile private var process: Process? = null
    @Volatile private var client: Client? = null
    @Volatile private var session: ClientSession? = null
    @Volatile private var protocol: Protocol? = null

    fun status(): Status = statusRef.get()
    fun sessionId(): String? = sessionIdRef.get()
    fun activeAdapterName(): String? = activeAdapterNameRef.get()
    fun activeModelId(): String? = activeModelIdRef.get()
    fun activeModeId(): String? = activeModeIdRef.get()

    fun getAvailableModels(adapterName: String? = null): List<AcpAdapterConfig.ModelInfo> {
        return AcpAdapterPaths.getAdapterInfo(adapterName).models
    }

    @Suppress("OPT_IN_USAGE")
    suspend fun startAgent(adapterName: String? = null, preferredModelId: String? = null, resumeSessionId: String? = null, forceRestart: Boolean = false) {
        withContext(Dispatchers.IO) {
            lifecycleMutex.withLock {
                val requestedAdapterInfo = AcpAdapterPaths.getAdapterInfo(adapterName)
                val requestedAdapterName = requestedAdapterInfo.name
                val currentAdapterName = activeAdapterNameRef.get()
                val currentStatus = statusRef.get()

                // Skip restart if same adapter is already ready and no forced restart or session resume is requested
                if (currentStatus == Status.Ready && currentAdapterName == requestedAdapterName && resumeSessionId == null && !forceRestart) {
                    return@withLock
                }

                if (currentStatus != Status.NotStarted) {
                    log.info("Restarting ACP agent: $currentAdapterName -> $requestedAdapterName")
                    stopAgentInternal()
                }

                statusRef.set(Status.Initializing)

            try {
                val cwd = project.basePath ?: System.getProperty("user.dir")
                val adapterInfo = requestedAdapterInfo
                val adapterRoot = AcpAdapterPaths.getAdapterRoot(requestedAdapterName)
                if (adapterRoot == null || !adapterRoot.isDirectory) {
                    statusRef.set(Status.Error)
                    throw IllegalStateException(
                        "ACP adapter failed to prepare. Check IDE log. Adapter is downloaded to ~/.unified-llm/adapters/<adapter-name>/ and npm install is run on first start."
                    )
                }
                val launchFile = java.io.File(adapterRoot, adapterInfo.launchPath)
                if (!launchFile.isFile) {
                    statusRef.set(Status.Error)
                    throw IllegalStateException(
                        "ACP adapter missing launch path '${adapterInfo.launchPath}' at ${adapterRoot.absolutePath}. Check IDE log for npm install errors."
                    )
                }

                val nodeCmd = if (System.getProperty("os.name").lowercase().contains("win")) "node.exe" else "node"
                val command = mutableListOf(nodeCmd, adapterInfo.launchPath)
                command.addAll(adapterInfo.args)

                val processBuilder = ProcessBuilder(command)
                    .directory(adapterRoot)
                    .redirectErrorStream(false)
                processBuilder.environment().putAll(System.getenv())
                val proc = processBuilder.start()
                process = proc
                Thread {
                    proc.errorStream.bufferedReader().useLines { lines ->
                        lines.forEach { line -> log.warn("[${adapterInfo.name} stderr] $line") }
                    }
                }.apply { isDaemon = true; start() }

                val loggingInputStream = LineLoggingInputStream(proc.inputStream) { line ->
                    onLogEntry(AcpLogEntry(AcpLogEntry.Direction.RECEIVED, line))
                }
                val loggingOutStream = LineLoggingOutputStream(proc.outputStream) { line ->
                    onLogEntry(AcpLogEntry(AcpLogEntry.Direction.SENT, line))
                }

                val input = loggingInputStream.asSource().buffered()
                val output = loggingOutStream.asSink().buffered()

                val transport = StdioTransport(scope, Dispatchers.IO, input, output)
                val prot = Protocol(scope, transport)
                protocol = prot

                val operationsFactory = object : ClientOperationsFactory {
                    override suspend fun createClientOperations(
                        sessionId: SessionId,
                        sessionResponse: AcpCreatedSessionResponse
                    ): ClientSessionOperations {
                        return MinimalSessionOperations()
                    }
                }

                val c = Client(prot)
                client = c
                prot.start()
                c.initialize(ClientInfo(com.agentclientprotocol.model.LATEST_PROTOCOL_VERSION, ClientCapabilities()))
                val params = SessionCreationParameters(cwd = cwd, mcpServers = emptyList())
                val sess = if (resumeSessionId != null) {
                    log.info("Resuming session $resumeSessionId after model change")
                    c.resumeSession(SessionId(resumeSessionId), params, operationsFactory)
                } else {
                    c.newSession(params, operationsFactory)
                }
                session = sess
                sessionIdRef.set(sess.sessionId.value)

                val selectedModelId = resolveModelToApply(
                    preferredModelId = preferredModelId,
                    availableModels = adapterInfo.models,
                    defaultModelId = adapterInfo.defaultModelId
                )

                if (selectedModelId != null) {
                    try {
                        log.info("Setting startup model to: $selectedModelId")
                        sess.setModel(ModelId(selectedModelId))
                        activeModelIdRef.set(selectedModelId)
                        log.info("Startup model set successfully")
                    } catch (e: Exception) {
                        log.warn("Failed to set startup model to $selectedModelId: ${e.message}", e)
                        // Don't fail agent startup if model setting fails
                    }
                }

                val defaultModeId = adapterInfo.defaultModeId
                if (defaultModeId != null) {
                   try {
                       log.info("Setting startup mode to: $defaultModeId")
                       sess.setMode(SessionModeId(defaultModeId))
                       activeModeIdRef.set(defaultModeId)
                   } catch (e: Exception) {
                       log.warn("Failed to set startup mode to $defaultModeId: ${e.message}", e)
                   }
                }

                activeAdapterNameRef.set(requestedAdapterName)
                statusRef.set(Status.Ready)
            } catch (e: Exception) {
                log.error(e)
                stopAgentInternal()
                statusRef.set(Status.Error)
                throw e
            }
            }
        }
    }

    @Suppress("OPT_IN_USAGE")
    suspend fun setModel(modelId: String): Boolean {
        val trimmedModelId = modelId.trim()
        if (trimmedModelId.isEmpty()) return false
        if (session == null) return false

        val currentModelId = activeModelIdRef.get()
        if (currentModelId == trimmedModelId) return true

        val adapterName = activeAdapterNameRef.get() ?: return false
        val adapterInfo = AcpAdapterPaths.getAdapterInfo(adapterName)
        val availableModels = adapterInfo.models
        if (availableModels.isNotEmpty() && availableModels.none { it.id == trimmedModelId }) {
            log.warn("Model '$trimmedModelId' is not configured for adapter '$adapterName'")
            return false
        }

        return when (adapterInfo.modelChangeStrategy) {
            "restart-resume" -> {
                val oldSessionId = sessionIdRef.get()
                try {
                    log.info("Model change ($adapterName): $currentModelId -> $trimmedModelId, restarting with session resume")
                    startAgent(adapterName, trimmedModelId, oldSessionId)
                    true
                } catch (e: Exception) {
                    log.warn("Failed to restart agent for model '$trimmedModelId': ${e.message}", e)
                    false
                }
            }
            "restart" -> {
                try {
                    log.info("Model change ($adapterName): $currentModelId -> $trimmedModelId, restarting with new session")
                    startAgent(adapterName, trimmedModelId, resumeSessionId = null, forceRestart = true)
                    true
                } catch (e: Exception) {
                    log.warn("Failed to restart agent for model '$trimmedModelId': ${e.message}", e)
                    false
                }
            }
            "in-session" -> {
                val sess = session ?: return false
                try {
                    withContext(Dispatchers.IO) {
                        sess.setModel(ModelId(trimmedModelId))
                    }
                    activeModelIdRef.set(trimmedModelId)
                    log.info("Model change ($adapterName): $currentModelId -> $trimmedModelId (in-session)")
                    true
                } catch (e: Exception) {
                    log.warn("Failed to set model '$trimmedModelId' in-session: ${e.message}", e)
                    false
                }
            }
            else -> {
                log.warn("Unknown modelChangeStrategy '${adapterInfo.modelChangeStrategy}' for adapter '$adapterName', defaulting to restart")
                try {
                    startAgent(adapterName, trimmedModelId, resumeSessionId = null)
                    true
                } catch (e: Exception) {
                    log.warn("Failed to restart agent for model '$trimmedModelId': ${e.message}", e)
                    false
                }
            }
        }
    }

    @Suppress("OPT_IN_USAGE")
    suspend fun setMode(modeId: String): Boolean {
        val trimmedModeId = modeId.trim()
        if (trimmedModeId.isEmpty()) return false
        val sess = session ?: return false
        
        val adapterName = activeAdapterNameRef.get()
        if (adapterName != null) {
            val info = AcpAdapterPaths.getAdapterInfo(adapterName)
            if (info.modes.isNotEmpty() && info.modes.none { it.id == trimmedModeId }) {
                log.warn("Mode '$trimmedModeId' is not configured for adapter '$adapterName'")
                return false
            }
        }

        return try {
            withContext(Dispatchers.IO) {
                sess.setMode(SessionModeId(trimmedModeId))
            }
            activeModeIdRef.set(trimmedModeId)
            true
        } catch (e: Exception) {
            log.warn("Failed to set mode '$trimmedModeId': ${e.message}", e)
            false
        }
    }

    fun respondToPermissionRequest(requestId: String, decision: String) {
        val deferred = pendingRequests.remove(requestId)
        if (deferred != null) {
            val response = if (decision == "deny") {
                RequestPermissionResponse(RequestPermissionOutcome.Cancelled)
            } else {
                // Assuming decision is the optionId if not "deny"
                RequestPermissionResponse(RequestPermissionOutcome.Selected(PermissionOptionId(decision)))
            }
            deferred.complete(response)
        } else {
            log.warn("Received response for unknown request ID: $requestId")
        }
    }

    fun prompt(text: String): Flow<AcpEvent> = flow {
        val sess = session ?: run {
            emit(AcpEvent.Error("No session; start agent first"))
            return@flow
        }
        statusRef.set(Status.Prompting)
        try {
            sess.prompt(listOf(ContentBlock.Text(text))).collect { event ->
                when (event) {
                    is Event.SessionUpdateEvent -> {
                        val update = event.update
                        if (update is SessionUpdate.AgentMessageChunk) {
                            val content = update.content
                            if (content is ContentBlock.Text) {
                                emit(AcpEvent.AgentText(content.text))
                            }
                        }
                    }
                    is Event.PromptResponseEvent -> {
                        emit(AcpEvent.PromptDone(event.response.stopReason.toString()))
                    }
                }
            }
        } finally {
            statusRef.set(Status.Ready)
        }
    }

    fun dispose() {
        scope.coroutineContext[Job]?.cancel()
        stopAgentInternal()
    }

    private fun stopAgentInternal() {
        process?.destroyForcibly()
        process = null
        client = null
        session = null
        protocol = null
        statusRef.set(Status.NotStarted)
        sessionIdRef.set(null)
        activeAdapterNameRef.set(null)
        activeModelIdRef.set(null)
        activeModeIdRef.set(null)
        // Cancel all pending requests
        pendingRequests.values.forEach { it.complete(RequestPermissionResponse(RequestPermissionOutcome.Cancelled)) }
        pendingRequests.clear()
    }

    private fun resolveModelToApply(
        preferredModelId: String?,
        availableModels: List<AcpAdapterConfig.ModelInfo>,
        defaultModelId: String?
    ): String? {
        val preferred = preferredModelId?.trim().takeUnless { it.isNullOrEmpty() }
        if (preferred != null) {
            if (availableModels.isEmpty() || availableModels.any { it.id == preferred }) return preferred
            log.warn("Preferred model '$preferred' not configured for adapter; falling back")
        }
        return defaultModelId
    }

    private inner class MinimalSessionOperations : ClientSessionOperations {
        override suspend fun requestPermissions(
            toolCall: SessionUpdate.ToolCallUpdate,
            permissions: List<PermissionOption>,
            _meta: JsonElement?
        ): RequestPermissionResponse {
            if (permissions.isEmpty()) return RequestPermissionResponse(RequestPermissionOutcome.Cancelled)
            
            // If mode is "bypassPermissions" (or similar), we might want to auto-allow.
            // But currently the SDK/Agent decides if it asks. If it asks, we should probably check mode locally or ask user.
            // Since mode logic is mostly agent-side, if we are here, the agent WANTS to ask.
            // Exception: if we want to force-bypass even if agent asks (e.g. legacy behavior?), we could check activeMode.
            // For now, implemented "Ask User" flow.

            val requestId = UUID.randomUUID().toString()
            // Extract meaningful info from toolCall.toString() which looks like ToolCallUpdate(toolCallId=..., title=..., kind=...)
            val str = toolCall.toString()
            val title = Regex("title=([^,)]+)").find(str)?.groupValues?.get(1) ?: "Unknown Action"
            val kind = Regex("kind=([^,)]+)").find(str)?.groupValues?.get(1) ?: "OTHER"
            
            val desc = """
                Action: $title
                Type: $kind
                
                Raw: $str
            """.trimIndent()

            val request = PermissionRequest(requestId, desc, permissions)
            val deferred = CompletableDeferred<RequestPermissionResponse>()
            pendingRequests[requestId] = deferred
            
            permissionRequestHandler?.invoke(request) ?: run {
                // If no handler, auto-deny or log error?
                // For now, log warning and auto-allow ONLY if we want to preserve old behavior when UI handles are missing
                // BUT user requested this feature. So we should probably wait or fail.
                // If we wait without handler, we hang.
                log.warn("No permission handler registered! Auto-denying request $requestId")
                deferred.complete(RequestPermissionResponse(RequestPermissionOutcome.Cancelled))
            }

            return deferred.await()
        }

        override suspend fun notify(notification: SessionUpdate, _meta: JsonElement?) {}
    }
}

/** OutputStream that buffers until newline then logs the line and forwards. */
private class LineLoggingOutputStream(
    private val delegate: java.io.OutputStream,
    private val onLine: (String) -> Unit
) : java.io.OutputStream() {
    private val buffer = ByteArrayOutputStream()

    override fun write(b: Int) {
        delegate.write(b)
        appendForLogging(b)
    }

    override fun write(b: ByteArray, off: Int, len: Int) {
        delegate.write(b, off, len)
        for (i in off until (off + len).coerceAtMost(b.size)) {
            appendForLogging(b[i].toInt() and 0xff)
        }
    }

    private fun appendForLogging(b: Int) {
        if (b == '\n'.code) {
            flushLine()
            return
        }
        buffer.write(b)
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

/** InputStream that logs line-delimited inbound traffic without modifying payload bytes. */
private class LineLoggingInputStream(
    delegate: java.io.InputStream,
    private val onLine: (String) -> Unit
) : java.io.FilterInputStream(delegate) {
    private val buffer = ByteArrayOutputStream()

    override fun read(): Int {
        val b = super.read()
        if (b == -1) {
            flushRemainder()
            return -1
        }
        appendForLogging(b)
        return b
    }

    override fun read(b: ByteArray, off: Int, len: Int): Int {
        val read = super.read(b, off, len)
        if (read == -1) {
            flushRemainder()
            return -1
        }
        for (i in off until (off + read).coerceAtMost(b.size)) {
            appendForLogging(b[i].toInt() and 0xff)
        }
        return read
    }

    private fun appendForLogging(b: Int) {
        if (b == '\n'.code) {
            flushLine()
            return
        }
        buffer.write(b)
    }

    private fun flushLine() {
        val line = buffer.toString(Charsets.UTF_8).removeSuffix("\r")
        buffer.reset()
        if (line.isNotBlank()) {
            onLine(line)
        }
    }

    private fun flushRemainder() {
        if (buffer.size() == 0) return
        flushLine()
    }
}

sealed class AcpEvent {
    data class AgentText(val text: String) : AcpEvent()
    data class PromptDone(val stopReason: String) : AcpEvent()
    data class Error(val message: String) : AcpEvent()
}
