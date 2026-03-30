package unified.llm.acp

import com.agentclientprotocol.client.ClientOperationsFactory
import com.agentclientprotocol.common.ClientSessionOperations
import com.agentclientprotocol.common.Event
import com.agentclientprotocol.model.*
import com.agentclientprotocol.common.SessionCreationParameters
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import unified.llm.history.SessionMeta
import unified.llm.mcp.McpConfigStore
import unified.llm.mcp.McpServerConfig
import unified.llm.systeminstructions.SystemInstructionsStore

private fun buildMcpServers(): List<McpServer> =
    McpConfigStore.loadEnabled().mapNotNull { it.toSdkMcpServer() }

private fun McpServerConfig.toSdkMcpServer(): McpServer? = when (transport) {
    "stdio" -> {
        val cmd = command?.takeIf { it.isNotBlank() } ?: return null
        McpServer.Stdio(
            name = name,
            command = cmd,
            args = args ?: emptyList(),
            env = env?.map { EnvVariable(it.name, it.value) } ?: emptyList()
        )
    }
    "http" -> {
        val u = url?.takeIf { it.isNotBlank() } ?: return null
        McpServer.Http(
            name = name,
            url = u,
            headers = headers?.map { HttpHeader(it.name, it.value) } ?: emptyList()
        )
    }
    "sse" -> {
        val u = url?.takeIf { it.isNotBlank() } ?: return null
        McpServer.Sse(
            name = name,
            url = u,
            headers = headers?.map { HttpHeader(it.name, it.value) } ?: emptyList()
        )
    }
    else -> null
}

internal fun AcpClientService.processKey(adapterName: String): String {
    return "${AcpAdapterPaths.getExecutionTarget().name.lowercase()}:$adapterName"
}

internal fun AcpClientService.ensureExecutionTargetCurrent() {
    val currentTarget = AcpAdapterPaths.getExecutionTarget()
    val previousTarget = executionTargetRef.getAndSet(currentTarget)
    if (previousTarget == currentTarget) {
        return
    }

    resetExecutionEnvironment(previousTarget, clearSessions = false, restartDownloadedAdapters = false)
}

internal fun AcpClientService.resolveSessionCwd(path: String): String {
    return when (AcpAdapterPaths.getExecutionTarget()) {
        AcpExecutionTarget.LOCAL -> path
        AcpExecutionTarget.WSL -> AcpExecutionMode.toWslPath(path) ?: path
    }
}

@Suppress("OPT_IN_USAGE")
internal suspend fun AcpClientService.startAgent(
    chatId: String,
    adapterName: String? = null,
    preferredModelId: String? = null,
    resumeSessionId: String? = null,
    forceRestart: Boolean = false
) {
    ensureExecutionTargetCurrent()
    val context = sessions.computeIfAbsent(chatId) { createAgentContext(chatId) }

    withContext(Dispatchers.IO) {
        context.lifecycleMutex.withLock {
            val adapterInfo = AcpAdapterPaths.getAdapterInfo(adapterName)
            val requestedAdapterName = adapterInfo.id
            val currentStatus = context.statusRef.get()

            if (currentStatus == AcpClientService.Status.Ready && context.activeAdapterNameRef.get() == requestedAdapterName && resumeSessionId == null && !forceRestart) {
                return@withLock
            }

            if (currentStatus != AcpClientService.Status.NotStarted) {
                context.stop()
            }

            if (!AcpAdapterPaths.isDownloaded(requestedAdapterName)) {
                val msg = "Agent '$requestedAdapterName' is not downloaded"
                context.statusRef.set(AcpClientService.Status.Error)
                throw IllegalStateException(msg)
            }

            context.statusRef.set(AcpClientService.Status.Initializing)

            try {
            val sharedProc = activeProcesses.computeIfAbsent(processKey(requestedAdapterName)) { createSharedProcess(requestedAdapterName) }
            context.sharedProcess = sharedProc

            ensureSharedProcessStarted(sharedProc, adapterInfo, forceRestart)
            ensureAsyncSessionUpdates(sharedProc)
            val runtimeMetadata = adapterRuntimeMetadataMap[requestedAdapterName]

            val client = sharedProc.client!!
            val cwd = resolveSessionCwd(project.basePath ?: System.getProperty("user.dir"))

                val factory = object : ClientOperationsFactory {
                    override suspend fun createClientOperations(
                        sessionId: SessionId,
                        sessionResponse: AcpCreatedSessionResponse
                    ): ClientSessionOperations {
                        context.sessionIdRef.compareAndSet(null, sessionId.value)
                        return createSharedSessionOperations(sessionId.value, requestedAdapterName)
                    }
                }

                val params = SessionCreationParameters(cwd = cwd, mcpServers = buildMcpServers())
                val sess = if (resumeSessionId != null) {
                    try {
                        client.resumeSession(SessionId(resumeSessionId), params, factory)
                    } catch (e: Exception) {
                        client.newSession(params, factory)
                    }
                } else {
                    client.newSession(params, factory)
                }

                context.session = sess
                context.sessionIdRef.set(sess.sessionId.value)
                if (resumeSessionId != null && sess.sessionId.value == resumeSessionId) {
                    systemInstructionsInjectedSessionIds.add(sess.sessionId.value)
                }

                val selectedModelId = resolveModelToApply(
                    preferredModelId,
                    runtimeMetadata?.availableModels ?: emptyList(),
                    runtimeMetadata?.currentModelId
                )
                if (selectedModelId != null) {
                    try {
                        sess.setModel(ModelId(selectedModelId))
                        context.activeModelIdRef.set(selectedModelId)
                    } catch (e: Exception) {
                    }
                }

                val currentModeId = runtimeMetadata?.currentModeId
                if (currentModeId != null) {
                    try {
                        sess.setMode(SessionModeId(currentModeId))
                        context.activeModeIdRef.set(currentModeId)
                    } catch (e: Exception) {
                    }
                }

                context.activeAdapterNameRef.set(requestedAdapterName)
                context.statusRef.set(AcpClientService.Status.Ready)

            } catch (e: Exception) {
                context.stop()
                context.statusRef.set(AcpClientService.Status.Error)
                throw e
            }
        }
    }
}

@Suppress("OPT_IN_USAGE")
internal suspend fun AcpClientService.loadSession(
    chatId: String,
    adapterName: String,
    sessionId: String,
    preferredModelId: String? = null,
    preferredModeId: String? = null
) {
    ensureExecutionTargetCurrent()
    val context = sessions.computeIfAbsent(chatId) { createAgentContext(chatId) }

    withContext(Dispatchers.IO) {
        context.lifecycleMutex.withLock {
            val adapterInfo = AcpAdapterPaths.getAdapterInfo(adapterName)
            val requestedAdapterName = adapterInfo.id
            val currentStatus = context.statusRef.get()

            if (currentStatus != AcpClientService.Status.NotStarted) {
                context.stop()
            }

            context.statusRef.set(AcpClientService.Status.Initializing)
            context.lastHistoryLoadTime = System.currentTimeMillis()
            context.activeAdapterNameRef.set(null)
            context.activeModelIdRef.set(null)
            context.activeModeIdRef.set(null)

            try {
                loadSessionIntoContext(
                    context = context,
                    adapterName = requestedAdapterName,
                    sessionId = sessionId,
                    preferredModelId = preferredModelId,
                    preferredModeId = preferredModeId,
                    keepLoadedSessionActive = true
                )
                context.statusRef.set(AcpClientService.Status.Ready)
            } catch (e: Exception) {
                context.stop()
                context.statusRef.set(AcpClientService.Status.Error)
                throw e
            }
        }
    }
}

@Suppress("OPT_IN_USAGE")
internal suspend fun AcpClientService.loadConversation(chatId: String, sessionsChain: List<SessionMeta>) {
    ensureExecutionTargetCurrent()
    if (sessionsChain.isEmpty()) {
        throw IllegalArgumentException("Conversation session chain is empty")
    }

    val context = sessions.computeIfAbsent(chatId) { createAgentContext(chatId) }

    withContext(Dispatchers.IO) {
        context.lifecycleMutex.withLock {
            val currentStatus = context.statusRef.get()
            if (currentStatus != AcpClientService.Status.NotStarted) {
                context.stop()
            }

            context.statusRef.set(AcpClientService.Status.Initializing)
            context.lastHistoryLoadTime = System.currentTimeMillis()
            context.activeAdapterNameRef.set(null)
            context.activeModelIdRef.set(null)
            context.activeModeIdRef.set(null)

            try {
                sessionsChain.forEachIndexed { index, session ->
                    val keepActive = index == sessionsChain.lastIndex
                    loadSessionIntoContext(
                        context = context,
                        adapterName = session.adapterName,
                        sessionId = session.sessionId,
                        preferredModelId = session.modelId,
                        preferredModeId = session.modeId,
                        keepLoadedSessionActive = keepActive
                    )
                }

                context.statusRef.set(AcpClientService.Status.Ready)
            } catch (e: Exception) {
                context.stop()
                context.statusRef.set(AcpClientService.Status.Error)
                throw e
            }
        }
    }
}

@Suppress("OPT_IN_USAGE")
internal suspend fun AcpClientService.loadSessionIntoContext(
    context: AcpClientService.AgentContext,
    adapterName: String,
    sessionId: String,
    preferredModelId: String?,
    preferredModeId: String?,
    keepLoadedSessionActive: Boolean
) {
    ensureExecutionTargetCurrent()
    val adapterInfo = AcpAdapterPaths.getAdapterInfo(adapterName)
    val requestedAdapterName = adapterInfo.id
    replayOwnerBySessionId[sessionId] = context.chatId

    val sharedProc = activeProcesses.computeIfAbsent(processKey(requestedAdapterName)) { createSharedProcess(requestedAdapterName) }
    context.sharedProcess = sharedProc

    ensureSharedProcessStarted(sharedProc, adapterInfo)
    ensureAsyncSessionUpdates(sharedProc)

    // Set sessionIdRef BEFORE client.loadSession() so that the async
    // notification worker can match this context for the very first
    // replay notification.
    context.sessionIdRef.set(sessionId)

    val client = sharedProc.client!!
    val cwd = resolveSessionCwd(project.basePath ?: System.getProperty("user.dir"))

    val factory = object : ClientOperationsFactory {
        override suspend fun createClientOperations(
            sessionId: SessionId,
            sessionResponse: AcpCreatedSessionResponse
        ): ClientSessionOperations {
            context.sessionIdRef.set(sessionId.value)
            replayOwnerBySessionId[sessionId.value] = context.chatId
            return createSharedSessionOperations(sessionId.value, requestedAdapterName)
        }
    }

    val params = SessionCreationParameters(cwd = cwd, mcpServers = buildMcpServers())
    val sess = client.loadSession(SessionId(sessionId), params, factory)

    context.sessionIdRef.set(sess.sessionId.value)
    replayOwnerBySessionId[sess.sessionId.value] = context.chatId
    systemInstructionsInjectedSessionIds.add(sess.sessionId.value)

    if (keepLoadedSessionActive) {
        context.session = sess
        context.activeAdapterNameRef.set(requestedAdapterName)

        if (sess.modesSupported) {
            context.activeModeIdRef.set(sess.currentMode.value.value)
        } else if (!preferredModeId.isNullOrBlank()) {
            context.activeModeIdRef.set(preferredModeId.trim())
        }
        @OptIn(com.agentclientprotocol.annotations.UnstableApi::class)
        if (sess.modelsSupported) {
            context.activeModelIdRef.set(sess.currentModel.value.value)
        } else if (!preferredModelId.isNullOrBlank()) {
            context.activeModelIdRef.set(preferredModelId.trim())
        }
    } else {
        context.session = null
    }

    // Drain the async notification queue BEFORE proceeding to the next replay step.
    try {
        awaitPendingSessionUpdates(requestedAdapterName)
    } finally {
        replayOwnerBySessionId.remove(sess.sessionId.value, context.chatId)
    }
}

@Suppress("OPT_IN_USAGE")
internal suspend fun AcpClientService.setModel(chatId: String, modelId: String): Boolean {
    val context = sessions[chatId] ?: return false
    val trimmedModelId = modelId.trim()
    val currentModelId = context.activeModelIdRef.get()
    if (currentModelId == trimmedModelId) {
        return true
    }

    val adapterName = context.activeAdapterNameRef.get() ?: return false
    val adapterInfo = AcpAdapterPaths.getAdapterInfo(adapterName)

    return when (adapterInfo.modelChangeStrategy) {
        "restart-resume" -> {
            try {
                startAgent(chatId, adapterName, trimmedModelId, context.sessionIdRef.get())
                true
            } catch (e: Exception) {
                false
            }
        }
        else -> {
            val sess = context.session ?: return false
            try {
                withContext(Dispatchers.IO) {
                    sess.setModel(ModelId(trimmedModelId))
                }
                context.activeModelIdRef.set(trimmedModelId)
                true
            } catch (e: Exception) {
                false
            }
        }
    }
}

@Suppress("OPT_IN_USAGE")
internal suspend fun AcpClientService.setMode(chatId: String, modeId: String): Boolean {
    val context = sessions[chatId] ?: return false
    val trimmedModeId = modeId.trim()
    if (context.activeModeIdRef.get() == trimmedModeId) {
        return true
    }

    val sess = context.session ?: return false
    return try {
        withContext(Dispatchers.IO) {
            sess.setMode(SessionModeId(trimmedModeId))
        }
        context.activeModeIdRef.set(trimmedModeId)
        true
    } catch (e: Exception) {
        false
    }
}

internal fun AcpClientService.respondToPermissionRequest(requestId: String, decision: String) {
    for (ctx in sessions.values) {
        val deferred = ctx.pendingRequests.remove(requestId)
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

    // Wait for any ongoing initialization/restart to finish
    val sess = context.lifecycleMutex.withLock {
        val s = context.session
        if (s == null) {
            emit(AcpEvent.Error("No active agent session. Please click the agent dropdown at the top to restart the agent."))
            return@flow
        }

        s
    }

    context.statusRef.set(AcpClientService.Status.Prompting)
    var stopReason: String? = null
    val activeAdapterName = context.activeAdapterNameRef.get()
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
        sess.prompt(promptBlocks).collect { event ->
            when (event) {
                is Event.SessionUpdateEvent -> {
                    sessionUpdateHandler?.invoke(chatId, event.update, false, null)
                }
                is Event.PromptResponseEvent -> {
                    stopReason = event.response.stopReason.toString()
                }
            }
        }
        if (!activeAdapterName.isNullOrBlank()) {
            awaitPendingSessionUpdates(activeAdapterName)
        }
        stopReason?.let { emit(AcpEvent.PromptDone(it)) }

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
    val sess = context.lifecycleMutex.withLock { context.session } ?: return
    try {
        sess.cancel()
    } catch (e: Exception) {
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
    // Also stop any contexts using this process
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
    shared: AcpClientService.SharedProcess?,
    target: AcpExecutionTarget = executionTargetRef.get()
) {
    runCatching { shared?.stop() }
    runCatching { AcpProcessUtils.stopProcessesUsingAdapterRoot(adapterName, target) }
}

internal fun AcpClientService.resetExecutionEnvironment(
    teardownTarget: AcpExecutionTarget,
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
        runCatching { teardownAdapterProcess(shared.adapterName, shared, teardownTarget) }
    }

    startupInitializationStarted.set(false)
    if (restartDownloadedAdapters) {
        initializeDownloadedAdaptersInBackground()
    }
}

internal fun AcpClientService.switchExecutionTarget(previousTarget: AcpExecutionTarget) {
    executionTargetRef.set(AcpAdapterPaths.getExecutionTarget())
    resetExecutionEnvironment(
        teardownTarget = previousTarget,
        clearSessions = true,
        restartDownloadedAdapters = true
    )
}

internal fun AcpClientService.shutdown() {
    scope.coroutineContext[kotlinx.coroutines.Job]?.cancel()
    resetExecutionEnvironment(
        teardownTarget = executionTargetRef.get(),
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
