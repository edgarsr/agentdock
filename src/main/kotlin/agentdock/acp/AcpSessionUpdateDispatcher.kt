package agentdock.acp

import com.agentclientprotocol.model.AcpMethod
import com.agentclientprotocol.protocol.Protocol
import com.agentclientprotocol.rpc.JsonRpcNotification
import com.agentclientprotocol.rpc.MethodName
import kotlinx.atomicfu.AtomicRef
import kotlinx.collections.immutable.PersistentMap
import kotlinx.collections.immutable.mutate
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

private const val SESSION_UPDATE_MESSAGE_ID_META_KEY = "agentdock/sessionUpdateMessageId"

internal fun AcpClientService.ensureAsyncSessionUpdates(sharedProcess: AcpClientService.SharedProcess) {
    synchronized(sharedProcess) {
        if (sharedProcess.sessionUpdateWrapped) return
        val protocol = sharedProcess.protocol ?: return
        try {
            // The SDK handles session/update privately. Wrapping its raw handler
            // preserves one ordered queue across both public delivery paths.
            val field = Protocol::class.java.getDeclaredField("notificationHandlers")
            field.isAccessible = true
            @Suppress("UNCHECKED_CAST")
            val handlers = field.get(protocol) as AtomicRef<
                PersistentMap<MethodName, suspend (JsonRpcNotification) -> Unit>
            >
            val methodName = AcpMethod.ClientMethods.SessionUpdate.methodName
            val original = handlers.value[methodName] ?: return

            val updateScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val queue = Channel<QueuedSessionUpdate>(Channel.UNLIMITED)
            sharedProcess.sessionUpdateScope = updateScope
            sharedProcess.sessionUpdateQueue = queue
            sharedProcess.sessionUpdateWorker = updateScope.launch {
                for (entry in queue) dispatchQueuedSessionUpdate(entry, original)
            }

            val wrapped: suspend (JsonRpcNotification) -> Unit = { notification ->
                extractAvailableCommands(notification.params)?.let { commands ->
                    updateAvailableCommands(sharedProcess.adapterName, commands)
                }
                updateRuntimeMetadataFromConfigOptionsNotification(sharedProcess.adapterName, notification.params)

                val sessionId = extractSessionUpdateSessionId(notification.params)
                val isSdkOwnedSession = sessionId == null ||
                    liveOwnerBySessionId.containsKey(sessionId) ||
                    replayOwnerBySessionId.containsKey(sessionId)
                if (isSdkOwnedSession) {
                    val completed = CompletableDeferred<Unit>()
                    queue.send(QueuedSessionUpdate.Notification(notification, completed))
                    completed.await()
                }
            }
            handlers.value = handlers.value.mutate { it[methodName] = wrapped }
            sharedProcess.sessionUpdateWrapped = true
        } catch (_: Exception) {
            sharedProcess.clearSessionUpdateDispatcher()
        }
    }
}

private suspend fun dispatchQueuedSessionUpdate(
    entry: QueuedSessionUpdate,
    original: suspend (JsonRpcNotification) -> Unit
) {
    when (entry) {
        is QueuedSessionUpdate.Notification -> {
            try {
                original(entry.notification.withSessionUpdateMessageIdMeta())
                entry.completed.complete(Unit)
            } catch (error: Throwable) {
                entry.completed.completeExceptionally(error)
            }
        }
        is QueuedSessionUpdate.Barrier -> entry.completed.complete(Unit)
    }
}

private fun JsonRpcNotification.withSessionUpdateMessageIdMeta(): JsonRpcNotification {
    val paramsObject = params as? JsonObject ?: return this
    val updateObject = paramsObject["update"] as? JsonObject ?: return this
    if ((updateObject["sessionUpdate"] as? JsonPrimitive)?.contentOrNull != "user_message_chunk") return this
    val messageId = (updateObject["messageId"] as? JsonPrimitive)
        ?.contentOrNull
        ?.trim()
        ?.takeIf(String::isNotEmpty) ?: return this
    val meta = paramsObject["_meta"] as? JsonObject ?: JsonObject(emptyMap())
    val enrichedMeta = JsonObject(meta + (SESSION_UPDATE_MESSAGE_ID_META_KEY to JsonPrimitive(messageId)))
    return copy(params = JsonObject(paramsObject + ("_meta" to enrichedMeta)))
}

internal fun sessionUpdateMessageIdFromMeta(meta: kotlinx.serialization.json.JsonElement?): String? =
    ((meta as? JsonObject)?.get(SESSION_UPDATE_MESSAGE_ID_META_KEY) as? JsonPrimitive)
        ?.contentOrNull
        ?.trim()
        ?.takeIf(String::isNotEmpty)

private fun AcpClientService.SharedProcess.clearSessionUpdateDispatcher() {
    sessionUpdateQueue?.close()
    sessionUpdateQueue = null
    sessionUpdateWorker?.cancel()
    sessionUpdateWorker = null
    sessionUpdateScope?.coroutineContext?.cancel()
    sessionUpdateScope = null
    sessionUpdateWrapped = false
}

private fun AcpClientService.updateRuntimeMetadataFromConfigOptionsNotification(
    adapterName: String,
    params: kotlinx.serialization.json.JsonElement?
) {
    val (sessionId, configOptions) = extractConfigOptionsUpdate(params) ?: return
    if (configProbeSessionKeys.contains(configProbeSessionKey(adapterName, sessionId))) return
    if (replayOwnerBySessionId.containsKey(sessionId)) return
    val adapterInfo = AcpAdapterPaths.getAdapterInfo(adapterName)
    val targetContext = synchronized(liveOwnerBySessionId) {
        liveOwnerBySessionId[sessionId]?.let { ownerChatId -> sessions[ownerChatId] }
    }
    val metadata = runtimeMetadataFromConfigOptionsJson(configOptions, adapterInfo)
    if (targetContext != null) {
        updateSessionRuntimeMetadata(adapterInfo, metadata, targetContext)
    } else {
        AcpConfigOptionsCache.updateFromSnapshot(adapterInfo, metadata)
    }
}

internal fun AcpClientService.extractAvailableCommands(
    params: kotlinx.serialization.json.JsonElement?
): List<AvailableCommandPayload>? {
    val paramsObject = params as? JsonObject ?: return null
    val updateObject = paramsObject["update"] as? JsonObject ?: return null
    val updateType = (updateObject["sessionUpdate"] as? JsonPrimitive)?.contentOrNull ?: return null
    if (updateType != "available_commands_update") return null

    return (updateObject["availableCommands"] as? JsonArray)
        ?.mapNotNull { element ->
            val command = element as? JsonObject ?: return@mapNotNull null
            val name = (command["name"] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()
            if (name.isEmpty()) return@mapNotNull null
            val description = (command["description"] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()
            val inputHint = ((command["input"] as? JsonObject)?.get("hint") as? JsonPrimitive)
                ?.contentOrNull
                ?.trim()
                ?.takeIf(String::isNotEmpty)
            AvailableCommandPayload(name = name, description = description, inputHint = inputHint)
        }
        ?: emptyList()
}
