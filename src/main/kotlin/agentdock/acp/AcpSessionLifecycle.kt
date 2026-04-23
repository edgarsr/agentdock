package agentdock.acp

import com.agentclientprotocol.client.ClientOperationsFactory
import com.agentclientprotocol.common.ClientSessionOperations
import com.agentclientprotocol.common.SessionCreationParameters
import com.agentclientprotocol.model.AcpCreatedSessionResponse
import com.agentclientprotocol.model.ModelId
import com.agentclientprotocol.model.SessionId
import com.agentclientprotocol.model.SessionModeId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import agentdock.history.SessionMeta

// Max time to wait for the agent process to start and respond to ACP initialize.
// The retry loop in initializeSharedProcessAtStartup can take up to this long for slow agents (e.g. Gemini).
private const val PROCESS_STARTUP_TIMEOUT_MS = 300_000L

internal fun AcpClientService.processKey(adapterName: String): String {
    return adapterName
}

internal fun AcpClientService.ensureExecutionTargetCurrent() {
}

internal fun AcpClientService.resolveSessionCwd(path: String): String {
    return path
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

            if (
                currentStatus == AcpClientService.Status.Ready &&
                context.activeAdapterNameRef.get() == requestedAdapterName &&
                resumeSessionId == null &&
                !forceRestart
            ) {
                return@withLock
            }

            if (currentStatus != AcpClientService.Status.NotStarted) {
                context.stop()
            }

            if (!AcpAdapterPaths.isDownloaded(requestedAdapterName)) {
                context.statusRef.set(AcpClientService.Status.Error)
                throw IllegalStateException("Agent '$requestedAdapterName' is not downloaded")
            }

            context.statusRef.set(AcpClientService.Status.Initializing)

            try {
                val sharedProc = activeProcesses.computeIfAbsent(processKey(requestedAdapterName)) {
                    createSharedProcess(requestedAdapterName)
                }
                context.sharedProcess = sharedProc

                withTimeout(PROCESS_STARTUP_TIMEOUT_MS) {
                    ensureSharedProcessStarted(sharedProc, adapterInfo, forceRestart)
                }
                ensureAsyncSessionUpdates(sharedProc)

                val runtimeMetadata = adapterRuntimeMetadataMap[requestedAdapterName]
                val savedPreference = AcpAgentPreferencesStore.preferenceFor(requestedAdapterName)
                val client = sharedProc.client
                    ?: throw IllegalStateException("ACP client was not initialized for adapter '$requestedAdapterName'")
                val cwd = resolveSessionCwd(project.basePath ?: System.getProperty("user.dir"))

                val factory = object : ClientOperationsFactory {
                    override suspend fun createClientOperations(
                        sessionId: SessionId,
                        sessionResponse: AcpCreatedSessionResponse
                    ): ClientSessionOperations {
                        context.sessionIdRef.compareAndSet(null, sessionId.value)
                        bindLiveSessionOwner(chatId, sessionId.value)
                        return createSharedSessionOperations(sessionId.value, requestedAdapterName)
                    }
                }

                val params = SessionCreationParameters(cwd = cwd, mcpServers = buildMcpServers())
                val session = createOrResumeSession(client, params, factory, resumeSessionId)

                context.session = session
                context.sessionIdRef.set(session.sessionId.value)
                bindLiveSessionOwner(chatId, session.sessionId.value)
                if (resumeSessionId != null && session.sessionId.value == resumeSessionId) {
                    systemInstructionsInjectedSessionIds.add(session.sessionId.value)
                }

                applyRequestedSessionPreferences(
                    session = session,
                    adapterName = requestedAdapterName,
                    preferredModelId = preferredModelId ?: savedPreference?.modelId,
                    preferredModeId = savedPreference?.modeId,
                    runtimeMetadata = runtimeMetadata,
                    context = context
                )

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
    preferredModeId: String? = null,
    deliverReplay: Boolean = true
) {
    ensureExecutionTargetCurrent()
    val context = sessions.computeIfAbsent(chatId) { createAgentContext(chatId) }

    withContext(Dispatchers.IO) {
        context.lifecycleMutex.withLock {
            val requestedAdapterName = AcpAdapterPaths.getAdapterInfo(adapterName).id
            if (context.statusRef.get() != AcpClientService.Status.NotStarted) {
                context.stop()
            }

            context.statusRef.set(AcpClientService.Status.Initializing)
            context.allowReplayDelivery = deliverReplay
            context.lastHistoryLoadTime = if (deliverReplay) System.currentTimeMillis() else 0L
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
                    keepLoadedSessionActive = true,
                    deliverReplay = deliverReplay
                )
                context.ignoreUpdatesUntilPrompt = true
                context.allowReplayDelivery = true
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
            if (context.statusRef.get() != AcpClientService.Status.NotStarted) {
                context.stop()
            }

            context.statusRef.set(AcpClientService.Status.Initializing)
            context.lastHistoryLoadTime = System.currentTimeMillis()
            context.activeAdapterNameRef.set(null)
            context.activeModelIdRef.set(null)
            context.activeModeIdRef.set(null)

            try {
                sessionsChain.forEachIndexed { index, session ->
                    loadSessionIntoContext(
                        context = context,
                        adapterName = session.adapterName,
                        sessionId = session.sessionId,
                        preferredModelId = session.modelId,
                        preferredModeId = session.modeId,
                        keepLoadedSessionActive = index == sessionsChain.lastIndex
                    )
                }

                context.ignoreUpdatesUntilPrompt = true
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
    keepLoadedSessionActive: Boolean,
    deliverReplay: Boolean = true
) {
    ensureExecutionTargetCurrent()
    val adapterInfo = AcpAdapterPaths.getAdapterInfo(adapterName)
    val requestedAdapterName = adapterInfo.id
    if (deliverReplay) {
        replayOwnerBySessionId[sessionId] = context.chatId
    }

    val sharedProc = activeProcesses.computeIfAbsent(processKey(requestedAdapterName)) {
        createSharedProcess(requestedAdapterName)
    }
    context.sharedProcess = sharedProc

    withTimeout(PROCESS_STARTUP_TIMEOUT_MS) {
        ensureSharedProcessStarted(sharedProc, adapterInfo)
    }
    ensureAsyncSessionUpdates(sharedProc)
    context.sessionIdRef.set(sessionId)

    val client = sharedProc.client
        ?: throw IllegalStateException("ACP client was not initialized for adapter '$requestedAdapterName'")
    val cwd = resolveSessionCwd(project.basePath ?: System.getProperty("user.dir"))

    val factory = object : ClientOperationsFactory {
        override suspend fun createClientOperations(
            sessionId: SessionId,
            sessionResponse: AcpCreatedSessionResponse
        ): ClientSessionOperations {
            context.sessionIdRef.set(sessionId.value)
            if (keepLoadedSessionActive) {
                bindLiveSessionOwner(context.chatId, sessionId.value)
            }
            if (deliverReplay) {
                replayOwnerBySessionId[sessionId.value] = context.chatId
            }
            return createSharedSessionOperations(sessionId.value, requestedAdapterName)
        }
    }

    val params = SessionCreationParameters(cwd = cwd, mcpServers = buildMcpServers())
    val session = client.loadSession(SessionId(sessionId), params, factory)

    context.sessionIdRef.set(session.sessionId.value)
    if (keepLoadedSessionActive) {
        bindLiveSessionOwner(context.chatId, session.sessionId.value)
    }
    if (deliverReplay) {
        replayOwnerBySessionId[session.sessionId.value] = context.chatId
    }
    systemInstructionsInjectedSessionIds.add(session.sessionId.value)

    if (keepLoadedSessionActive) {
        context.session = session
        context.activeAdapterNameRef.set(requestedAdapterName)

        if (session.modesSupported) {
            context.activeModeIdRef.set(session.currentMode.value.value)
        } else if (!preferredModeId.isNullOrBlank()) {
            context.activeModeIdRef.set(preferredModeId.trim())
        }
        @OptIn(com.agentclientprotocol.annotations.UnstableApi::class)
        if (session.modelsSupported) {
            context.activeModelIdRef.set(session.currentModel.value.value)
        } else if (!preferredModelId.isNullOrBlank()) {
            context.activeModelIdRef.set(preferredModelId.trim())
        }
    } else {
        context.session = null
    }

    try {
        awaitPendingSessionUpdates(requestedAdapterName)
    } finally {
        if (deliverReplay) {
            replayOwnerBySessionId.remove(session.sessionId.value, context.chatId)
        }
    }
}

@Suppress("OPT_IN_USAGE")
private suspend fun AcpClientService.createOrResumeSession(
    client: com.agentclientprotocol.client.Client,
    params: SessionCreationParameters,
    factory: ClientOperationsFactory,
    resumeSessionId: String?
): com.agentclientprotocol.client.ClientSession {
    return if (resumeSessionId != null) {
        client.resumeSession(SessionId(resumeSessionId), params, factory)
    } else {
        client.newSession(params, factory)
    }
}

@Suppress("OPT_IN_USAGE")
private suspend fun AcpClientService.applyRequestedSessionPreferences(
    session: com.agentclientprotocol.client.ClientSession,
    adapterName: String,
    preferredModelId: String?,
    preferredModeId: String?,
    runtimeMetadata: AcpClientService.AdapterRuntimeMetadata?,
    context: AcpClientService.AgentContext
) {
    val selectedModelId = resolveModelToApply(
        preferredModelId,
        runtimeMetadata?.availableModels ?: emptyList(),
        runtimeMetadata?.currentModelId ?: preferredModelId
    )
    if (selectedModelId != null) {
        runCatching {
            session.setModel(ModelId(selectedModelId))
            context.activeModelIdRef.set(selectedModelId)
            AcpAgentPreferencesStore.rememberModel(adapterName, selectedModelId)
        }.onFailure {
            context.activeModelIdRef.set(runtimeMetadata?.currentModelId)
        }
    }

    val currentModeId = preferredModeId
        ?.takeIf { preferred -> runtimeMetadata?.availableModes?.any { it.id == preferred } != false }
        ?: runtimeMetadata?.currentModeId
    if (currentModeId != null) {
        runCatching {
            session.setMode(SessionModeId(currentModeId))
            context.activeModeIdRef.set(currentModeId)
            AcpAgentPreferencesStore.rememberMode(adapterName, currentModeId)
        }.onFailure {
            context.activeModeIdRef.set(runtimeMetadata?.currentModeId)
        }
    }
}
