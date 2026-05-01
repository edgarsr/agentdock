package agentdock.history

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject

object AgentDockHistoryService {
    fun registerEphemeralSession(projectPath: String?, adapterName: String, sessionId: String) {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        val cleanAdapterName = adapterName.trim()
        val cleanSessionId = sessionId.trim()
        if (cleanProjectPath.isBlank() || cleanAdapterName.isBlank() || cleanSessionId.isBlank()) return

        val existing = HistoryStorage.readEphemeralSessions(cleanProjectPath)
        if (existing.any { it.adapterName == cleanAdapterName && it.sessionId == cleanSessionId }) return
        HistoryStorage.writeEphemeralSessions(
            cleanProjectPath,
            existing + EphemeralSessionEntry(
                sessionId = cleanSessionId,
                adapterName = cleanAdapterName
            )
        )
    }

    fun startBackgroundHistorySync(projectPath: String?) {
        HistorySyncService.startBackgroundHistorySync(projectPath)
    }

    fun upsertRuntimeSessionMetadata(
        projectPath: String?,
        conversationId: String,
        sessionId: String,
        adapterName: String,
        promptCount: Int,
        titleCandidate: String?,
        touchUpdatedAt: Boolean = false,
        forceTitle: Boolean = false
    ): Boolean {
        return HistoryConversationIndexService.upsertRuntimeSessionMetadata(
            projectPath,
            conversationId,
            sessionId,
            adapterName,
            promptCount,
            titleCandidate,
            touchUpdatedAt,
            forceTitle
        )
    }

    fun hasConversationReplay(projectPath: String?, conversationId: String?): Boolean {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        val cleanConversationId = runCatching {
            HistoryStorage.requireSafeConversationId(conversationId.orEmpty())
        }.getOrElse { return false }
        if (cleanProjectPath.isBlank() || cleanConversationId.isBlank()) return false
        if (!hasConversationInCurrentEnvironment(cleanProjectPath, cleanConversationId)) return false
        return HistoryReplayStore.resolveFreshConversationReplayFile(cleanProjectPath, cleanConversationId) != null
    }

    fun loadConversationReplay(projectPath: String?, conversationId: String?): ConversationReplayData? {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        val cleanConversationId = runCatching {
            HistoryStorage.requireSafeConversationId(conversationId.orEmpty())
        }.getOrElse { return null }
        if (cleanProjectPath.isBlank() || cleanConversationId.isBlank()) return null
        if (!hasConversationInCurrentEnvironment(cleanProjectPath, cleanConversationId)) return null
        val replayFile = HistoryReplayStore.resolveFreshConversationReplayFile(cleanProjectPath, cleanConversationId)
            ?: return null
        val data = HistoryReplayStore.readConversationData(replayFile) ?: return null
        val lastPrompt = data.sessions.lastOrNull()?.prompts?.lastOrNull()
        if (lastPrompt != null && lastPrompt.assistantMeta == null) {
            runCatching { replayFile.delete() }
            return null
        }
        return data
    }

    fun saveConversationReplay(projectPath: String?, conversationId: String, data: ConversationReplayData): Boolean {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        val cleanConversationId = runCatching {
            HistoryStorage.requireSafeConversationId(conversationId)
        }.getOrElse { return false }
        if (cleanProjectPath.isBlank() || cleanConversationId.isBlank()) return false

        val file = HistoryStorage.conversationDataFile(cleanProjectPath, cleanConversationId)
        HistoryReplayStore.writeConversationData(file, HistoryReplayStore.normalizeReplayData(data))
        return true
    }

    fun saveConversationTranscript(projectPath: String?, conversationId: String, transcriptText: String): String? {
        return HistoryConversationIndexService.saveConversationTranscript(
            projectPath,
            conversationId,
            transcriptText
        )
    }

    fun appendConversationPrompt(
        projectPath: String?,
        conversationId: String,
        sessionId: String,
        adapterName: String,
        blocks: List<JsonObject>,
        events: List<JsonObject>,
        assistantMeta: ConversationAssistantMetadata? = null
    ): Boolean {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        val cleanConversationId = runCatching {
            HistoryStorage.requireSafeConversationId(conversationId)
        }.getOrElse { return false }
        val cleanSessionId = sessionId.trim()
        val cleanAdapterName = adapterName.trim()
        if (cleanProjectPath.isBlank()) return false
        if (cleanConversationId.isBlank() || cleanSessionId.isBlank() || cleanAdapterName.isBlank()) return false

        val file = HistoryStorage.conversationDataFile(cleanProjectPath, cleanConversationId)
        val current = HistoryReplayStore.readConversationData(file) ?: ConversationReplayData()
        val prompt = ConversationPromptReplayEntry(
            blocks = HistoryReplayStore.normalizeReplayBlocks(blocks),
            events = HistoryReplayStore.normalizeReplayBlocks(events),
            assistantMeta = assistantMeta
        )

        val updatedSessions = current.sessions.toMutableList()
        val sessionIndex = updatedSessions.indexOfFirst {
            it.sessionId == cleanSessionId && it.adapterName == cleanAdapterName
        }

        if (sessionIndex >= 0) {
            val existingSession = updatedSessions[sessionIndex]
            updatedSessions[sessionIndex] = existingSession.copy(
                prompts = existingSession.prompts + prompt
            )
        } else {
            updatedSessions.add(
                ConversationSessionReplayEntry(
                    sessionId = cleanSessionId,
                    adapterName = cleanAdapterName,
                    prompts = listOf(prompt)
                )
            )
        }

        val updatedData = current.copy(sessions = updatedSessions)
        HistoryReplayStore.writeConversationData(file, updatedData)

        if (
            !HistoryConversationIndexService.hasIndexedConversationSession(
                cleanProjectPath,
                cleanConversationId,
                cleanSessionId,
                cleanAdapterName
            )
        ) {
            upsertRuntimeSessionMetadata(
                projectPath = cleanProjectPath,
                conversationId = cleanConversationId,
                sessionId = cleanSessionId,
                adapterName = cleanAdapterName,
                promptCount = HistoryReplayStore.replayPromptCount(updatedData),
                titleCandidate = HistoryReplayStore.titleCandidateFromReplayData(updatedData),
                touchUpdatedAt = true
            )
        }
        return true
    }

    fun deleteConversationReplay(projectPath: String?, conversationId: String?): Boolean {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        val cleanConversationId = runCatching {
            HistoryStorage.requireSafeConversationId(conversationId.orEmpty())
        }.getOrElse { return false }
        if (cleanProjectPath.isBlank() || cleanConversationId.isBlank()) return false
        return HistoryReplayStore.deleteConversationReplay(cleanProjectPath, cleanConversationId)
    }

    fun appendSessionToConversation(
        projectPath: String?,
        previousSessionId: String,
        previousAdapterName: String,
        sessionId: String,
        adapterName: String,
        titleCandidate: String? = null
    ): Boolean {
        return HistoryConversationIndexService.appendSessionToConversation(
            projectPath,
            previousSessionId,
            previousAdapterName,
            sessionId,
            adapterName,
            titleCandidate
        )
    }

    fun loadSessionChanges(projectPath: String, sessionId: String, adapterName: String): SessionChangesData? {
        return HistorySessionChangesStore.loadSessionChanges(projectPath, sessionId, adapterName)
    }

    fun saveSessionChanges(
        projectPath: String,
        sessionId: String,
        adapterName: String,
        baseToolCallIndex: Int,
        processedFileStates: List<ProcessedFileState>
    ): Boolean {
        return HistorySessionChangesStore.saveSessionChanges(
            projectPath,
            sessionId,
            adapterName,
            baseToolCallIndex,
            processedFileStates
        )
    }

    fun deleteSessionChanges(projectPath: String, sessionId: String, adapterName: String): Boolean {
        return HistorySessionChangesStore.deleteSessionChanges(projectPath, sessionId, adapterName)
    }

    suspend fun syncHistoryIndex(projectPath: String?): Boolean = withContext(Dispatchers.IO) {
        HistorySyncService.syncHistoryIndex(projectPath)
    }

    suspend fun getHistoryList(projectPath: String?): List<SessionMeta> = withContext(Dispatchers.IO) {
        HistorySyncService.getHistoryList(projectPath)
    }

    suspend fun syncAndGetHistoryList(projectPath: String?): List<SessionMeta> = withContext(Dispatchers.IO) {
        HistorySyncService.syncAndGetHistoryList(projectPath)
    }

    suspend fun getConversationSessions(projectPath: String?, conversationId: String?): List<SessionMeta> =
        withContext(Dispatchers.IO) {
            HistorySyncService.getConversationSessions(projectPath, conversationId)
        }

    suspend fun deleteConversations(
        projectPath: String?,
        conversationIds: List<String>
    ): DeleteConversationsResult = withContext(Dispatchers.IO) {
        HistoryDeletionService.deleteConversations(projectPath, conversationIds)
    }

    suspend fun deleteSessionImmediately(
        projectPath: String?,
        sessionId: String,
        adapterName: String,
        waitTimeoutMillis: Long = 5_000L,
        pollIntervalMillis: Long = 250L
    ): Boolean = withContext(Dispatchers.IO) {
        HistoryDeletionService.deleteSessionImmediately(
            projectPath,
            sessionId,
            adapterName,
            waitTimeoutMillis,
            pollIntervalMillis
        )
    }

    suspend fun renameConversation(projectPath: String?, conversationId: String, newTitle: String): Boolean =
        withContext(Dispatchers.IO) {
            HistoryConversationIndexService.renameConversation(projectPath, conversationId, newTitle)
        }

    private fun hasConversationInCurrentEnvironment(projectPath: String, conversationId: String): Boolean {
        val cleanConversationId = runCatching {
            HistoryStorage.requireSafeConversationId(conversationId)
        }.getOrElse { return false }
        return HistoryStorage.readExistingProjectIndex(projectPath).any { conversation ->
            conversation.id == cleanConversationId
        }
    }
}
