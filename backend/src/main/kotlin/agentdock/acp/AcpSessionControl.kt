package agentdock.acp

import com.agentclientprotocol.common.Event
import com.agentclientprotocol.model.ContentBlock
import com.agentclientprotocol.model.PermissionOptionId
import com.agentclientprotocol.model.RequestPermissionOutcome
import com.agentclientprotocol.model.RequestPermissionResponse
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import agentdock.systeminstructions.SystemInstructionsStore
import kotlin.time.Duration.Companion.seconds

private val SESSION_CLOSE_TIMEOUT = 3.seconds

internal fun AcpClientService.respondToPermissionRequest(requestId: String, decision: String) {
    for (context in sessions.values) {
        val deferred = context.pendingRequests.remove(requestId)?.response
        if (deferred != null) {
            deferred.complete(RequestPermissionResponse(RequestPermissionOutcome.Selected(PermissionOptionId(decision))))
            return
        }
    }
}

internal fun AcpClientService.prompt(chatId: String, blocks: List<ContentBlock>): Flow<AcpEvent> = flow {
    val context = sessions[chatId]
    if (context == null) {
        emit(AcpEvent.Error("No session for $chatId"))
        return@flow
    }

    val session = context.lifecycleMutex.withLock {
        val activeSession = context.session
        if (activeSession == null) {
            emit(AcpEvent.Error("No active agent session."))
            return@flow
        }
        activeSession
    }

    context.statusRef.set(AcpClientService.Status.Prompting)
    synchronized(context.observedToolCallIds) { context.observedToolCallIds.clear() }
    val promptGeneration = context.promptGeneration.incrementAndGet()
    context.ignoreUpdatesUntilPrompt = false
    var promptResponseReceived = false
    val activeAdapterName = context.activeAdapterNameRef.get()
    if (!activeAdapterName.isNullOrBlank()) {
        AcpAgentPreferencesStore.rememberAgent(activeAdapterName)
    }

    val sessionId = context.sessionIdRef.get()
    val isFirstPrompt = !sessionId.isNullOrBlank() && systemInstructionsInjectedSessionIds.add(sessionId)
    val promptBlocks = if (isFirstPrompt) {
        val injectedBlock = SystemInstructionsStore.buildInitialPromptBlock()
        if (injectedBlock != null) {
            listOf(injectedBlock) + blocks
        } else {
            blocks
        }
    } else {
        blocks
    }

    try {
        session.prompt(promptBlocks).collect { event ->
            when (event) {
                is Event.SessionUpdateEvent -> {
                    if (context.promptGeneration.get() == promptGeneration && !context.ignoreUpdatesUntilPrompt) {
                        context.deliverSessionUpdate(event.update, false, null)
                    }
                }
                is Event.PromptResponseEvent -> promptResponseReceived = true
            }
        }
        val isCurrentPrompt = context.promptGeneration.get() == promptGeneration && !context.ignoreUpdatesUntilPrompt
        if (isCurrentPrompt && !activeAdapterName.isNullOrBlank()) {
            awaitPendingSessionUpdates(activeAdapterName)
        }
        if (isCurrentPrompt && promptResponseReceived) {
            emit(AcpEvent.PromptDone)
        }
    } catch (e: Exception) {
        if (e is CancellationException) throw e
        if (context.promptGeneration.get() == promptGeneration && !context.ignoreUpdatesUntilPrompt) {
            emit(AcpEvent.Error(formatAcpError(e)))
        }
    } finally {
        if (context.promptGeneration.get() == promptGeneration && context.statusRef.get() == AcpClientService.Status.Prompting) {
            context.statusRef.set(AcpClientService.Status.Ready)
        }
    }
}

internal suspend fun AcpClientService.cancel(chatId: String) {
    val context = sessions[chatId] ?: return
    try {
        context.lifecycleMutex.withLock { context.session }?.let { session ->
            context.ignoreUpdatesUntilPrompt = true
            session.cancel()
        }
    } finally {
        context.cancelPendingPermissions()
        context.cancelPendingElicitations()
    }
}

internal suspend fun AcpClientService.stopAgent(chatId: String) {
    val context = sessions[chatId] ?: return
    context.lifecycleMutex.withLock {
        try {
            context.ignoreUpdatesUntilPrompt = true
            context.cancelPendingPermissions()
            context.cancelPendingElicitations()
            try {
                context.session?.cancel()
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                // Still attempt to close the remote session if cancelling its prompt failed.
            }
            val sharedProcess = context.sharedProcess
            val sessionId = context.sessionIdRef.get()
            if (sharedProcess?.sessionCloseAvailable == true && sessionId != null) {
                withTimeoutOrNull(SESSION_CLOSE_TIMEOUT) {
                    sharedProcess.protocol?.closeAcpSession(sessionId)
                }
            }
        } finally {
            sessions.remove(chatId, context)
            context.stop()
        }
    }
}

internal fun AcpClientService.stopSharedProcess(adapterName: String) {
    adapterInitializationJobs.remove(adapterName)?.cancel()
    val shared = activeProcesses.remove(adapterName)
    teardownAdapterProcess(shared)
    updateAdapterInitializationState(adapterName, AcpClientService.AdapterInitializationStatus.NotStarted)
    adapterRuntimeMetadataMap.remove(adapterName)
    availableCommandsByAdapter.remove(adapterName)
    if (shared != null) sessions.values.filter { it.sharedProcess == shared }.forEach { it.stop() }
}

internal fun AcpClientService.replaceSharedProcess(adapterName: String): AcpClientService.SharedProcess {
    val previous = activeProcesses.remove(adapterName)
    teardownAdapterProcess(previous)
    return createSharedProcess(adapterName).also { activeProcesses[adapterName] = it }
}

internal fun AcpClientService.teardownAdapterProcess(
    shared: AcpClientService.SharedProcess?
) {
    runCatching { shared?.retire() }
}

internal fun AcpClientService.shutdown() {
    scope.coroutineContext[kotlinx.coroutines.Job]?.cancel()
    adapterInitializationJobs.values.forEach { it.cancel() }
    adapterInitializationJobs.clear()
    adapterInitializationState.clear()
    adapterInitializationErrors.clear()
    adapterInitializationDetails.clear()
    adapterRuntimeMetadataMap.clear()
    loginStatusStates.clear()
    availableCommandsByAdapter.clear()
    systemInstructionsInjectedSessionIds.clear()
    replayOwnerBySessionId.clear()
    configProbeSessionKeys.clear()

    sessions.values.forEach { it.stop() }
    sessions.clear()

    val processes = activeProcesses.values.toList()
    activeProcesses.clear()
    processes.forEach { shared ->
        runCatching { teardownAdapterProcess(shared) }
    }
}

internal suspend fun AcpClientService.awaitPendingSessionUpdates(adapterName: String) {
    val sharedProc = activeProcesses[adapterName] ?: return
    val queue = sharedProc.sessionUpdateQueue ?: return
    val completed = CompletableDeferred<Unit>()
    queue.send(QueuedSessionUpdate.Barrier(completed))
    completed.await()
}
