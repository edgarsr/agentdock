package agentdock.acp

import com.agentclientprotocol.client.Client
import com.agentclientprotocol.client.ClientInfo
import com.agentclientprotocol.client.ClientOperationsFactory
import com.agentclientprotocol.client.ClientSession
import com.agentclientprotocol.common.ClientSessionOperations
import com.agentclientprotocol.common.SessionCreationParameters
import com.agentclientprotocol.model.*
import com.agentclientprotocol.protocol.Protocol
import com.agentclientprotocol.rpc.JsonRpcNotification
import com.agentclientprotocol.rpc.MethodName
import com.intellij.openapi.project.Project
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

data class PermissionRequest(
    val requestId: String,
    val chatId: String,
    val title: String,
    val options: List<PermissionOption>
)

class AcpClientService private constructor(val project: Project) {
    data class AdapterRuntimeMetadata(
        val currentModelId: String?,
        val availableModels: List<AcpAdapterConfig.ModelInfo>,
        val currentModeId: String?,
        val availableModes: List<AcpAdapterConfig.ModeInfo>
    )

    companion object {
        private val instances = ConcurrentHashMap<Project, AcpClientService>()

        fun getInstance(project: Project): AcpClientService {
            val service = instances.computeIfAbsent(project) { p ->
                val created = AcpClientService(p)
                Disposer.register(p, Disposable {
                    created.shutdown()
                    instances.remove(p)
                })
                created
            }
            service.initializeDownloadedAdaptersInBackground()
            return service
        }

    }
    @Volatile
    internal var logCallback: ((AcpLogEntry) -> Unit)? = null

    fun setOnLogEntry(callback: (AcpLogEntry) -> Unit) {
        logCallback = callback
    }

    internal fun onLogEntry(entry: AcpLogEntry) {
        logCallback?.invoke(entry)
    }

    @Volatile
    internal var permissionRequestHandler: ((PermissionRequest) -> Unit)? = null

    fun setOnPermissionRequest(handler: (PermissionRequest) -> Unit) {
        permissionRequestHandler = handler
    }

    @Volatile
    internal var sessionUpdateHandler: ((String, SessionUpdate, Boolean, JsonElement?) -> Unit)? = null

    fun setOnSessionUpdate(handler: (String, SessionUpdate, Boolean, JsonElement?) -> Unit) {
        sessionUpdateHandler = handler
    }

    @Volatile
    internal var availableCommandsHandler: ((String, List<AvailableCommandPayload>) -> Unit)? = null

    internal fun setOnAvailableCommands(handler: (String, List<AvailableCommandPayload>) -> Unit) {
        availableCommandsHandler = handler
    }

    @Volatile
    internal var adapterInitializationStateHandler: ((String, AdapterInitializationStatus, String?) -> Unit)? = null

    fun setOnAdapterInitializationStateChanged(handler: (String, AdapterInitializationStatus, String?) -> Unit) {
        adapterInitializationStateHandler = handler
    }

    internal fun bindLiveSessionOwner(chatId: String, sessionId: String?) {
        val normalizedSessionId = sessionId?.trim().orEmpty()
        synchronized(liveOwnerBySessionId) {
            liveOwnerBySessionId.entries.removeIf { it.value == chatId }
            if (normalizedSessionId.isNotBlank()) {
                liveOwnerBySessionId[normalizedSessionId] = chatId
            }
        }
    }

    fun activeAdapterName(chatId: String): String? = sessions[chatId]?.activeAdapterNameRef?.get()

    enum class Status { NotStarted, Initializing, Ready, Prompting, Error }
    enum class AdapterInitializationStatus { NotStarted, Initializing, Ready, Failed }

    internal inner class SharedProcess(val adapterName: String) {
        val mutex = Mutex()
        @Volatile var process: Process? = null
        @Volatile var client: Client? = null
        @Volatile var protocol: Protocol? = null
        @Volatile var protocolScope: CoroutineScope? = null
        @Volatile var isInitialized: Boolean = false
        @Volatile var sessionUpdateWrapped: Boolean = false
        @Volatile var sessionUpdateScope: CoroutineScope? = null
        @Volatile var sessionUpdateQueue: Channel<QueuedSessionUpdate>? = null
        @Volatile var sessionUpdateWorker: Job? = null

        fun stop() {
            val runningProcess = process
            val processHandle = runCatching { runningProcess?.toHandle() }.getOrNull()
            val stopped = runCatching {
                processHandle?.let { AcpProcessUtils.destroyProcessTree(it) } ?: run {
                    runningProcess?.destroyForcibly()
                    runningProcess?.waitFor(2, TimeUnit.SECONDS)
                }
                true
            }.getOrDefault(false)
            if (!stopped) {
                runCatching {
                    runningProcess?.destroyForcibly()
                    runningProcess?.waitFor(2, TimeUnit.SECONDS)
                }
            }
            process = null
            client = null
            protocol = null
            protocolScope?.coroutineContext?.cancel()
            protocolScope = null
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

    internal val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    internal val sessions = ConcurrentHashMap<String, AgentContext>()
    internal val activeProcesses = ConcurrentHashMap<String, SharedProcess>()
    internal val liveOwnerBySessionId = ConcurrentHashMap<String, String>()
    internal val replayOwnerBySessionId = ConcurrentHashMap<String, String>()
    internal val startupInitializationStarted = AtomicBoolean(false)
    internal val adapterInitialization = ConcurrentHashMap<String, CompletableDeferred<Unit>>()
    internal val adapterInitializationJobs = ConcurrentHashMap<String, Job>()
    internal val adapterInitializationScopes = ConcurrentHashMap<String, CoroutineScope>()
    internal val adapterInitializationState = ConcurrentHashMap<String, AdapterInitializationStatus>()
    internal val adapterInitializationErrors = ConcurrentHashMap<String, String>()
    internal val adapterInitializationDetails = ConcurrentHashMap<String, String>()
    internal val adapterRuntimeMetadataMap = ConcurrentHashMap<String, AdapterRuntimeMetadata>()
    internal val availableCommandsByAdapter = ConcurrentHashMap<String, List<AvailableCommandPayload>>()
    internal val systemInstructionsInjectedSessionIds: MutableSet<String> = ConcurrentHashMap.newKeySet()
    internal val historySyncAfterInitializationInFlight = AtomicBoolean(false)
    internal val runtimeRecoveryInProgress = AtomicBoolean(false)

    fun status(chatId: String): Status = sessions[chatId]?.statusRef?.get() ?: Status.NotStarted
    fun sessionId(chatId: String): String? = sessions[chatId]?.sessionIdRef?.get()
    fun activeModelId(chatId: String): String? = sessions[chatId]?.activeModelIdRef?.get()
    fun activeModeId(chatId: String): String? = sessions[chatId]?.activeModeIdRef?.get()
    fun adapterInitializationStatus(adapterName: String): AdapterInitializationStatus {
        return adapterInitializationState[adapterName] ?: AdapterInitializationStatus.NotStarted
    }
    fun adapterInitializationError(adapterName: String): String? = adapterInitializationErrors[adapterName]
    fun adapterInitializationDetail(adapterName: String): String? = adapterInitializationDetails[adapterName]
    fun adapterRuntimeMetadata(adapterName: String): AdapterRuntimeMetadata? = adapterRuntimeMetadataMap[adapterName]
    internal fun availableCommands(adapterName: String): List<AvailableCommandPayload> = availableCommandsByAdapter[adapterName] ?: emptyList()
    internal fun allAvailableCommands(): Map<String, List<AvailableCommandPayload>> = availableCommandsByAdapter.toMap()
    fun isAdapterReady(adapterName: String): Boolean {
        val sharedProc = activeProcesses[processKey(adapterName)] ?: return false
        return sharedProc.isHealthy()
    }

    internal fun updateAvailableCommands(adapterName: String, commands: List<AvailableCommandPayload>) {
        availableCommandsByAdapter[adapterName] = commands
        runCatching { availableCommandsHandler?.invoke(adapterName, commands) }
    }

    internal fun updateAdapterInitializationState(
        adapterName: String,
        state: AdapterInitializationStatus,
        error: String? = null,
        detail: String? = null
    ) {
        adapterInitializationState[adapterName] = state
        if (error.isNullOrBlank()) {
            adapterInitializationErrors.remove(adapterName)
        } else {
            adapterInitializationErrors[adapterName] = error
        }
        if (state == AdapterInitializationStatus.Initializing && !detail.isNullOrBlank()) {
            adapterInitializationDetails[adapterName] = detail
        } else if (state != AdapterInitializationStatus.Initializing) {
            adapterInitializationDetails.remove(adapterName)
        }
        runCatching { adapterInitializationStateHandler?.invoke(adapterName, state, error) }
    }

    internal fun SharedProcess.isHealthy(): Boolean {
        val runningProcess = process ?: return false
        if (!runningProcess.isAlive || client == null || !isInitialized) return false

        val protocolActive = protocolScope?.coroutineContext?.get(Job)?.isActive == true
        if (!protocolActive) return false

        if (!sessionUpdateWrapped) return true

        val updateScopeActive = sessionUpdateScope?.coroutineContext?.get(Job)?.isActive == true
        val updateWorkerActive = sessionUpdateWorker?.isActive == true
        return updateScopeActive && updateWorkerActive
    }

    internal fun SharedProcess.failureReason(): String {
        val runningProcess = process
        if (runningProcess == null) {
            return "Connection to the agent process is unavailable."
        }
        if (!runningProcess.isAlive) {
            val exitCode = runCatching { runningProcess.exitValue() }.getOrNull()
            return if (exitCode != null) {
                "Connection to the agent process was lost (exit code $exitCode)."
            } else {
                "Connection to the agent process was lost."
            }
        }
        if (client == null || !isInitialized) {
            return "Agent connection is not initialized."
        }

        val protocolActive = protocolScope?.coroutineContext?.get(Job)?.isActive == true
        if (!protocolActive) {
            return "The ACP transport is no longer active."
        }

        if (sessionUpdateWrapped) {
            val updateScopeActive = sessionUpdateScope?.coroutineContext?.get(Job)?.isActive == true
            val updateWorkerActive = sessionUpdateWorker?.isActive == true
            if (!updateScopeActive || !updateWorkerActive) {
                return "The ACP update stream stopped unexpectedly."
            }
        }

        return "Connection to the agent process was lost."
    }

    fun getAvailableModels(adapterName: String? = null): List<AcpAdapterConfig.ModelInfo> {
        val name = adapterName ?: AcpAdapterPaths.resolveAdapterName(null)
        if (!AcpAdapterPaths.isDownloaded(name)) {
            return emptyList()
        }
        return adapterRuntimeMetadataMap[name]?.availableModels ?: emptyList()
    }

    internal inner class AgentContext(val chatId: String) {
        val lifecycleMutex = Mutex()
        val statusRef = AtomicReference(Status.NotStarted)
        val sessionIdRef = AtomicReference<String?>(null)
        val activeAdapterNameRef = AtomicReference<String?>(null)
        val activeModelIdRef = AtomicReference<String?>(null)
        val activeModeIdRef = AtomicReference<String?>(null)
        @Volatile var lastHistoryLoadTime: Long = System.currentTimeMillis()
        @Volatile var allowReplayDelivery: Boolean = true
        @Volatile var ignoreUpdatesUntilPrompt: Boolean = false

        val pendingRequests = ConcurrentHashMap<String, CompletableDeferred<RequestPermissionResponse>>()

        @Volatile var sharedProcess: SharedProcess? = null
        @Volatile var session: ClientSession? = null

        fun stop() {
            session = null
            sharedProcess = null
            statusRef.set(Status.NotStarted)
            sessionIdRef.get()?.let { systemInstructionsInjectedSessionIds.remove(it) }
            sessionIdRef.set(null)
            synchronized(liveOwnerBySessionId) { liveOwnerBySessionId.entries.removeIf { it.value == chatId } }
            activeAdapterNameRef.set(null)
            activeModelIdRef.set(null)
            activeModeIdRef.set(null)
            lastHistoryLoadTime = 0
            allowReplayDelivery = true
            ignoreUpdatesUntilPrompt = false
            replayOwnerBySessionId.entries.removeIf { it.value == chatId }
            pendingRequests.values.forEach {
                it.complete(RequestPermissionResponse(RequestPermissionOutcome.Cancelled))
            }
            pendingRequests.clear()
        }

        fun markBroken() {
            session = null
            sharedProcess = null
            ignoreUpdatesUntilPrompt = false
            allowReplayDelivery = true
            pendingRequests.values.forEach {
                it.complete(RequestPermissionResponse(RequestPermissionOutcome.Cancelled))
            }
            pendingRequests.clear()
            statusRef.set(Status.Error)
        }
    }

    internal fun createAgentContext(chatId: String): AgentContext = AgentContext(chatId)
    internal fun createSharedProcess(adapterName: String): SharedProcess = SharedProcess(adapterName)
    internal fun createSharedSessionOperations(sessionId: String, adapterName: String): ClientSessionOperations =
        SharedSessionOperations(sessionId, adapterName)

    private inner class SharedSessionOperations(
        val sessionId: String,
        val adapterName: String
    ) : ClientSessionOperations {
        override suspend fun requestPermissions(
            toolCall: SessionUpdate.ToolCallUpdate,
            permissions: List<PermissionOption>,
            _meta: JsonElement?
        ): RequestPermissionResponse {
            if (permissions.isEmpty()) {
                return RequestPermissionResponse(RequestPermissionOutcome.Cancelled)
            }

            val primaryCtx = synchronized(liveOwnerBySessionId) {
                liveOwnerBySessionId[sessionId]
                    ?.let { ownerChatId -> sessions[ownerChatId] }
                    ?.takeIf { it.sessionIdRef.get() == sessionId }
            } ?: return RequestPermissionResponse(RequestPermissionOutcome.Cancelled)

            // Push the tool call as a SessionUpdate so the frontend creates
            // the tool-call block before the permission dialog appears.
            // During live prompting the SDK may not emit a separate
            // SessionUpdate.ToolCall before calling requestPermissions.
            sessionUpdateHandler?.invoke(primaryCtx.chatId, toolCall, false, _meta)

            val requestId = java.util.UUID.randomUUID().toString()
            // FRAGILE: ACP SDK 0.18.0 does not expose a title field directly on
            // SessionUpdate.ToolCallUpdate, so we extract it from the data class toString().
            // The regex assumes the format "title=<value>," which matches Kotlin's default
            // toString() output. Revisit when upgrading com.agentclientprotocol:acp —
            // check if a direct accessor (e.g. toolCall.title) becomes available.
            val str = toolCall.toString()
            val title = Regex("title=([^,)]+)").find(str)?.groupValues?.get(1) ?: "Action"

            val request = PermissionRequest(
                requestId,
                primaryCtx.chatId,
                title,
                permissions
            )

            val deferred = CompletableDeferred<RequestPermissionResponse>()
            primaryCtx.pendingRequests[requestId] = deferred

            permissionRequestHandler?.invoke(request)
                ?: deferred.complete(RequestPermissionResponse(RequestPermissionOutcome.Cancelled))

            return deferred.await()
        }

        override suspend fun notify(notification: SessionUpdate, _meta: JsonElement?) {
            val replayOwnerChatId = replayOwnerBySessionId[sessionId]
            val targetContext = if (replayOwnerChatId != null) {
                sessions[replayOwnerChatId]?.takeIf { it.allowReplayDelivery }
            } else {
                liveOwnerBySessionId[sessionId]
                    ?.let { ownerChatId -> sessions[ownerChatId] }
                    ?.takeIf { it.allowReplayDelivery && it.sessionIdRef.get() == sessionId }
            }
            if (targetContext == null) {
                return
            }

            if (notification is SessionUpdate.CurrentModeUpdate) {
                targetContext.activeModeIdRef.set(notification.currentModeId.value)
            }

            val handler = sessionUpdateHandler
            if (handler == null || targetContext.ignoreUpdatesUntilPrompt) {
                return
            }

            val isReplayDelivery =
                replayOwnerChatId != null &&
                replayOwnerChatId == targetContext.chatId
            handler.invoke(targetContext.chatId, notification, isReplayDelivery, _meta)
        }
    }

}

internal fun AcpClientService.promptDispatchFailure(chatId: String): String? {
    val context = sessions[chatId] ?: return "No active agent session."
    val session = context.session ?: return "No active agent session."
    val sharedProcess = context.sharedProcess ?: return "Connection to the agent process is unavailable."
    if (!sharedProcess.isHealthy()) {
        return sharedProcess.failureReason()
    }
    return if (session.sessionId.value.isBlank()) "No active agent session." else null
}

internal fun AcpClientService.cancelDispatchFailure(chatId: String): String? {
    val context = sessions[chatId] ?: return "No active prompt is running."
    val sharedProcess = context.sharedProcess ?: return "Connection to the agent process is unavailable."
    if (!sharedProcess.isHealthy()) {
        return sharedProcess.failureReason()
    }
    return null
}

internal suspend fun AcpClientService.markChatSessionBroken(chatId: String) {
    val context = sessions[chatId] ?: return
    context.lifecycleMutex.withLock {
        context.markBroken()
    }
}

internal sealed interface QueuedSessionUpdate {
    data class Notification(
        val notification: JsonRpcNotification,
        val completed: CompletableDeferred<Unit>
    ) : QueuedSessionUpdate
    data class Barrier(val completed: CompletableDeferred<Unit>) : QueuedSessionUpdate
}
