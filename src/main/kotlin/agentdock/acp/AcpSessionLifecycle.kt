package agentdock.acp

import com.agentclientprotocol.client.ClientOperationsFactory
import com.agentclientprotocol.common.ClientSessionOperations
import com.agentclientprotocol.common.SessionCreationParameters
import com.agentclientprotocol.model.AcpCreatedSessionResponse
import com.agentclientprotocol.model.SessionConfigOption
import com.agentclientprotocol.model.SessionId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import agentdock.history.SessionMeta

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
    preferredConfigValues: Map<String, String> = emptyMap(),
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
                val applied = applySessionConfigOptions(
                    context = context,
                    adapterName = requestedAdapterName,
                    preferredValues = preferredConfigValues
                )
                if (!applied) {
                    throw IllegalStateException("Failed to apply session config options")
                }
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

                ensureSharedProcessStarted(sharedProc, adapterInfo, forceRestart)
                ensureAsyncSessionUpdates(sharedProc)

                val savedPreference = AcpAgentPreferencesStore.preferenceFor(requestedAdapterName)
                val client = sharedProc.client
                    ?: throw IllegalStateException("ACP client was not initialized for adapter '$requestedAdapterName'")
                val cwd = resolveSessionCwd(project.basePath ?: System.getProperty("user.dir"))

                var createdSessionMetadata: AcpClientService.AdapterRuntimeMetadata? = null
                val factory = object : ClientOperationsFactory {
                    override suspend fun createClientOperations(
                        sessionId: SessionId,
                        sessionResponse: AcpCreatedSessionResponse
                    ): ClientSessionOperations {
                        createdSessionMetadata = sessionResponse.runtimeMetadata(adapterInfo)
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

                val runtimeMetadata = createdSessionMetadata ?: adapterRuntimeMetadataMap[requestedAdapterName]
                if (createdSessionMetadata != null) {
                    updateSessionRuntimeMetadata(adapterInfo, createdSessionMetadata!!, context)
                } else {
                    context.runtimeMetadataRef.set(runtimeMetadata)
                }
                val availableConfigIds = runtimeMetadata
                    ?.configOptions
                    .orEmpty()
                    .mapTo(mutableSetOf()) { it.id }
                val applied = applySessionConfigOptions(
                    context = context,
                    adapterName = requestedAdapterName,
                    preferredValues = savedPreference
                        ?.configOptions
                        .orEmpty()
                        .filterKeys(availableConfigIds::contains) + preferredConfigValues
                )
                if (!applied) throw IllegalStateException("Failed to apply session config options")

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

private suspend fun AcpClientService.applySessionConfigOptions(
    context: AcpClientService.AgentContext,
    adapterName: String,
    preferredValues: Map<String, String>
): Boolean {
    if (context.session == null) return false
    val protocol = context.sharedProcess?.protocol ?: return false
    val sessionId = context.sessionIdRef.get()?.takeIf(String::isNotBlank) ?: return false
    val initialMetadata = context.runtimeMetadataRef.get() ?: return false
    if (preferredValues.isEmpty()) return true
    val optionIds = initialMetadata.configOptions
        .sortedBy { if (it.matchesCategory("model")) 0 else 1 }
        .map { it.id }
    if (!optionIds.containsAll(preferredValues.keys)) return false

    for (configId in optionIds.filter(preferredValues::containsKey)) {
        val requestedValue = preferredValues.getValue(configId).trim()
        val metadata = context.runtimeMetadataRef.get() ?: return false
        // Applying one option can narrow the rest: agents drop options that the newly selected model
        // does not support (fast mode outside Opus, effort levels on Haiku). Those are skipped, not failed.
        val option = metadata.configOptions.firstOrNull { it.id == configId } ?: continue
        val effectiveOption = if (option.isReasoning()) {
            val modelId = context.activeModelIdRef.get() ?: metadata.currentModelId
            option.copy(options = metadata.reasoningEffortsByModel[modelId] ?: option.options)
        } else {
            option
        }
        if (effectiveOption.type == "select" && effectiveOption.options.isEmpty()) continue
        if (!effectiveOption.accepts(requestedValue)) return false
        if (context.activeConfigValues[configId] == requestedValue) continue
        val response = runCatching {
            protocol.setSessionConfigOptionRaw(sessionId, configId, requestedValue, option.type)
        }.getOrElse { return false }
        updateMetadataFromConfigOptionResponse(adapterName, response, context)
    }
    AcpAgentPreferencesStore.rememberConfigOptions(adapterName, preferredValues)
    return true
}

private fun AcpCreatedSessionResponse.runtimeMetadata(
    adapterInfo: AcpAdapterConfig.AdapterInfo
): AcpClientService.AdapterRuntimeMetadata? = runCatching {
    runtimeMetadataFromConfigOptionsJson(
        Json.encodeToJsonElement(ListSerializer(SessionConfigOption.serializer()), configOptions.orEmpty()),
        adapterInfo
    )
}.getOrNull()

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

    ensureSharedProcessStarted(sharedProc, adapterInfo)
    ensureAsyncSessionUpdates(sharedProc)
    context.sessionIdRef.set(sessionId)

    val client = sharedProc.client
        ?: throw IllegalStateException("ACP client was not initialized for adapter '$requestedAdapterName'")
    val cwd = resolveSessionCwd(project.basePath ?: System.getProperty("user.dir"))

    var loadedSessionMetadata: AcpClientService.AdapterRuntimeMetadata? = null
    val factory = object : ClientOperationsFactory {
        override suspend fun createClientOperations(
            sessionId: SessionId,
            sessionResponse: AcpCreatedSessionResponse
        ): ClientSessionOperations {
            loadedSessionMetadata = sessionResponse.runtimeMetadata(adapterInfo)
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

        val runtimeMetadata = loadedSessionMetadata ?: adapterRuntimeMetadataMap[requestedAdapterName]
        if (loadedSessionMetadata != null) {
            updateSessionRuntimeMetadata(adapterInfo, loadedSessionMetadata!!, context)
        } else {
            context.runtimeMetadataRef.set(runtimeMetadata)
        }
        if (loadedSessionMetadata == null) {
            preferredModelId?.trim()?.takeIf(String::isNotEmpty)?.let(context.activeModelIdRef::set)
            preferredModeId?.trim()?.takeIf(String::isNotEmpty)?.let(context.activeModeIdRef::set)
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
