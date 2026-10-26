package agentdock.history

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds

object AgentDockHistoryService {
    fun registerEphemeralSession(projectPath: String?, adapterName: String, sessionId: String) {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        val cleanAdapterName = adapterName.trim()
        val cleanSessionId = sessionId.trim()
        if (cleanProjectPath.isBlank() || cleanAdapterName.isBlank() || cleanSessionId.isBlank()) return

        HistoryStorage.addEphemeralSession(cleanProjectPath, cleanAdapterName, cleanSessionId)
    }

    fun removeEphemeralSession(projectPath: String?, adapterName: String, sessionId: String) {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        val cleanAdapterName = adapterName.trim()
        val cleanSessionId = sessionId.trim()
        if (cleanProjectPath.isBlank() || cleanAdapterName.isBlank() || cleanSessionId.isBlank()) return

        HistoryStorage.removeEphemeralSession(cleanProjectPath, cleanAdapterName, cleanSessionId)
    }

    fun startBackgroundHistorySync(projectPath: String?) {
        HistorySyncService.startBackgroundHistorySync(projectPath)
    }

    fun upsertRuntimeSessionMetadata(
        projectPath: String?,
        conversationId: String,
        sessionId: String,
        adapterName: String,
        configOptions: Map<String, String> = emptyMap(),
        promptCount: Int,
        titleCandidate: String?,
        inheritedAdapterNames: List<String> = emptyList(),
        touchUpdatedAt: Boolean = false,
        forceTitle: Boolean = false
    ): Boolean {
        return HistoryConversationIndexService.upsertRuntimeSessionMetadata(
            projectPath,
            conversationId,
            sessionId,
            adapterName,
            configOptions,
            promptCount,
            titleCandidate,
            inheritedAdapterNames,
            touchUpdatedAt,
            forceTitle
        )
    }

    fun loadConversationReplay(projectPath: String?, conversationId: String?): ConversationReplayData? {
        synchronized(HistoryConversationIndexService) {
            val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
            val cleanConversationId = runCatching {
                HistoryStorage.requireSafeConversationId(conversationId.orEmpty())
            }.getOrElse { return null }
            if (cleanProjectPath.isBlank() || cleanConversationId.isBlank()) return null
            if (!hasConversation(cleanProjectPath, cleanConversationId)) return null
            val replayFile = HistoryStorage.conversationDataFile(cleanProjectPath, cleanConversationId)
            val data = HistoryReplayStore.readConversationData(replayFile) ?: return null
            val lastPrompt = data.sessions.lastOrNull()?.prompts?.lastOrNull()
            if (lastPrompt != null && lastPrompt.assistantMeta == null) {
                runCatching { HistoryReplayStore.deleteConversationReplay(cleanProjectPath, cleanConversationId) }
                return null
            }
            return data
        }
    }

    fun saveConversationReplay(projectPath: String?, conversationId: String, data: ConversationReplayData): Boolean {
        synchronized(HistoryConversationIndexService) {
            val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
            val cleanConversationId = runCatching {
                HistoryStorage.requireSafeConversationId(conversationId)
            }.getOrElse { return false }
            if (cleanProjectPath.isBlank() || cleanConversationId.isBlank()) return false

            HistoryReplayStore.writeConversationData(
                cleanProjectPath,
                cleanConversationId,
                HistoryReplayStore.normalizeReplayData(data)
            )
            return true
        }
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
        assistantMeta: ConversationAssistantMetadata? = null,
        forkBase: ForkConversationBase? = null
    ): Boolean {
        synchronized(HistoryConversationIndexService) {
            val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
            val cleanConversationId = runCatching {
                HistoryStorage.requireSafeConversationId(conversationId)
            }.getOrElse { return false }
            val cleanSessionId = sessionId.trim()
            val cleanAdapterName = adapterName.trim()
            if (cleanProjectPath.isBlank()) return false
            if (cleanConversationId.isBlank() || cleanSessionId.isBlank() || cleanAdapterName.isBlank()) return false

            val file = HistoryStorage.conversationDataFile(cleanProjectPath, cleanConversationId)
            val current = conversationDataWithForkBase(
                projectPath = cleanProjectPath,
                targetConversationId = cleanConversationId,
                targetFile = file,
                forkBase = forkBase
            )
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
            HistoryReplayStore.writeConversationData(cleanProjectPath, cleanConversationId, updatedData)
            upsertRuntimeSessionMetadata(
                projectPath = cleanProjectPath,
                conversationId = cleanConversationId,
                sessionId = cleanSessionId,
                adapterName = cleanAdapterName,
                configOptions = assistantMeta?.configOptions.orEmpty().associate { it.id to it.value },
                promptCount = HistoryReplayStore.replayPromptCount(updatedData),
                titleCandidate = HistoryReplayStore.titleCandidateFromReplayData(updatedData),
                touchUpdatedAt = true
            )
            return true
        }
    }

    /** Update the last displayed answer without creating another user turn. */
    internal fun updateLastConversationPromptEvents(
        projectPath: String?,
        conversationId: String,
        sessionId: String,
        adapterName: String,
        update: (MutableList<JsonObject>) -> Unit
    ) {
        synchronized(HistoryConversationIndexService) {
            val current = loadConversationReplay(projectPath, conversationId) ?: return
            val session = current.sessions.lastOrNull() ?: return
            if (session.sessionId != sessionId || session.adapterName != adapterName) return
            val prompt = session.prompts.lastOrNull() ?: return
            val events = prompt.events.toMutableList()
            update(events)
            if (events == prompt.events) return
            saveConversationReplay(projectPath, conversationId, current.copy(
                sessions = current.sessions.dropLast(1) + session.copy(
                    prompts = session.prompts.dropLast(1) + prompt.copy(events = events)
                )
            ))
        }
    }

    private fun conversationDataWithForkBase(
        projectPath: String,
        targetConversationId: String,
        targetFile: java.io.File,
        forkBase: ForkConversationBase?
    ): ConversationReplayData {
        val current = HistoryReplayStore.readConversationData(targetFile)
        if (current != null) return current
        if (targetFile.exists() && targetFile.length() > 0L) return ConversationReplayData()

        val base = forkBase ?: return ConversationReplayData()
        val cleanSourceConversationId = runCatching {
            HistoryStorage.requireSafeConversationId(base.sourceConversationId)
        }.getOrNull() ?: return ConversationReplayData()
        if (cleanSourceConversationId == targetConversationId) return ConversationReplayData()

        val sourceFile = HistoryStorage.conversationDataFile(projectPath, cleanSourceConversationId)
        val source = HistoryReplayStore.readConversationData(sourceFile) ?: return ConversationReplayData()
        return HistoryReplayStore.copyPromptPrefix(source, base.promptCount)
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
        waitTimeout: Duration = 5.seconds,
        pollInterval: Duration = 250.milliseconds
    ): Boolean = withContext(Dispatchers.IO) {
        HistoryDeletionService.deleteSessionImmediately(
            projectPath,
            sessionId,
            adapterName,
            waitTimeout,
            pollInterval
        )
    }

    suspend fun updateConversations(
        projectPath: String?,
        conversationIds: List<String>,
        newTitle: String?,
        pinned: Boolean?,
        archived: Boolean?,
        group: String?
    ): Boolean = withContext(Dispatchers.IO) {
        HistoryConversationIndexService.updateConversations(projectPath, conversationIds, newTitle, pinned, archived, group)
    }

    suspend fun renameGroup(projectPath: String?, group: String, newGroup: String): Boolean =
        withContext(Dispatchers.IO) {
            HistoryConversationIndexService.renameGroup(projectPath, group, newGroup)
        }

    private fun hasConversation(projectPath: String, conversationId: String): Boolean {
        val cleanConversationId = runCatching {
            HistoryStorage.requireSafeConversationId(conversationId)
        }.getOrElse { return false }
        return HistoryStorage.readExistingProjectIndex(projectPath).any { conversation ->
            conversation.id == cleanConversationId
        }
    }
}
