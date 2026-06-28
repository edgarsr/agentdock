package agentdock.history

import kotlinx.coroutines.delay
import agentdock.acp.AcpAdapterConfig
import java.io.File
import java.time.Instant

internal object HistoryDeletionService {
    suspend fun deleteConversations(
        projectPath: String?,
        conversationIds: List<String>
    ): DeleteConversationsResult {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        if (cleanProjectPath.isBlank()) return DeleteConversationsResult(success = false)
        if (conversationIds.isEmpty()) return DeleteConversationsResult(success = true)

        val indexFile = HistoryStorage.ensureProjectIndexFile(cleanProjectPath)
        val existing = HistoryStorage.readProjectIndex(indexFile)
        val targetIds = conversationIds.mapNotNull { id ->
            runCatching { HistoryStorage.requireSafeConversationId(id) }.getOrNull()
        }.toSet()
        val kept = mutableListOf<HistoryConversationIndexEntry>()
        val failures = mutableListOf<DeleteConversationFailure>()

        existing.forEach { conversation ->
            if (conversation.id !in targetIds) {
                kept.add(conversation)
                return@forEach
            }

            val remainingSessions = conversation.sessions.filterNot { session ->
                deleteSessionArtifacts(cleanProjectPath, session)
            }

            if (remainingSessions.isNotEmpty()) {
                kept.add(conversation.copy(sessions = remainingSessions))
                failures.add(
                    DeleteConversationFailure(
                        conversationId = conversation.id,
                        message = buildDeleteFailureMessage(remainingSessions)
                    )
                )
            } else {
                HistoryReplayStore.deleteConversationReplay(cleanProjectPath, conversation.id)
                deleteConversationTranscript(cleanProjectPath, conversation)
            }
        }

        HistoryStorage.writeProjectIndex(indexFile, kept)
        return DeleteConversationsResult(
            success = failures.isEmpty(),
            failures = failures
        )
    }

    suspend fun deleteSessionImmediately(
        projectPath: String?,
        sessionId: String,
        adapterName: String,
        waitTimeoutMillis: Long,
        pollIntervalMillis: Long
    ): Boolean {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        val cleanSessionId = sessionId.trim()
        val cleanAdapterName = adapterName.trim()
        if (cleanProjectPath.isBlank() || cleanSessionId.isBlank() || cleanAdapterName.isBlank()) {
            return false
        }

        val deadline = System.currentTimeMillis() + waitTimeoutMillis.coerceAtLeast(0L)
        var sourceMeta = HistorySessionSourceResolver.findSessionSourceMeta(cleanProjectPath, cleanSessionId, cleanAdapterName)
        while (sourceMeta == null && System.currentTimeMillis() < deadline) {
            delay(pollIntervalMillis.coerceAtLeast(50L))
            sourceMeta = HistorySessionSourceResolver.findSessionSourceMeta(cleanProjectPath, cleanSessionId, cleanAdapterName)
        }

        val sessionEntry = HistorySessionIndexEntry(
            sessionId = cleanSessionId,
            adapterName = cleanAdapterName,
            createdAt = sourceMeta?.createdAt ?: Instant.now().toEpochMilli(),
            updatedAt = sourceMeta?.updatedAt ?: Instant.now().toEpochMilli(),
            sourceFilePath = sourceMeta?.filePath?.takeIf { it.isNotBlank() },
            changes = null
        )

        val deletedArtifacts = deleteSessionArtifacts(cleanProjectPath, sessionEntry)

        val indexFile = HistoryStorage.ensureProjectIndexFile(cleanProjectPath)
        val existing = HistoryStorage.readProjectIndex(indexFile)
        var indexChanged = false
        val rewritten = existing.mapNotNull { conversation ->
            val remainingSessions = conversation.sessions.filterNot {
                it.sessionId == cleanSessionId && it.adapterName == cleanAdapterName
            }
            if (remainingSessions.size == conversation.sessions.size) {
                return@mapNotNull conversation
            }
            indexChanged = true
            if (remainingSessions.isEmpty()) {
                HistoryReplayStore.deleteConversationReplay(cleanProjectPath, conversation.id)
                deleteConversationTranscript(cleanProjectPath, conversation)
                null
            } else {
                conversation.copy(sessions = remainingSessions)
            }
        }

        if (indexChanged) {
            HistoryStorage.writeProjectIndex(indexFile, rewritten)
        }

        return deletedArtifacts
    }

    private fun deleteSessionArtifacts(projectPath: String, session: HistorySessionIndexEntry): Boolean {
        if (runCatching { AcpAdapterConfig.getAdapterInfo(session.adapterName) }.isFailure) {
            return true
        }
        val sourceMeta = HistorySessionSourceResolver.findSessionSourceMeta(projectPath, session.sessionId, session.adapterName)
        val sourceFilePath = session.sourceFilePath?.takeIf { it.isNotBlank() }
            ?: sourceMeta?.filePath?.takeIf { it.isNotBlank() }
            ?: SessionListDeleteSupport.resolveSourceFilePath(projectPath, session.adapterName, session.sessionId)
        return SessionListDeleteSupport.deleteSession(projectPath, session.adapterName, session.sessionId, sourceFilePath)
    }

    private fun deleteConversationTranscript(projectPath: String, conversation: HistoryConversationIndexEntry): Boolean {
        val transcriptPath = conversation.transcriptPath?.takeIf { it.isNotBlank() }
        val transcriptFile = if (transcriptPath != null) {
            File(transcriptPath)
        } else {
            HistoryStorage.conversationTranscriptFile(projectPath, conversation.id)
        }
        return deleteHistoryFileIfExists(transcriptFile)
    }

    private fun buildDeleteFailureMessage(remainingSessions: List<HistorySessionIndexEntry>): String {
        val adapterLabels = remainingSessions
            .map { session ->
                runCatching { AcpAdapterConfig.getAdapterInfo(session.adapterName).name }.getOrDefault(session.adapterName)
            }
            .distinct()

        return if (adapterLabels.size == 1) {
            "Failed to delete  conversation files because they may be locked by another application. Close the external tool and try again."
        } else {
            "Failed to delete one or more conversation files because they may be locked by another application. Close the external tools and try again."
        }
    }
}
