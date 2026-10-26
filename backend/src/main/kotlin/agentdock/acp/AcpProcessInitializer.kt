package agentdock.acp

import agentdock.BuildConfig
import com.agentclientprotocol.client.Client
import com.agentclientprotocol.client.ClientInfo
import com.agentclientprotocol.model.ClientCapabilities
import com.agentclientprotocol.model.CreateElicitationResponse
import com.agentclientprotocol.model.ElicitationAction
import com.agentclientprotocol.model.ElicitationCapabilities
import com.agentclientprotocol.model.ElicitationFormCapabilities
import com.agentclientprotocol.model.PROTOCOL_VERSION_V1
import com.agentclientprotocol.protocol.Protocol
import com.agentclientprotocol.transport.StdioTransport
import java.io.File
import java.io.OutputStream
import java.util.concurrent.TimeoutException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlin.time.Duration.Companion.seconds

// Includes process launch, ACP initialize, and config-options discovery.
private val ADAPTER_INITIALIZATION_TIMEOUT = 300.seconds
private val ACP_INITIALIZE_ATTEMPT_TIMEOUT = 90.seconds
private const val ACP_INITIALIZE_MAX_ATTEMPTS = 2
private val ACP_INITIALIZE_RETRY_DELAY = 5.seconds
private val CONFIG_OPTIONS_FETCH_TIMEOUT = 120.seconds

/**
 * Initializes one shared process. Mutex waiters never own or stop another
 * caller's initialization; the timeout starts only after this caller acquires
 * the process mutex.
 */
internal suspend fun AcpClientService.startAndInitializeSharedProcess(
    sharedProcess: AcpClientService.SharedProcess,
    adapterInfo: AcpAdapterConfig.AdapterInfo,
    forceRestart: Boolean = false
) {
    sharedProcess.mutex.withLock {
        if (forceRestart) sharedProcess.stop()
        if (sharedProcess.isHealthy()) return@withLock

        try {
            val completed = withTimeoutOrNull(ADAPTER_INITIALIZATION_TIMEOUT) {
                initializeSharedProcessWithinBudget(sharedProcess, adapterInfo)
                true
            }
            if (completed != true) {
                throw TimeoutException(
                    "Adapter initialization timed out after ${ADAPTER_INITIALIZATION_TIMEOUT.inWholeSeconds}s"
                )
            }
        } catch (error: Exception) {
            sharedProcess.stop()
            throw error
        }
    }
}

private suspend fun AcpClientService.initializeSharedProcessWithinBudget(
    sharedProcess: AcpClientService.SharedProcess,
    adapterInfo: AcpAdapterConfig.AdapterInfo
) {
    val adapterId = adapterInfo.id
    val adapterRoot = AcpAdapterPaths.getDownloadPath(adapterId)

    updateAdapterInitializationState(
        adapterId,
        AcpClientService.AdapterInitializationStatus.Initializing,
        detail = "Resolving launch command..."
    )
    val command = buildAdapterLaunchCommand(adapterRoot, adapterInfo)

    var lastError: Exception? = null
    for (attempt in 1..ACP_INITIALIZE_MAX_ATTEMPTS) {
        try {
            initializeFreshProcessAttempt(
                sharedProcess = sharedProcess,
                adapterInfo = adapterInfo,
                adapterRoot = adapterRoot,
                command = command,
                attempt = attempt
            )
            lastError = null
            break
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            lastError = error
            if (attempt == ACP_INITIALIZE_MAX_ATTEMPTS || sharedProcess.retired) break
            delay(ACP_INITIALIZE_RETRY_DELAY)
        }
    }
    if (lastError != null) throw lastError

    ensureAsyncSessionUpdates(sharedProcess)
    fetchAndStoreRuntimeMetadata(sharedProcess, adapterInfo)
    sharedProcess.isInitialized = true
}

@OptIn(com.agentclientprotocol.annotations.UnstableApi::class)
private suspend fun AcpClientService.initializeFreshProcessAttempt(
    sharedProcess: AcpClientService.SharedProcess,
    adapterInfo: AcpAdapterConfig.AdapterInfo,
    adapterRoot: String,
    command: List<String>,
    attempt: Int,
    diagnostics: StringBuffer? = null
) {
    sharedProcess.stop()
    var stderrThread: Thread? = null
    fun reportProgress(detail: String) {
        if (diagnostics == null) updateAdapterInitializationState(
            adapterInfo.id,
            AcpClientService.AdapterInitializationStatus.Initializing,
            detail = detail
        )
    }
    try {
        reportProgress("Starting adapter process... (attempt $attempt/$ACP_INITIALIZE_MAX_ATTEMPTS)")

        var commandLine = com.intellij.execution.configurations.GeneralCommandLine(command)
            .withWorkDirectory(resolveAdapterProcessWorkingDirectory(File(adapterRoot)))
            .withEnvironment(AcpProcessEnvironment.baseEnvironment() + adapterInfo.environment)
            .withRedirectErrorStream(false)
        AcpNodeRuntimeResolver.resolveAvailable()?.let { runtime ->
            commandLine = AcpNodeRuntimeResolver.applyTo(commandLine, runtime)
        }

        val process = withContext(Dispatchers.IO) {
            commandLine.createProcess().also { sharedProcess.attachProcess(it) }
        }
        AcpProcessRegistry.registerProcess(adapterInfo.id, adapterRoot, adapterInfo.isCustom, process)
        reportProgress("Opening ACP stdio transport... (attempt $attempt/$ACP_INITIALIZE_MAX_ATTEMPTS)")

        stderrThread = Thread {
            runCatching {
                if (diagnostics != null) {
                    process.errorStream.bufferedReader().use { reader ->
                        val buffer = CharArray(2048)
                        while (true) {
                            val count = reader.read(buffer)
                            if (count < 0) break
                            synchronized(diagnostics) {
                                diagnostics.append(buffer, 0, count)
                                if (diagnostics.length > 16_384) diagnostics.delete(0, diagnostics.length - 16_384)
                            }
                        }
                    }
                } else if (BuildConfig.IS_DEV) {
                    process.errorStream.bufferedReader().useLines { lines ->
                        lines.filter(String::isNotBlank).forEach { line ->
                            onLogEntry(
                                AcpLogEntry(
                                    adapterInfo.id,
                                    AcpLogEntry.Direction.RECEIVED,
                                    line,
                                    AcpLogEntry.Category.STDERR
                                )
                            )
                        }
                    }
                } else {
                    process.errorStream.use { it.copyTo(OutputStream.nullOutputStream()) }
                }
            }
        }.apply {
            isDaemon = true
            name = "acp-stderr-${adapterInfo.id}-$attempt"
            start()
        }

        val inputStream = if (BuildConfig.IS_DEV) {
            LineLoggingInputStream(process.inputStream) { line ->
                onLogEntry(AcpLogEntry(adapterInfo.id, AcpLogEntry.Direction.RECEIVED, line))
            }
        } else {
            process.inputStream
        }
        val outputStream = if (BuildConfig.IS_DEV) {
            LineLoggingOutputStream(process.outputStream) { line ->
                onLogEntry(AcpLogEntry(adapterInfo.id, AcpLogEntry.Direction.SENT, line))
            }
        } else {
            process.outputStream
        }

        val protocolScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        sharedProcess.protocolScope = protocolScope
        val transport = StdioTransport(
            protocolScope,
            Dispatchers.IO,
            inputStream.bufferedReader(Charsets.UTF_8).asLineFlow(),
            outputStream.bufferedWriter(Charsets.UTF_8).asLineWriter()
        )
        val protocol = Protocol(protocolScope, transport)
        sharedProcess.protocol = protocol
        val client = Client(protocol, globalElicitationHandler = {
            // A request outside a chat has no UI owner; do not leave the agent waiting for one.
            CreateElicitationResponse(ElicitationAction.Cancel)
        })
        sharedProcess.client = client
        protocol.start()

        if (!process.isAlive) {
            val exitCode = runCatching { process.exitValue() }.getOrNull()
            throw IllegalStateException("Agent process exited immediately with code $exitCode")
        }

        reportProgress("Waiting for ACP initialize... (attempt $attempt/$ACP_INITIALIZE_MAX_ATTEMPTS)")
        val result = withTimeoutOrNull(ACP_INITIALIZE_ATTEMPT_TIMEOUT) {
            client.initialize(
                ClientInfo(
                    PROTOCOL_VERSION_V1,
                    ClientCapabilities(
                        elicitation = ElicitationCapabilities(form = ElicitationFormCapabilities()),
                        _meta = buildJsonObject {
                            put("terminal-auth", JsonPrimitive(true))
                            adapterInfo.clientCapabilitiesMeta.forEach { (key, value) ->
                                put(key, value)
                            }
                        }
                    )
                )
            )
        } ?: throw TimeoutException(
            "ACP initialize timed out after ${ACP_INITIALIZE_ATTEMPT_TIMEOUT.inWholeSeconds}s"
        )
        sharedProcess.authMethods = result.authMethods
        sharedProcess.logoutAvailable = result.capabilities.auth.logout != null
        sharedProcess.sessionListAvailable = result.capabilities.sessionCapabilities.list != null
        sharedProcess.sessionDeleteAvailable = result.capabilities.sessionCapabilities.delete != null
        sharedProcess.sessionCloseAvailable = result.capabilities.sessionCapabilities.close != null
    } catch (error: Exception) {
        sharedProcess.stop()
        throw error
    } finally {
        if (diagnostics != null) {
            sharedProcess.stop()
            stderrThread?.join(1000)
        }
    }
}

internal suspend fun AcpClientService.testCustomAcpConnection(config: CustomAcpConfig): Pair<Boolean, String> {
    val diagnostics = StringBuffer()
    val sharedProcess = createSharedProcess(config.id)
    var errorMessage: String? = null
    try {
        val adapterInfo = CustomAcpConfigStore.toAdapterInfo(config)
        val root = resolveDownloadPath(adapterInfo)
        val command = buildAdapterLaunchCommand(root, adapterInfo)
        initializeFreshProcessAttempt(sharedProcess, adapterInfo, root, command, 1, diagnostics)
    } catch (error: Exception) {
        currentCoroutineContext().ensureActive()
        errorMessage = formatAcpError(error)
    } finally {
        sharedProcess.stop()
    }
    return (errorMessage == null) to listOfNotNull(errorMessage, diagnostics.toString().trim().takeIf { it.isNotEmpty() })
        .joinToString("\n\n")
}

private suspend fun AcpClientService.fetchAndStoreRuntimeMetadata(
    sharedProcess: AcpClientService.SharedProcess,
    adapterInfo: AcpAdapterConfig.AdapterInfo
) {
    updateAdapterInitializationState(
        adapterInfo.id,
        AcpClientService.AdapterInitializationStatus.Initializing,
        detail = "Fetching config options..."
    )
    val protocol = sharedProcess.protocol
        ?: throw IllegalStateException("ACP protocol was not initialized for adapter '${adapterInfo.id}'")
    try {
        val metadata = withTimeoutOrNull(CONFIG_OPTIONS_FETCH_TIMEOUT) {
            fetchAdapterRuntimeMetadata(protocol, adapterInfo, onConfigMutated = sharedProcess::markConfigMutated)
        } ?: throw TimeoutException(
            "Config options fetch timed out after ${CONFIG_OPTIONS_FETCH_TIMEOUT.inWholeSeconds}s"
        )
        adapterRuntimeMetadataMap[adapterInfo.id] = metadata
    } catch (error: Exception) {
        if (error is CancellationException) throw error
        adapterRuntimeMetadataMap.remove(adapterInfo.id)
    }
}

internal fun AcpClientService.resolveAdapterProcessWorkingDirectory(adapterRoot: File): File {
    return project.basePath
        ?.takeIf(String::isNotBlank)
        ?.let(::File)
        ?.takeIf { it.exists() && it.isDirectory }
        ?: adapterRoot
}

private fun java.io.BufferedReader.asLineFlow() = flow {
    while (true) {
        val line = try {
            readLine()
        } catch (_: java.io.IOException) {
            break
        } ?: break
        emit(line)
    }
}.onCompletion {
    runCatching { close() }
}

private fun java.io.BufferedWriter.asLineWriter(): suspend (String) -> Unit = { line ->
    write(line)
    newLine()
    flush()
}
