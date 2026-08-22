package agentdock.acp

import agentdock.BuildConfig
import com.agentclientprotocol.client.Client
import com.agentclientprotocol.client.ClientInfo
import com.agentclientprotocol.model.ClientCapabilities
import com.agentclientprotocol.model.LATEST_PROTOCOL_VERSION
import com.agentclientprotocol.protocol.Protocol
import com.agentclientprotocol.transport.StdioTransport
import java.io.File
import java.io.OutputStream
import java.util.concurrent.TimeoutException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

// Includes process launch, ACP initialize, and config-options discovery.
private const val ADAPTER_INITIALIZATION_TIMEOUT_MS = 300_000L
private const val ACP_INITIALIZE_ATTEMPT_TIMEOUT_MS = 60_000L
private const val ACP_INITIALIZE_MAX_ATTEMPTS = 2
private const val ACP_INITIALIZE_RETRY_DELAY_MS = 5_000L
private const val CONFIG_OPTIONS_FETCH_TIMEOUT_MS = 120_000L

/**
 * Initializes one shared process. Mutex waiters never own or stop another
 * caller's initialization; the timeout starts only after this caller acquires
 * the process mutex.
 */
@OptIn(com.agentclientprotocol.annotations.UnstableApi::class)
internal suspend fun AcpClientService.startAndInitializeSharedProcess(
    sharedProcess: AcpClientService.SharedProcess,
    adapterInfo: AcpAdapterConfig.AdapterInfo,
    forceRestart: Boolean = false
) {
    sharedProcess.mutex.withLock {
        if (forceRestart) sharedProcess.stop()
        if (sharedProcess.isHealthy()) return@withLock

        try {
            val completed = withTimeoutOrNull(ADAPTER_INITIALIZATION_TIMEOUT_MS) {
                initializeSharedProcessWithinBudget(sharedProcess, adapterInfo)
                true
            }
            if (completed != true) {
                throw TimeoutException(
                    "Adapter initialization timed out after ${ADAPTER_INITIALIZATION_TIMEOUT_MS / 1000}s"
                )
            }
        } catch (error: Exception) {
            sharedProcess.stop()
            throw error
        }
    }
}

@OptIn(com.agentclientprotocol.annotations.UnstableApi::class)
private suspend fun AcpClientService.initializeSharedProcessWithinBudget(
    sharedProcess: AcpClientService.SharedProcess,
    adapterInfo: AcpAdapterConfig.AdapterInfo
) {
    val adapterId = adapterInfo.id
    val target = AcpAdapterPaths.getExecutionTarget()
    val adapterRoot = AcpAdapterPaths.getDownloadPath(adapterId, target)

    updateAdapterInitializationState(
        adapterId,
        AcpClientService.AdapterInitializationStatus.Initializing,
        detail = "Resolving launch command..."
    )
    val command = AcpAdapterPaths.buildLaunchCommand(
        adapterRootPath = adapterRoot,
        adapterInfo = adapterInfo,
        projectPath = project.basePath,
        target = target
    )

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
            if (attempt == ACP_INITIALIZE_MAX_ATTEMPTS) break
            delay(ACP_INITIALIZE_RETRY_DELAY_MS)
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
    attempt: Int
) {
    sharedProcess.stop()
    try {
        updateAdapterInitializationState(
            adapterInfo.id,
            AcpClientService.AdapterInitializationStatus.Initializing,
            detail = "Starting adapter process... (attempt $attempt/$ACP_INITIALIZE_MAX_ATTEMPTS)"
        )

        var commandLine = com.intellij.execution.configurations.GeneralCommandLine(command)
            .withWorkDirectory(resolveAdapterProcessWorkingDirectory(File(adapterRoot)))
            .withEnvironment(AcpProcessEnvironment.baseEnvironment())
            .withRedirectErrorStream(false)
        AcpNodeRuntimeResolver.resolveAvailable()?.let { runtime ->
            commandLine = AcpNodeRuntimeResolver.applyTo(commandLine, runtime)
        }

        val process = withContext(Dispatchers.IO) { commandLine.createProcess() }
        sharedProcess.process = process
        AcpProcessRegistry.registerProcess(adapterInfo.id, adapterRoot, process)
        updateAdapterInitializationState(
            adapterInfo.id,
            AcpClientService.AdapterInitializationStatus.Initializing,
            detail = "Opening ACP stdio transport... (attempt $attempt/$ACP_INITIALIZE_MAX_ATTEMPTS)"
        )

        Thread {
            if (BuildConfig.IS_DEV) {
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
        val client = Client(protocol)
        sharedProcess.client = client
        protocol.start()

        if (!process.isAlive) {
            val exitCode = runCatching { process.exitValue() }.getOrNull()
            throw IllegalStateException("Agent process exited immediately with code $exitCode")
        }

        updateAdapterInitializationState(
            adapterInfo.id,
            AcpClientService.AdapterInitializationStatus.Initializing,
            detail = "Waiting for ACP initialize... (attempt $attempt/$ACP_INITIALIZE_MAX_ATTEMPTS)"
        )
        val result = withTimeoutOrNull(ACP_INITIALIZE_ATTEMPT_TIMEOUT_MS) {
            client.initialize(
                ClientInfo(
                    LATEST_PROTOCOL_VERSION,
                    ClientCapabilities(
                        _meta = buildJsonObject {
                            put("terminal-auth", JsonPrimitive(true))
                        }
                    )
                )
            )
        } ?: throw TimeoutException(
            "ACP initialize timed out after ${ACP_INITIALIZE_ATTEMPT_TIMEOUT_MS / 1000}s"
        )
        sharedProcess.authMethods = result.authMethods
        sharedProcess.logoutAvailable = result.capabilities.auth?.logout != null
    } catch (error: Exception) {
        if (error is CancellationException) {
            sharedProcess.stop()
            throw error
        }
        sharedProcess.stop()
        throw error
    }
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
        val metadata = withTimeoutOrNull(CONFIG_OPTIONS_FETCH_TIMEOUT_MS) {
            fetchAdapterRuntimeMetadata(protocol, adapterInfo)
        } ?: throw TimeoutException(
            "Config options fetch timed out after ${CONFIG_OPTIONS_FETCH_TIMEOUT_MS / 1000}s"
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
