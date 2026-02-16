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
import com.agentclientprotocol.model.PermissionOption
import com.agentclientprotocol.model.RequestPermissionOutcome
import com.agentclientprotocol.model.RequestPermissionResponse
import com.agentclientprotocol.model.SessionId
import com.agentclientprotocol.model.SessionUpdate
import com.agentclientprotocol.protocol.Protocol
import com.agentclientprotocol.transport.StdioTransport
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.withContext
import kotlinx.io.asSource
import kotlinx.io.buffered
import kotlinx.io.asSink
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.ByteArrayOutputStream
import java.util.concurrent.atomic.AtomicReference

private val log = Logger.getInstance(AcpClientService::class.java)

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

    enum class Status { NotStarted, Initializing, Ready, Prompting, Error }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val statusRef = AtomicReference(Status.NotStarted)
    private val sessionIdRef = AtomicReference<String?>(null)

    @Volatile private var process: Process? = null
    @Volatile private var client: Client? = null
    @Volatile private var session: ClientSession? = null
    @Volatile private var protocol: Protocol? = null

    fun status(): Status = statusRef.get()
    fun sessionId(): String? = sessionIdRef.get()

    suspend fun startAgent() {
        if (statusRef.get() != Status.NotStarted) return
        statusRef.set(Status.Initializing)
        withContext(Dispatchers.IO) {
            try {
                val cwd = project.basePath ?: System.getProperty("user.dir")
                val adapterInfo = AcpAdapterPaths.getAdapterInfo()
                val adapterRoot = AcpAdapterPaths.getAdapterRoot()
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
                adapterInfo.args?.let { argsString ->
                    // Simple split by space, handles most cases like --experimental-acp
                    command.addAll(argsString.split(" ").filter { it.isNotBlank() })
                }
                
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
                val sess = c.newSession(params, operationsFactory)
                session = sess
                sessionIdRef.set(sess.sessionId.value)

                // Set default model if configured
                // NOTE: ACP SDK 0.14.1 doesn't expose setModel on ClientSession yet,
                // so we need to send the JSON-RPC request manually through the transport layer.
                // This is a temporary workaround until the SDK adds proper support.
                val defaultModelId = try {
                    AcpAdapterConfig.getDefaultModelId()
                } catch (e: Exception) {
                    log.warn("Failed to get default model ID from config", e)
                    null
                }

                if (defaultModelId != null) {
                    try {
                        log.info("Setting default model to: $defaultModelId")
                        // Send session/set_model request
                        // Using a high ID to avoid collision with protocol's internal requests
                        val requestJson = buildJsonObject {
                            put("jsonrpc", "2.0")
                            put("id", 999999)  // High ID to avoid collision
                            put("method", "session/set_model")
                            put("params", buildJsonObject {
                                put("sessionId", sess.sessionId.value)
                                put("modelId", defaultModelId)
                            })
                        }
                        val requestLine = requestJson.toString() + "\n"
                        withContext(Dispatchers.IO) {
                            output.write(requestLine.toByteArray(Charsets.UTF_8))
                            output.flush()
                        }
                        log.info("Default model set successfully")
                    } catch (e: Exception) {
                        log.warn("Failed to set default model to $defaultModelId: ${e.message}", e)
                        // Don't fail agent startup if model setting fails
                    }
                }

                statusRef.set(Status.Ready)
            } catch (e: Exception) {
                log.error(e)
                statusRef.set(Status.Error)
                throw e
            }
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
        process?.destroyForcibly()
        process = null
        client = null
        session = null
        protocol = null
        statusRef.set(Status.NotStarted)
        sessionIdRef.set(null)
    }

    private class MinimalSessionOperations : ClientSessionOperations {
        override suspend fun requestPermissions(
            toolCall: SessionUpdate.ToolCallUpdate,
            permissions: List<PermissionOption>,
            _meta: JsonElement?
        ): RequestPermissionResponse {
            val first = permissions.firstOrNull() ?: return RequestPermissionResponse(RequestPermissionOutcome.Cancelled)
            return RequestPermissionResponse(RequestPermissionOutcome.Selected(first.optionId))
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
