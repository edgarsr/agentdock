package agentdock.acp

import agentdock.history.AgentDockHistoryService
import agentdock.history.ConversationPromptReplayEntry
import agentdock.history.ConversationReplayData
import agentdock.history.HistoryReplayStore
import agentdock.utils.jsCallback
import agentdock.utils.jsStringLiteral
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

private data class SessionMetadataUpdatePayload(
    val conversationId: String,
    val sessionId: String,
    val adapterName: String,
    val promptCount: Int,
    val title: String?,
    val inheritedAdapterNames: List<String>,
    val touchUpdatedAt: Boolean,
    val forceTitle: Boolean
)

private data class ContinueConversationPayload(
    val previousSessionId: String,
    val previousAdapterName: String,
    val sessionId: String,
    val adapterName: String,
    val title: String?
)

private fun parseSessionMetadataUpdatePayload(payload: String): SessionMetadataUpdatePayload? {
    return runCatching {
        val obj = Json.parseToJsonElement(payload).jsonObject
        val conversationId = obj["conversationId"]?.jsonPrimitive?.content?.trim().orEmpty()
        val sessionId = obj["sessionId"]?.jsonPrimitive?.content?.trim().orEmpty()
        val adapterName = obj["adapterName"]?.jsonPrimitive?.content?.trim().orEmpty()
        if (conversationId.isBlank() || sessionId.isBlank() || adapterName.isBlank()) return@runCatching null
        SessionMetadataUpdatePayload(
            conversationId = conversationId,
            sessionId = sessionId,
            adapterName = adapterName,
            promptCount = obj["promptCount"]?.jsonPrimitive?.intOrNull ?: 0,
            title = obj["title"]?.jsonPrimitive?.contentOrNull,
            inheritedAdapterNames = obj["inheritedAdapterNames"]?.jsonArray
                ?.mapNotNull { it.jsonPrimitive.contentOrNull?.trim()?.takeIf(String::isNotBlank) }
                ?: emptyList(),
            touchUpdatedAt = obj["touchUpdatedAt"]?.jsonPrimitive?.booleanOrNull ?: false,
            forceTitle = obj["forceTitle"]?.jsonPrimitive?.booleanOrNull ?: false
        )
    }.getOrNull()
}

private fun parseContinueConversationPayload(payload: String): ContinueConversationPayload? {
    return runCatching {
        val obj = Json.parseToJsonElement(payload).jsonObject
        val previousSessionId = obj["previousSessionId"]?.jsonPrimitive?.content?.trim().orEmpty()
        val previousAdapterName = obj["previousAdapterName"]?.jsonPrimitive?.content?.trim().orEmpty()
        val sessionId = obj["sessionId"]?.jsonPrimitive?.content?.trim().orEmpty()
        val adapterName = obj["adapterName"]?.jsonPrimitive?.content?.trim().orEmpty()
        if (previousSessionId.isBlank() || previousAdapterName.isBlank() || sessionId.isBlank() || adapterName.isBlank()) {
            return@runCatching null
        }
        ContinueConversationPayload(
            previousSessionId = previousSessionId,
            previousAdapterName = previousAdapterName,
            sessionId = sessionId,
            adapterName = adapterName,
            title = obj["title"]?.jsonPrimitive?.contentOrNull
        )
    }.getOrNull()
}

private suspend fun AcpBridge.importConversationFromAgent(
    chatId: String,
    projectPath: String,
    conversationId: String,
    sessionId: String,
    adapterName: String,
    modeId: String? = null
) {
    pushStatus(chatId, "initializing")
    startHistoryReplayCapture(chatId, projectPath, conversationId)
    beginImportedReplaySession(chatId, sessionId, adapterName)
    withTimeout(AcpBridge.START_AGENT_TIMEOUT) {
        service.loadSession(chatId, adapterName, sessionId, modeId)
    }
    val capturedConversation = flushHistoryReplayCapture(chatId)
    pushAdapters()
    pushConversationReplayLoaded(chatId, capturedConversation ?: ConversationReplayData())
    pushStatus(chatId, service.status(chatId).name.lowercase())
    pushSessionId(chatId, service.sessionId(chatId))
}

/**
 * Sends a UI taking the chat over the chat as the backend knows it: the stored prompts, the one the
 * agent is still answering, the status and the permission requests still waiting. The stored
 * conversation is read and encoded outside [AcpBridge.withChatDelivery], and again if a prompt was
 * stored meanwhile.
 */
private fun AcpBridge.attachChat(chatId: String, projectPath: String) {
    while (true) {
        val revision = historyRevisions[chatId]
        val stored = runCatching { AgentDockHistoryService.loadConversationReplay(projectPath, chatId) }.getOrNull()
        val storedJs = "JSON.parse(${adapterJson.encodeToString(stored).jsStringLiteral()})"
        val sent = withChatDelivery(chatId) {
            if (historyRevisions[chatId] != revision) return@withChatDelivery false
            val payload = ChatAttachedPayload(
                chatId = chatId,
                livePrompt = livePromptCaptures[chatId]?.let(::livePromptPayload),
                // Bridges rebuilt for a reconnected UI have not sent a status yet.
                status = lastStatusByChatId[chatId]
                    ?: service.status(chatId).takeUnless { it == AcpClientService.Status.NotStarted }?.name?.lowercase(),
                sessionId = service.sessionId(chatId),
                permissions = service.pendingPermissionRequests(chatId).map(::permissionRequestJson),
                elicitations = service.pendingElicitationRequests(chatId)
            )
            val payloadJs = "JSON.parse(${adapterJson.encodeToString(payload).jsStringLiteral()})"
            host.eval(jsCallback("__onChatAttached", "Object.assign($payloadJs, { data: $storedJs })"))
            pushMode(chatId, service.activeModeId(chatId))
            service.sessionRuntimeMetadata(chatId)?.let { pushSessionConfigOptions(chatId, it, applyCurrentValues = false) }
            true
        }
        if (sent) return
    }
}

private fun livePromptPayload(capture: LivePromptCapture): LivePromptPayload? = synchronized(capture) {
    if (capture.closed) return null
    LivePromptPayload(
        sessionId = capture.sessionId,
        adapterName = capture.adapterName,
        prompt = ConversationPromptReplayEntry(
            blocks = HistoryReplayStore.normalizeReplayBlocks(capture.blocks),
            events = HistoryReplayStore.normalizeReplayBlocks(capture.events.toList()),
            assistantMeta = capture.assistantMeta?.copy(
                promptStartedAtMillis = capture.startedAtMillis,
                contextTokensUsed = capture.contextTokensUsed,
                contextWindowSize = capture.contextWindowSize
            )
        )
    )
}

internal fun AcpBridge.installConversationHistoryQueries() {
    host.register("attachChat") { payload ->
        val request = runCatching { adapterJson.decodeFromString<AttachChatRequest>(payload) }.getOrNull()
            ?.takeIf { it.chatId.isNotBlank() }
            ?: return@register
        scope.launch(Dispatchers.IO) {
            attachChat(request.chatId, request.projectPath.ifBlank { service.project.basePath.orEmpty() })
        }
    }

    host.register("loadConversation") { payload ->
        val (chatId, projectPath, conversationId) = parseConversationLoadPayload(payload)
        if (chatId != null && projectPath != null && conversationId != null) {
            scope.launch(Dispatchers.Default) {
                // Capture/probe state is keyed by chatId, so two loads for the same
                // chat must cover their entire replay lifecycle one at a time.
                // Count queued loads too, so cleanup cannot let a new load bypass them.
                val loadEntry = historyLoadMutexes.compute(chatId) { _, existing ->
                    (existing ?: HistoryLoadMutexEntry()).also { it.references++ }
                }!!
                try {
                    loadEntry.mutex.withLock {
                        try {
                            val storedConversation = AgentDockHistoryService.loadConversationReplay(projectPath, conversationId)
                            if (storedConversation != null) {
                                pushConversationReplayLoaded(chatId, storedConversation)

                                val lastStoredSession = storedConversation.sessions.lastOrNull()
                                    ?: throw IllegalStateException("Conversation replay '$conversationId' is empty")
                                pushSessionId(chatId, lastStoredSession.sessionId)

                                val probe = ReplayFreshnessProbe()
                                replayFreshnessProbes[chatId] = probe
                                suppressReplayForChatIds.add(chatId)
                                try {
                                    withTimeout(AcpBridge.START_AGENT_TIMEOUT) {
                                        service.loadSession(
                                            chatId = chatId,
                                            adapterName = lastStoredSession.adapterName,
                                            sessionId = lastStoredSession.sessionId
                                        )
                                    }
                                } finally {
                                    suppressReplayForChatIds.remove(chatId)
                                    replayFreshnessProbes.remove(chatId)
                                }
                                probe.closeMessage()
                                if (!livePromptCaptures.containsKey(chatId) &&
                                    conversationWasContinuedElsewhere(probe, storedConversation)
                                ) {
                                    importConversationFromAgent(
                                        chatId, projectPath, conversationId,
                                        lastStoredSession.sessionId, lastStoredSession.adapterName
                                    )
                                } else {
                                    pushAdapters()
                                    pushStatus(chatId, service.status(chatId).name.lowercase())
                                    pushSessionId(chatId, service.sessionId(chatId))
                                }
                            } else {
                                val sessionsChain = AgentDockHistoryService.getConversationSessions(projectPath, conversationId)
                                if (sessionsChain.isEmpty()) {
                                    throw IllegalStateException("Conversation '$conversationId' not found")
                                }
                                val lastSession = sessionsChain.last()
                                importConversationFromAgent(
                                    chatId, projectPath, conversationId,
                                    lastSession.sessionId, lastSession.adapterName,
                                    lastSession.modeId
                                )
                            }
                        } catch (e: Exception) {
                            discardHistoryReplayCapture(chatId)
                            pushStatus(chatId, "error")
                            pushConversationError(chatId, e)
                        }
                    }
                } finally {
                    historyLoadMutexes.computeIfPresent(chatId) { _, current ->
                        if (current !== loadEntry) {
                            current
                        } else if (--current.references == 0) {
                            null
                        } else {
                            current
                        }
                    }
                }
            }
        }
    }

    host.register("updateSessionMetadata") { payload ->
        scope.launch(Dispatchers.IO) {
            parseSessionMetadataUpdatePayload(payload)?.let { request ->
                AgentDockHistoryService.upsertRuntimeSessionMetadata(
                    projectPath = service.project.basePath,
                    conversationId = request.conversationId,
                    sessionId = request.sessionId,
                    adapterName = request.adapterName,
                    promptCount = request.promptCount,
                    titleCandidate = request.title,
                    inheritedAdapterNames = request.inheritedAdapterNames,
                    touchUpdatedAt = request.touchUpdatedAt,
                    forceTitle = request.forceTitle
                )
            }
        }
    }

    host.register("continueConversation") { payload ->
        scope.launch(Dispatchers.IO) {
            parseContinueConversationPayload(payload)?.let { request ->
                AgentDockHistoryService.appendSessionToConversation(
                    projectPath = service.project.basePath,
                    previousSessionId = request.previousSessionId,
                    previousAdapterName = request.previousAdapterName,
                    sessionId = request.sessionId,
                    adapterName = request.adapterName,
                    titleCandidate = request.title
                )
            }
        }
    }

    host.register("saveConversationTranscript") { payload ->
        scope.launch(Dispatchers.IO) {
            val result = runCatching {
                val request = Json.decodeFromString<SaveConversationTranscriptPayload>(payload)
                val filePath = AgentDockHistoryService.saveConversationTranscript(
                    projectPath = service.project.basePath,
                    conversationId = request.conversationId,
                    transcriptText = request.text
                )
                if (filePath.isNullOrBlank()) {
                    SaveConversationTranscriptResultPayload(
                        requestId = request.requestId,
                        conversationId = request.conversationId,
                        success = false,
                        error = "Failed to persist transcript file."
                    )
                } else {
                    SaveConversationTranscriptResultPayload(
                        requestId = request.requestId,
                        conversationId = request.conversationId,
                        success = true,
                        filePath = filePath
                    )
                }
            }.getOrElse { error ->
                val request = runCatching { Json.decodeFromString<SaveConversationTranscriptPayload>(payload) }.getOrNull()
                SaveConversationTranscriptResultPayload(
                    requestId = request?.requestId.orEmpty(),
                    conversationId = request?.conversationId.orEmpty(),
                    success = false,
                    error = formatAcpError(error)
                )
            }
            pushConversationTranscriptSaved(result)
        }
    }
}
