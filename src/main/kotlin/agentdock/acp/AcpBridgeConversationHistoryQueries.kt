package agentdock.acp

import agentdock.history.AgentDockHistoryService
import com.intellij.ui.jcef.JBCefJSQuery
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

private data class SessionMetadataUpdatePayload(
    val conversationId: String,
    val sessionId: String,
    val adapterName: String,
    val promptCount: Int,
    val title: String?,
    val touchUpdatedAt: Boolean
)

private data class ContinueConversationPayload(
    val previousSessionId: String,
    val previousAdapterName: String,
    val sessionId: String,
    val adapterName: String,
    val title: String?
)

private fun parseSessionMetadataUpdatePayload(payload: String?): SessionMetadataUpdatePayload? {
    return runCatching {
        val obj = Json.parseToJsonElement(payload ?: "{}").jsonObject
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
            touchUpdatedAt = obj["touchUpdatedAt"]?.jsonPrimitive?.booleanOrNull ?: false
        )
    }.getOrNull()
}

private fun parseContinueConversationPayload(payload: String?): ContinueConversationPayload? {
    return runCatching {
        val obj = Json.parseToJsonElement(payload ?: "{}").jsonObject
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

internal fun AcpBridge.installConversationHistoryQueries() {
    loadConversationQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            val (chatId, projectPath, conversationId) = parseConversationLoadPayload(payload)
            if (chatId != null && projectPath != null && conversationId != null) {
                scope.launch(Dispatchers.Default) {
                    replaySeqByChatId[chatId] = 0
                    try {
                        val storedConversation = AgentDockHistoryService.loadConversationReplay(projectPath, conversationId)
                        if (storedConversation != null) {
                            pushConversationReplayLoaded(chatId, storedConversation)

                            val lastStoredSession = storedConversation.sessions.lastOrNull()
                                ?: throw IllegalStateException("Conversation replay '$conversationId' is empty")
                            pushSessionId(chatId, lastStoredSession.sessionId)

                            scope.launch(Dispatchers.Default) {
                                try {
                                    suppressReplayForChatIds.add(chatId)
                                    try {
                                        withTimeout(AcpBridge.START_AGENT_TIMEOUT_MS) {
                                            service.loadSession(
                                                chatId = chatId,
                                                adapterName = lastStoredSession.adapterName,
                                                sessionId = lastStoredSession.sessionId,
                                                deliverReplay = false
                                            )
                                        }
                                    } finally {
                                        suppressReplayForChatIds.remove(chatId)
                                    }
                                    pushAdapters()
                                    pushStatus(chatId, service.status(chatId).name.lowercase())
                                    pushSessionId(chatId, service.sessionId(chatId))
                                    pushMode(chatId, service.activeModeId(chatId))
                                } catch (e: Exception) {
                                    pushStatus(chatId, "error")
                                    pushConversationError(chatId, e)
                                }
                            }
                        } else {
                            val sessionsChain = AgentDockHistoryService.getConversationSessions(projectPath, conversationId)
                            if (sessionsChain.isEmpty()) {
                                throw IllegalStateException("Conversation '$conversationId' not found")
                            }
                            pushStatus(chatId, "initializing")
                            startHistoryReplayCapture(chatId, projectPath, conversationId)
                            sessionsChain.forEach { session ->
                                beginImportedReplaySession(chatId, session.sessionId, session.adapterName, session.modelId, session.modeId)
                                withTimeout(AcpBridge.START_AGENT_TIMEOUT_MS) {
                                    service.loadSession(
                                        chatId,
                                        session.adapterName,
                                        session.sessionId,
                                        session.modelId,
                                        session.modeId
                                    )
                                }
                            }
                            flushHistoryReplayCapture(chatId)
                            pushAdapters()
                            val refreshedConversation = AgentDockHistoryService.loadConversationReplay(projectPath, conversationId)
                            if (refreshedConversation != null) {
                                pushConversationReplayLoaded(chatId, refreshedConversation)
                            }

                            val lastSession = sessionsChain.last()
                            pushStatus(chatId, service.status(chatId).name.lowercase())
                            pushSessionId(chatId, service.sessionId(chatId))
                            pushMode(chatId, service.activeModeId(chatId))
                        }
                    } catch (e: Exception) {
                        discardHistoryReplayCapture(chatId)
                        replaySeqByChatId.remove(chatId)
                        pushStatus(chatId, "error")
                        pushConversationError(chatId, e)
                    }
                }
            }
            JBCefJSQuery.Response("ok")
        }
    }

    updateSessionMetadataQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            scope.launch(Dispatchers.IO) {
                parseSessionMetadataUpdatePayload(payload)?.let { request ->
                    AgentDockHistoryService.upsertRuntimeSessionMetadata(
                        projectPath = service.project.basePath,
                        conversationId = request.conversationId,
                        sessionId = request.sessionId,
                        adapterName = request.adapterName,
                        promptCount = request.promptCount,
                        titleCandidate = request.title,
                        touchUpdatedAt = request.touchUpdatedAt
                    )
                }
            }
            JBCefJSQuery.Response("ok")
        }
    }

    continueConversationQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
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
            JBCefJSQuery.Response("ok")
        }
    }

    saveConversationTranscriptQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            scope.launch(Dispatchers.IO) {
                val result = runCatching {
                    val request = Json.decodeFromString<SaveConversationTranscriptPayload>(payload ?: "{}")
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
                    val request = runCatching { Json.decodeFromString<SaveConversationTranscriptPayload>(payload ?: "{}") }.getOrNull()
                    SaveConversationTranscriptResultPayload(
                        requestId = request?.requestId.orEmpty(),
                        conversationId = request?.conversationId.orEmpty(),
                        success = false,
                        error = formatAcpError(error)
                    )
                }
                pushConversationTranscriptSaved(result)
            }
            JBCefJSQuery.Response("ok")
        }
    }
}
