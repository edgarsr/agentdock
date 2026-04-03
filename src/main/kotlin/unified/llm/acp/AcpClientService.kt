package unified.llm.acp

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
import kotlinx.serialization.json.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.atomic.AtomicBoolean

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
            try {
                processHandle?.let { AcpProcessUtils.destroyProcessTree(it) } ?: run {
                    runningProcess?.destroyForcibly()
                    runningProcess?.waitFor(2, TimeUnit.SECONDS)
                }
            } catch (_: Exception) {}
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
    internal val replayOwnerBySessionId = ConcurrentHashMap<String, String>()
    internal val startupInitializationStarted = AtomicBoolean(false)
    internal val adapterInitialization = ConcurrentHashMap<String, CompletableDeferred<Unit>>()
    internal val adapterInitializationJobs = ConcurrentHashMap<String, Job>()
    internal val adapterInitializationScopes = ConcurrentHashMap<String, CoroutineScope>()
    internal val adapterInitializationState = ConcurrentHashMap<String, AdapterInitializationStatus>()
    internal val adapterInitializationErrors = ConcurrentHashMap<String, String>()
    internal val adapterRuntimeMetadataMap = ConcurrentHashMap<String, AdapterRuntimeMetadata>()
    internal val availableCommandsByAdapter = ConcurrentHashMap<String, List<AvailableCommandPayload>>()
    internal val systemInstructionsInjectedSessionIds: MutableSet<String> = ConcurrentHashMap.newKeySet()
    internal val executionTargetRef = AtomicReference(AcpAdapterPaths.getExecutionTarget())

    fun status(chatId: String): Status = sessions[chatId]?.statusRef?.get() ?: Status.NotStarted
    fun sessionId(chatId: String): String? = sessions[chatId]?.sessionIdRef?.get()
    fun activeModelId(chatId: String): String? = sessions[chatId]?.activeModelIdRef?.get()
    fun activeModeId(chatId: String): String? = sessions[chatId]?.activeModeIdRef?.get()
    fun adapterInitializationStatus(adapterName: String): AdapterInitializationStatus {
        return adapterInitializationState[adapterName] ?: AdapterInitializationStatus.NotStarted
    }
    fun adapterInitializationError(adapterName: String): String? = adapterInitializationErrors[adapterName]
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
        error: String? = null
    ) {
        adapterInitializationState[adapterName] = state
        if (error.isNullOrBlank()) {
            adapterInitializationErrors.remove(adapterName)
        } else {
            adapterInitializationErrors[adapterName] = error
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

    fun getAvailableModels(adapterName: String? = null): List<AcpAdapterConfig.ModelInfo> {
        val name = adapterName ?: AcpAdapterPaths.resolveAdapterName(null)
        if (!AcpAdapterPaths.isDownloaded(name)) {
            return emptyList()
        }
        return (adapterRuntimeMetadataMap[name] ?: configFallbackMetadata(name))?.availableModels ?: emptyList()
    }

    private fun configFallbackMetadata(adapterName: String): AdapterRuntimeMetadata? {
        val adapterInfo = runCatching { AcpAdapterPaths.getAdapterInfo(adapterName) }.getOrNull() ?: return null
        val defaultModel = adapterInfo.defaultModel?.let {
            AcpAdapterConfig.ModelInfo(
                modelId = it.modelId,
                name = it.name,
                description = it.description
            )
        }
        val defaultMode = adapterInfo.defaultMode?.let {
            AcpAdapterConfig.ModeInfo(
                id = it.modeId,
                name = it.name,
                description = it.description
            )
        }
        return AdapterRuntimeMetadata(
            currentModelId = defaultModel?.modelId,
            availableModels = defaultModel?.let { listOf(it) } ?: emptyList(),
            currentModeId = defaultMode?.id,
            availableModes = defaultMode?.let { listOf(it) } ?: emptyList()
        )
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

        val pendingRequests = ConcurrentHashMap<String, CompletableDeferred<RequestPermissionResponse>>()

        @Volatile var sharedProcess: SharedProcess? = null
        @Volatile var session: ClientSession? = null

        fun stop() {
            session = null
            sharedProcess = null
            statusRef.set(Status.NotStarted)
            sessionIdRef.get()?.let { systemInstructionsInjectedSessionIds.remove(it) }
            sessionIdRef.set(null)
            activeAdapterNameRef.set(null)
            activeModelIdRef.set(null)
            activeModeIdRef.set(null)
            lastHistoryLoadTime = 0
            allowReplayDelivery = true
            replayOwnerBySessionId.entries.removeIf { it.value == chatId }
            pendingRequests.values.forEach {
                it.complete(RequestPermissionResponse(RequestPermissionOutcome.Cancelled))
            }
            pendingRequests.clear()
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

            val matchingContexts = sessions.values.filter { it.sessionIdRef.get() == sessionId }
            val primaryCtx = matchingContexts.firstOrNull()
                ?: return RequestPermissionResponse(RequestPermissionOutcome.Cancelled)

            // Push the tool call as a SessionUpdate so the frontend creates
            // the tool-call block before the permission dialog appears.
            // During live prompting the SDK may not emit a separate
            // SessionUpdate.ToolCall before calling requestPermissions.
            sessionUpdateHandler?.invoke(primaryCtx.chatId, toolCall, false, _meta)

            val requestId = java.util.UUID.randomUUID().toString()
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
            val ownerChatId = replayOwnerBySessionId[sessionId]
            var matchingContexts = if (ownerChatId != null) {
                sessions[ownerChatId]?.takeIf { it.allowReplayDelivery }?.let { listOf(it) } ?: emptyList()
            } else {
                sessions.values.filter { it.allowReplayDelivery && it.sessionIdRef.get() == sessionId }
            }
            if (matchingContexts.isEmpty()) {
                // Fallback path: during session load, ACP can emit updates before the
                // final session id is fully reflected in the chat context. In that case,
                // route replay updates to contexts that are currently initializing the
                // same adapter process in a recent load window.
                val now = System.currentTimeMillis()
                matchingContexts = sessions.values.filter { ctx ->
                    ctx.allowReplayDelivery &&
                    ctx.statusRef.get() == Status.Initializing &&
                        ctx.sharedProcess?.adapterName == adapterName &&
                        (now - ctx.lastHistoryLoadTime) <= 60_000L
                }
                // Last-resort routing: deliver-first for same adapter contexts.
                if (matchingContexts.isEmpty()) {
                    matchingContexts = sessions.values.filter { it.allowReplayDelivery && it.sharedProcess?.adapterName == adapterName }
                }
            }
            if (matchingContexts.isEmpty()) {
                return
            }
            matchingContexts.forEach { context ->
                if (notification is SessionUpdate.CurrentModeUpdate) {
                    context.activeModeIdRef.set(notification.currentModeId.value)
                }

                val handler = sessionUpdateHandler
                if (handler == null) {
                    return@forEach
                }

                val isReplayDelivery =
                    ownerChatId != null &&
                    ownerChatId == context.chatId &&
                    context.statusRef.get() == Status.Initializing
                handler.invoke(context.chatId, notification, isReplayDelivery, _meta)
            }
        }
    }

}

internal sealed interface QueuedSessionUpdate {
    data class Notification(val notification: JsonRpcNotification) : QueuedSessionUpdate
    data class Barrier(val completed: CompletableDeferred<Unit>) : QueuedSessionUpdate
}
