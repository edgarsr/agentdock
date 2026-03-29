package unified.llm.acp

import com.agentclientprotocol.client.Client
import com.agentclientprotocol.client.ClientInfo
import com.agentclientprotocol.client.ClientOperationsFactory
import com.agentclientprotocol.common.ClientSessionOperations
import com.agentclientprotocol.common.SessionCreationParameters
import com.agentclientprotocol.model.*
import com.agentclientprotocol.protocol.Protocol
import com.agentclientprotocol.rpc.JsonRpcNotification
import com.agentclientprotocol.rpc.MethodName
import com.agentclientprotocol.transport.StdioTransport
import kotlinx.atomicfu.AtomicRef
import kotlinx.collections.immutable.PersistentMap
import kotlinx.coroutines.cancel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withContext
import kotlinx.io.asSource
import kotlinx.io.buffered
import kotlinx.io.asSink
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.util.Collections

private const val ADAPTER_INITIALIZATION_TIMEOUT_MS = 60_000L

internal fun AcpClientService.initializeDownloadedAdaptersInBackground() {
    if (!startupInitializationStarted.compareAndSet(false, true)) return

    AcpAdapterConfig.getAllAdapters().values.forEach { adapterInfo ->
        if (!AcpAdapterPaths.isDownloaded(adapterInfo.id)) return@forEach
        initializeAdapterInBackground(adapterInfo.id)
    }
}

internal fun AcpClientService.initializeAdapterInBackground(adapterName: String) {
    val adapterInfo = AcpAdapterPaths.getAdapterInfo(adapterName)
    if (!AcpAdapterPaths.isDownloaded(adapterInfo.id)) return
    adapterInitializationJobs.remove(adapterInfo.id)?.cancel()
    adapterInitializationScopes.remove(adapterInfo.id)?.coroutineContext?.cancel()
    adapterInitialization.remove(adapterInfo.id)
    val deferred = CompletableDeferred<Unit>()
    adapterInitialization[adapterInfo.id] = deferred
    updateAdapterInitializationState(adapterInfo.id, AcpClientService.AdapterInitializationStatus.Initializing)

    val initScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    adapterInitializationScopes[adapterInfo.id] = initScope
    val job = initScope.launch {
        try {
            val sharedProc = replaceSharedProcess(adapterInfo.id)
            withTimeout(ADAPTER_INITIALIZATION_TIMEOUT_MS) {
                initializeSharedProcessAtStartup(sharedProc, adapterInfo)
            }
            if (!deferred.isCompleted) deferred.complete(Unit)
            updateAdapterInitializationState(adapterInfo.id, AcpClientService.AdapterInitializationStatus.Ready)
        } catch (e: TimeoutCancellationException) {
            if (!deferred.isCompleted) deferred.completeExceptionally(e)
            activeProcesses[processKey(adapterInfo.id)]?.stop()
            updateAdapterInitializationState(
                adapterInfo.id,
                AcpClientService.AdapterInitializationStatus.Failed,
                "Adapter initialization timed out after ${ADAPTER_INITIALIZATION_TIMEOUT_MS / 1000}s"
            )
        } catch (_: CancellationException) {
            if (!deferred.isCompleted) deferred.cancel()
            activeProcesses[processKey(adapterInfo.id)]?.stop()
            updateAdapterInitializationState(adapterInfo.id, AcpClientService.AdapterInitializationStatus.NotStarted)
        } catch (e: Exception) {
            if (!deferred.isCompleted) deferred.completeExceptionally(e)
            updateAdapterInitializationState(
                adapterInfo.id,
                AcpClientService.AdapterInitializationStatus.Failed,
                e.message ?: e.toString()
            )
        } finally {
            adapterInitializationJobs.remove(adapterInfo.id)
            adapterInitializationScopes.remove(adapterInfo.id)?.coroutineContext?.cancel()
        }
    }
    adapterInitializationJobs[adapterInfo.id] = job
}

internal suspend fun AcpClientService.initializeAdapterIfEligible(adapterName: String) {
    val adapterInfo = AcpAdapterPaths.getAdapterInfo(adapterName)
    if (!AcpAdapterPaths.isDownloaded(adapterInfo.id)) {
        throw IllegalStateException("Agent '${adapterInfo.id}' is not downloaded")
    }

    val deferred = adapterInitialization.computeIfAbsent(adapterInfo.id) { CompletableDeferred<Unit>() }
    updateAdapterInitializationState(adapterInfo.id, AcpClientService.AdapterInitializationStatus.Initializing)
    try {
        val sharedProc = replaceSharedProcess(adapterInfo.id)
        withTimeout(ADAPTER_INITIALIZATION_TIMEOUT_MS) {
            ensureSharedProcessStarted(sharedProc, adapterInfo)
        }
        if (!deferred.isCompleted) deferred.complete(Unit)
        updateAdapterInitializationState(adapterInfo.id, AcpClientService.AdapterInitializationStatus.Ready)
    } catch (e: Exception) {
        if (!deferred.isCompleted) deferred.completeExceptionally(e)
        updateAdapterInitializationState(
            adapterInfo.id,
            AcpClientService.AdapterInitializationStatus.Failed,
            e.message ?: e.toString()
        )
        throw e
    }
}

internal suspend fun AcpClientService.awaitAdapterInitialization(adapterInfo: AcpAdapterConfig.AdapterInfo) {
    val deferred = adapterInitialization[adapterInfo.id]
        ?: throw IllegalStateException("Adapter '${adapterInfo.id}' was not initialized at plugin startup")
    deferred.await()
}

internal fun AcpClientService.resolveModelToApply(
    pref: String?,
    available: List<AcpAdapterConfig.ModelInfo>,
    default: String?
): String? {
    val p = pref?.trim().takeUnless { it.isNullOrEmpty() }
    if (p != null && (available.isEmpty() || available.any { it.modelId == p })) {
        return p
    }
    return default
}

/**
 * Runtime path initializes the shared ACP process on demand when needed.
 */
internal suspend fun AcpClientService.ensureSharedProcessStarted(
    sharedProc: AcpClientService.SharedProcess,
    adapterInfo: AcpAdapterConfig.AdapterInfo,
    forceRestart: Boolean = false
) {
    if (forceRestart) {
        sharedProc.stop()
    }

    val isHealthy = sharedProc.isHealthy()

    if (!isHealthy) {
        updateAdapterInitializationState(adapterInfo.id, AcpClientService.AdapterInitializationStatus.Initializing)

        // Ensure all patches are applied before starting the process
        AcpAdapterPaths.ensurePatched(adapterInfo.id)

        initializeSharedProcessAtStartup(sharedProc, adapterInfo)
        adapterInitialization.computeIfAbsent(adapterInfo.id) { CompletableDeferred<Unit>() }.also { deferred ->
            if (!deferred.isCompleted) deferred.complete(Unit)
        }
        updateAdapterInitializationState(adapterInfo.id, AcpClientService.AdapterInitializationStatus.Ready)
    } else {
        updateAdapterInitializationState(adapterInfo.id, AcpClientService.AdapterInitializationStatus.Ready)
    }

    ensureAsyncSessionUpdates(sharedProc)
}

/**
 * Startup-only path that initializes ACP adapter process and protocol client exactly once.
 */
@OptIn(com.agentclientprotocol.annotations.UnstableApi::class)
internal suspend fun AcpClientService.initializeSharedProcessAtStartup(
    sharedProc: AcpClientService.SharedProcess,
    adapterInfo: AcpAdapterConfig.AdapterInfo
) {
    val requestedAdapterName = adapterInfo.id
    sharedProc.mutex.withLock {
        val alreadyHealthy = sharedProc.isHealthy()
        if (alreadyHealthy) return

        if (sharedProc.process != null) {
            sharedProc.stop()
        }

        val target = AcpAdapterPaths.getExecutionTarget()
        val adapterRoot = AcpAdapterPaths.getDownloadPath(adapterInfo.id, target)

        val command = AcpAdapterPaths.buildLaunchCommand(
            adapterRootPath = adapterRoot,
            adapterInfo = adapterInfo,
            projectPath = project.basePath,
            target = target
        )

        val pb = ProcessBuilder(command)
            .directory(resolveAdapterProcessWorkingDirectory(File(adapterRoot)))
            .redirectErrorStream(false)
        val env = pb.environment()
        env.putAll(System.getenv())

        val proc = withContext(Dispatchers.IO) { pb.start() }
        sharedProc.process = proc
        val startupOutput = Collections.synchronizedList(mutableListOf<String>())

        Thread {
            proc.errorStream.bufferedReader().useLines { lines ->
                lines.forEach { line ->
                    if (line.isNotBlank()) {
                        startupOutput.add(line)
                        onLogEntry(AcpLogEntry(AcpLogEntry.Direction.RECEIVED, line, AcpLogEntry.Category.STDERR))
                    }
                }
            }
        }.apply { isDaemon = true; start() }

        val input = LineLoggingInputStream(
            proc.inputStream,
            transform = { line ->
                // Fix protocol version mismatch: Codex 0.10.x sends AuthMethod env_var objects
                // with "vars":[{"name":"VAR"}] instead of the flat "varName":"VAR" that ACP SDK
                // 0.16.6 requires. Extract the first var name and add it as "varName" after the
                // vars array, inside the same env_var object.
                if (!line.contains("\"env_var\"")) line
                else line.replace(
                    Regex(""""vars"\s*:\s*\[(\{"name"\s*:\s*"([^"]+)"[^\]]*)\]""")
                ) { m -> "\"vars\":[${m.groupValues[1]}],\"varName\":\"${m.groupValues[2]}\"" }
            }
        ) { line ->
            startupOutput.add(line)
            onLogEntry(AcpLogEntry(AcpLogEntry.Direction.RECEIVED, line))
        }.asSource().buffered()
        val output = LineLoggingOutputStream(proc.outputStream) { line ->
            onLogEntry(AcpLogEntry(AcpLogEntry.Direction.SENT, line))
        }.asSink().buffered()

        val protocolScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        sharedProc.protocolScope = protocolScope
        val transport = StdioTransport(protocolScope, Dispatchers.IO, input, output)
        val prot = Protocol(protocolScope, transport)
        sharedProc.protocol = prot

        val c = Client(prot)
        sharedProc.client = c
        prot.start()

        var initialized = false
        var attempts = 0
        val maxAttempts = 60
        var lastInitializeError: Exception? = null

        while (!initialized && attempts < maxAttempts) {
            try {
                attempts++
                withTimeout(10_000L) {
                    c.initialize(ClientInfo(LATEST_PROTOCOL_VERSION, ClientCapabilities()))
                }
                initialized = true
            } catch (e: Exception) {
                if (e is CancellationException && e !is TimeoutCancellationException) throw e
                val normalized = normalizeAdapterStartupException(e, startupOutput)
                if (normalized !== e) throw normalized
                lastInitializeError = e
                if (attempts < maxAttempts) {
                    kotlinx.coroutines.delay(5_000L)
                }
            }
        }
        if (!initialized) {
            throw normalizeAdapterStartupException(
                lastInitializeError ?: IllegalStateException("Adapter initialization failed"),
                startupOutput
            )
        }
        runCatching { ensureAsyncSessionUpdates(sharedProc) }
        try {
            adapterRuntimeMetadataMap[requestedAdapterName] = fetchAdapterRuntimeMetadata(c, adapterInfo)
        } catch (_: kotlinx.serialization.SerializationException) {
            // Protocol version mismatch between adapter binary and ACP SDK -
            // models/modes will fall back to config defaults in pushAdapters.
        } catch (e: Exception) {
            throw normalizeAdapterStartupException(e, startupOutput)
        }
        sharedProc.isInitialized = true
    }
}

private fun normalizeAdapterStartupException(error: Exception, startupOutput: List<String>): Exception {
    val haystacks = buildList {
        add(error.message.orEmpty())
        addAll(startupOutput)
    }
    val authRequired = haystacks.any { line ->
        line.contains("Please visit the following URL to authorize the application", ignoreCase = true) ||
            line.contains("accounts.google.com/o/oauth2/", ignoreCase = true) ||
            line.contains("Enter the authorization code:", ignoreCase = true) ||
            line.contains("Authentication required", ignoreCase = true)
    }
    if (!authRequired) return error
    return IllegalStateException("[AUTH_REQUIRED] Authentication required")
}

@OptIn(com.agentclientprotocol.annotations.UnstableApi::class)
internal suspend fun AcpClientService.fetchAdapterRuntimeMetadata(
    client: Client,
    adapterInfo: AcpAdapterConfig.AdapterInfo
): AcpClientService.AdapterRuntimeMetadata {
    val cwd = resolveSessionCwd(project.basePath ?: System.getProperty("user.dir"))
    val params = SessionCreationParameters(cwd = cwd, mcpServers = emptyList())
    val factory = object : ClientOperationsFactory {
        override suspend fun createClientOperations(
            sessionId: SessionId,
            sessionResponse: AcpCreatedSessionResponse
        ): ClientSessionOperations {
            return createSharedSessionOperations(sessionId.value, adapterInfo.id)
        }
    }

    val session = client.newSession(params, factory)
    val models = if (session.modelsSupported) {
        session.availableModels.map { model ->
            AcpAdapterConfig.ModelInfo(
                modelId = model.modelId.value,
                name = model.name,
                description = model.description
            )
        }
    } else {
        emptyList()
    }
    val modes = if (session.modesSupported) {
        session.availableModes.map { mode ->
            AcpAdapterConfig.ModeInfo(
                id = mode.id.value,
                name = mode.name,
                description = mode.description
            )
        }
    } else {
        emptyList()
    }

    return applyAdapterRuntimePreferences(
        adapterInfo = adapterInfo,
        currentModelId = if (session.modelsSupported) session.currentModel.value.value else null,
        availableModels = models,
        currentModeId = if (session.modesSupported) session.currentMode.value.value else null,
        availableModes = modes
    )
}

internal fun AcpClientService.applyAdapterRuntimePreferences(
    adapterInfo: AcpAdapterConfig.AdapterInfo,
    currentModelId: String?,
    availableModels: List<AcpAdapterConfig.ModelInfo>,
    currentModeId: String?,
    availableModes: List<AcpAdapterConfig.ModeInfo>
): AcpClientService.AdapterRuntimeMetadata {
    val filteredModels = availableModels.filterNot { model ->
        adapterInfo.disabledModels.any { disabled -> disabled.isNotBlank() && model.modelId.contains(disabled) }
    }
    val filteredModes = availableModes.filterNot { mode ->
        adapterInfo.disabledModes.any { disabled -> disabled == mode.id }
    }

    val preferredModelId = adapterInfo.defaultModel?.modelId
        ?.takeIf { preferred -> filteredModels.any { it.modelId == preferred } }
        ?: currentModelId?.takeIf { current -> filteredModels.any { it.modelId == current } }
        ?: filteredModels.firstOrNull()?.modelId

    val preferredModeId = adapterInfo.defaultMode?.modeId
        ?.takeIf { preferred -> filteredModes.any { it.id == preferred } }
        ?: currentModeId?.takeIf { current -> filteredModes.any { it.id == current } }
        ?: filteredModes.firstOrNull()?.id

    return AcpClientService.AdapterRuntimeMetadata(
        currentModelId = preferredModelId,
        availableModels = filteredModels,
        currentModeId = preferredModeId,
        availableModes = filteredModes
    )
}

internal fun AcpClientService.resolveAdapterProcessWorkingDirectory(adapterRoot: File): File {
    val projectBase = project.basePath
        ?.takeIf { it.isNotBlank() }
        ?.let { File(it) }
        ?.takeIf { it.exists() && it.isDirectory }
    return projectBase ?: adapterRoot
}

internal fun AcpClientService.ensureAsyncSessionUpdates(sharedProc: AcpClientService.SharedProcess) {
    if (sharedProc.sessionUpdateWrapped) return
    val protocol = sharedProc.protocol ?: return
    try {
        val field = Protocol::class.java.getDeclaredField("notificationHandlers")
        field.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val handlers = field.get(protocol) as AtomicRef<PersistentMap<MethodName, suspend (JsonRpcNotification) -> Unit>>
        val methodName = AcpMethod.ClientMethods.SessionUpdate.methodName
        val original = handlers.value[methodName] ?: return
        val updateScope = CoroutineScope(SupervisorJob() + Dispatchers.Default.limitedParallelism(1))
        sharedProc.sessionUpdateScope = updateScope
        val queue = Channel<QueuedSessionUpdate>(Channel.UNLIMITED)
        sharedProc.sessionUpdateQueue = queue
        sharedProc.sessionUpdateWorker = updateScope.launch {
            for (entry in queue) {
                when (entry) {
                    is QueuedSessionUpdate.Notification -> {
                        try {
                            original(entry.notification)
                        } catch (_: Exception) {}
                    }
                    is QueuedSessionUpdate.Barrier -> {
                        entry.completed.complete(Unit)
                    }
                }
            }
        }
        val wrapped: suspend (JsonRpcNotification) -> Unit = { notification ->
            extractAvailableCommands(notification.params)?.let { commands ->
                updateAvailableCommands(sharedProc.adapterName, commands)
            }
            val result = queue.trySend(QueuedSessionUpdate.Notification(notification))
            if (!result.isSuccess) {
                updateScope.launch {
                    runCatching { queue.send(QueuedSessionUpdate.Notification(notification)) }
                        .onFailure { }
                }
            }
        }
        handlers.value = handlers.value.put(methodName, wrapped)
        sharedProc.sessionUpdateWrapped = true
    } catch (_: Exception) {}
}

internal fun AcpClientService.extractAvailableCommands(params: kotlinx.serialization.json.JsonElement?): List<AvailableCommandPayload>? {
    val paramsObject = params as? JsonObject ?: return null
    val updateObject = paramsObject["update"] as? JsonObject ?: return null
    val updateType = (updateObject["sessionUpdate"] as? JsonPrimitive)?.contentOrNull ?: return null
    if (updateType != "available_commands_update") return null

    val commands = (updateObject["availableCommands"] as? JsonArray)
        ?.mapNotNull { element ->
            val commandObject = element as? JsonObject ?: return@mapNotNull null
            val name = (commandObject["name"] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()
            if (name.isEmpty()) return@mapNotNull null
            val description = (commandObject["description"] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()
            val inputHint = ((commandObject["input"] as? JsonObject)?.get("hint") as? JsonPrimitive)?.contentOrNull?.trim()
                ?.takeIf { it.isNotEmpty() }
            AvailableCommandPayload(
                name = name,
                description = description,
                inputHint = inputHint
            )
        }
        ?: return emptyList()

    return commands
}
