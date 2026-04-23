package agentdock.acp

import com.agentclientprotocol.common.Event
import com.agentclientprotocol.model.ContentBlock
import com.agentclientprotocol.model.PermissionOptionId
import com.agentclientprotocol.model.RequestPermissionOutcome
import com.agentclientprotocol.model.RequestPermissionResponse
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.sync.withLock
import agentdock.systeminstructions.SystemInstructionsStore

internal fun AcpClientService.respondToPermissionRequest(requestId: String, decision: String) {
    for (context in sessions.values) {
        val deferred = context.pendingRequests.remove(requestId)
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
    context.ignoreUpdatesUntilPrompt = false
    var stopReason: String? = null
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
            systemInstructionsInjectedSessionIds.remove(sessionId)
            blocks
        }
    } else {
        blocks
    }

    try {
        session.prompt(promptBlocks).collect { event ->
            when (event) {
                is Event.SessionUpdateEvent -> sessionUpdateHandler?.invoke(chatId, event.update, false, null)
                is Event.PromptResponseEvent -> stopReason = event.response.stopReason.toString()
            }
        }
        if (!activeAdapterName.isNullOrBlank()) {
            awaitPendingSessionUpdates(activeAdapterName)
        }
        stopReason?.let { emit(AcpEvent.PromptDone(it)) }
    } catch (e: Exception) {
        if (e is kotlinx.coroutines.CancellationException) throw e
        emit(AcpEvent.Error(formatAcpError(e)))
    } finally {
        if (context.statusRef.get() == AcpClientService.Status.Prompting) {
            context.statusRef.set(AcpClientService.Status.Ready)
        }
    }
}

internal suspend fun AcpClientService.cancel(chatId: String) {
    val context = sessions[chatId] ?: return
    cancelWithContext(context)
    context.pendingRequests.values.forEach {
        it.complete(RequestPermissionResponse(RequestPermissionOutcome.Cancelled))
    }
    context.pendingRequests.clear()
}

internal suspend fun AcpClientService.cancelWithContext(context: AcpClientService.AgentContext) {
    val session = context.lifecycleMutex.withLock { context.session } ?: return
    try {
        session.cancel()
    } finally {
        if (context.statusRef.get() == AcpClientService.Status.Prompting) {
            context.statusRef.set(AcpClientService.Status.Ready)
        }
    }
}

internal suspend fun AcpClientService.stopAgent(chatId: String) {
    val context = sessions[chatId] ?: return
    cancel(chatId)
    sessions.remove(chatId)
    context.stop()
}

internal fun AcpClientService.stopSharedProcess(adapterName: String) {
    ensureExecutionTargetCurrent()
    adapterInitializationJobs.remove(adapterName)?.cancel()
    adapterInitializationScopes.remove(adapterName)?.coroutineContext?.cancel()
    val shared = activeProcesses.remove(processKey(adapterName))
    teardownAdapterProcess(adapterName, shared)
    updateAdapterInitializationState(adapterName, AcpClientService.AdapterInitializationStatus.NotStarted)
    adapterInitialization.remove(adapterName)
    adapterRuntimeMetadataMap.remove(adapterName)
    availableCommandsByAdapter.remove(adapterName)
    sessions.values.filter { it.sharedProcess == shared }.forEach { it.stop() }
}

internal fun AcpClientService.replaceSharedProcess(adapterName: String): AcpClientService.SharedProcess {
    ensureExecutionTargetCurrent()
    val previous = activeProcesses.remove(processKey(adapterName))
    teardownAdapterProcess(adapterName, previous)
    return createSharedProcess(adapterName).also { activeProcesses[processKey(adapterName)] = it }
}

internal fun AcpClientService.teardownAdapterProcess(
    adapterName: String,
    shared: AcpClientService.SharedProcess?
) {
    runCatching { shared?.stop() }
    runCatching { AcpProcessUtils.stopProcessesUsingAdapterRoot(adapterName) }
}

internal fun AcpClientService.resetExecutionEnvironment(
    clearSessions: Boolean,
    restartDownloadedAdapters: Boolean
) {
    adapterInitializationJobs.values.forEach { it.cancel() }
    adapterInitializationJobs.clear()
    adapterInitializationScopes.values.forEach { it.coroutineContext.cancel() }
    adapterInitializationScopes.clear()
    adapterInitialization.clear()
    adapterInitializationState.clear()
    adapterInitializationErrors.clear()
    adapterInitializationDetails.clear()
    adapterRuntimeMetadataMap.clear()
    availableCommandsByAdapter.clear()
    systemInstructionsInjectedSessionIds.clear()
    replayOwnerBySessionId.clear()

    sessions.values.forEach { it.stop() }
    if (clearSessions) {
        sessions.clear()
    }

    val processes = activeProcesses.values.toList()
    activeProcesses.clear()
    processes.forEach { shared ->
        runCatching { teardownAdapterProcess(shared.adapterName, shared) }
    }

    startupInitializationStarted.set(false)
    if (restartDownloadedAdapters) {
        initializeDownloadedAdaptersInBackground()
    }
}

internal fun AcpClientService.shutdown() {
    scope.coroutineContext[kotlinx.coroutines.Job]?.cancel()
    resetExecutionEnvironment(
        clearSessions = true,
        restartDownloadedAdapters = false
    )
}

internal suspend fun AcpClientService.awaitPendingSessionUpdates(adapterName: String) {
    val sharedProc = activeProcesses[processKey(adapterName)] ?: return
    val queue = sharedProc.sessionUpdateQueue ?: return
    val completed = CompletableDeferred<Unit>()
    queue.send(QueuedSessionUpdate.Barrier(completed))
    completed.await()
}
