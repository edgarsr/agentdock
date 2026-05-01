package agentdock.history

import agentdock.utils.atomicWriteText
import java.time.Instant

internal object HistoryConversationIndexService {
    fun isAutomaticTagTitleCandidate(title: String?): Boolean {
        val normalized = title?.trim().orEmpty()
        return Regex("^\\[[^\\]\\r\\n]+]").containsMatchIn(normalized)
    }

    fun hasIndexedConversationSession(
        projectPath: String,
        conversationId: String,
        sessionId: String,
        adapterName: String
    ): Boolean {
        val cleanConversationId = runCatching {
            HistoryStorage.requireSafeConversationId(conversationId)
        }.getOrElse { return false }
        return HistoryStorage.readExistingProjectIndex(projectPath).any { conversation ->
            conversation.id == cleanConversationId &&
                conversation.sessions.any { session ->
                    session.sessionId == sessionId && session.adapterName == adapterName
                }
        }
    }

    @Synchronized
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
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        val cleanConversationId = runCatching {
            HistoryStorage.requireSafeConversationId(conversationId)
        }.getOrElse { return false }
        val cleanSessionId = sessionId.trim()
        val cleanAdapterName = adapterName.trim()
        if (
            cleanProjectPath.isBlank() ||
            cleanConversationId.isBlank() ||
            cleanSessionId.isBlank() ||
            cleanAdapterName.isBlank()
        ) {
            return false
        }

        val now = Instant.now().toEpochMilli()
        val normalizedTitle = titleCandidate?.trim().orEmpty()
        val indexFile = HistoryStorage.ensureProjectIndexFile(cleanProjectPath)
        val conversations = HistoryStorage.readProjectIndex(indexFile).toMutableList()

        val sameConversationIndices = conversations.mapIndexedNotNull { index, conversation ->
            index.takeIf { conversation.id == cleanConversationId }
        }
        val insertIndex = sameConversationIndices.firstOrNull() ?: conversations.size

        val mergedConversation = mergeMatchingConversations(conversations, sameConversationIndices)

        val existingSession = mergedConversation?.sessions?.firstOrNull { session ->
            session.sessionId == cleanSessionId && session.adapterName == cleanAdapterName
        }
        val sourceMeta = HistorySessionSourceResolver.findSessionSourceMeta(
            cleanProjectPath,
            cleanSessionId,
            cleanAdapterName
        )
        val sourceFilePath = sourceMeta?.filePath?.takeIf { it.isNotBlank() }

        val updatedSessions = when {
            existingSession != null -> {
                val conversation = mergedConversation ?: return false
                conversation.sessions.map { session ->
                    if (session.sessionId != cleanSessionId || session.adapterName != cleanAdapterName) {
                        return@map session
                    }
                    session.copy(
                        updatedAt = if (touchUpdatedAt) now else session.updatedAt,
                        createdAt = if (session.createdAt > 0) session.createdAt else now,
                        sourceFilePath = sourceFilePath ?: session.sourceFilePath
                    )
                }
            }
            touchUpdatedAt -> (mergedConversation?.sessions ?: emptyList()) + HistorySessionIndexEntry(
                sessionId = cleanSessionId,
                adapterName = cleanAdapterName,
                createdAt = now,
                updatedAt = now,
                sourceFilePath = sourceFilePath,
                changes = null
            )
            else -> return false
        }

        val existingTitle = mergedConversation?.title?.takeIf { it.isNotBlank() }
        val shouldBlockTagTitle = existingTitle != null && isAutomaticTagTitleCandidate(normalizedTitle)
        val shouldForceTitle = forceTitle &&
            normalizedTitle.isNotBlank() &&
            !shouldBlockTagTitle &&
            mergedConversation?.titleUserSet != true
        val updatedConversation = HistoryConversationIndexEntry(
            id = cleanConversationId,
            title = when {
                shouldForceTitle -> normalizedTitle
                existingTitle != null -> existingTitle
                normalizedTitle.isNotBlank() -> normalizedTitle
                else -> "Untitled Session"
            },
            titleUserSet = mergedConversation?.titleUserSet ?: false,
            promptCount = mergePromptCounts(mergedConversation?.promptCount, promptCount),
            transcriptPath = mergedConversation?.transcriptPath,
            sessions = updatedSessions
        )

        sameConversationIndices.asReversed().forEach { index -> conversations.removeAt(index) }
        conversations.add(insertIndex.coerceAtMost(conversations.size), updatedConversation)
        HistoryStorage.writeProjectIndex(indexFile, conversations)
        return true
    }

    @Synchronized
    fun saveConversationTranscript(projectPath: String?, conversationId: String, transcriptText: String): String? {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        val cleanConversationId = runCatching {
            HistoryStorage.requireSafeConversationId(conversationId)
        }.getOrElse { return null }
        val normalizedTranscript = transcriptText.trim()
        if (cleanProjectPath.isBlank() || cleanConversationId.isBlank() || normalizedTranscript.isBlank()) return null

        val transcriptFile = HistoryStorage.conversationTranscriptFile(cleanProjectPath, cleanConversationId)
        transcriptFile.atomicWriteText(normalizedTranscript)

        val indexFile = HistoryStorage.ensureProjectIndexFile(cleanProjectPath)
        val conversations = HistoryStorage.readProjectIndex(indexFile).toMutableList()
        val sameConversationIndices = conversations.mapIndexedNotNull { index, conversation ->
            index.takeIf { conversation.id == cleanConversationId }
        }
        val insertIndex = sameConversationIndices.firstOrNull() ?: conversations.size

        val mergedConversation = mergeMatchingConversations(conversations, sameConversationIndices)

        val updatedConversation = (mergedConversation ?: HistoryConversationIndexEntry(
            id = cleanConversationId
        )).copy(
            transcriptPath = transcriptFile.absolutePath
        )

        sameConversationIndices.asReversed().forEach { index -> conversations.removeAt(index) }
        conversations.add(insertIndex.coerceAtMost(conversations.size), updatedConversation)
        HistoryStorage.writeProjectIndex(indexFile, conversations)
        return transcriptFile.absolutePath
    }

    @Synchronized
    fun appendSessionToConversation(
        projectPath: String?,
        previousSessionId: String,
        previousAdapterName: String,
        sessionId: String,
        adapterName: String,
        titleCandidate: String? = null
    ): Boolean {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        val cleanPreviousSessionId = previousSessionId.trim()
        val cleanPreviousAdapterName = previousAdapterName.trim()
        val cleanSessionId = sessionId.trim()
        val cleanAdapterName = adapterName.trim()
        if (cleanProjectPath.isBlank()) return false
        if (cleanPreviousSessionId.isBlank() || cleanPreviousAdapterName.isBlank()) return false
        if (cleanSessionId.isBlank() || cleanAdapterName.isBlank()) return false
        if (cleanPreviousSessionId == cleanSessionId && cleanPreviousAdapterName == cleanAdapterName) return true

        val indexFile = HistoryStorage.ensureProjectIndexFile(cleanProjectPath)
        val existingConversations = HistoryStorage.readProjectIndex(indexFile).toMutableList()
        val targetConversationExists = existingConversations.any { conversation ->
            conversation.sessions.any { session ->
                session.sessionId == cleanPreviousSessionId && session.adapterName == cleanPreviousAdapterName
            }
        }
        if (!targetConversationExists) return false

        var extractedSession: HistorySessionIndexEntry? = null
        var extractedPromptCount: Int? = null
        var extractedConversationId: String? = null
        val conversations = existingConversations.mapNotNull { conversation ->
            val filteredSessions = conversation.sessions.filterNot { session ->
                val matchesTargetSession = session.sessionId == cleanSessionId && session.adapterName == cleanAdapterName
                if (matchesTargetSession && extractedSession == null) {
                    extractedSession = session
                    extractedPromptCount = conversation.promptCount
                    extractedConversationId = conversation.id
                }
                matchesTargetSession
            }
            if (filteredSessions.isEmpty()) {
                null
            } else {
                conversation.copy(sessions = filteredSessions)
            }
        }.toMutableList()

        val normalizedConversationIndex = conversations.indexOfFirst { conversation ->
            conversation.sessions.any { session ->
                session.sessionId == cleanPreviousSessionId && session.adapterName == cleanPreviousAdapterName
            }
        }
        if (normalizedConversationIndex < 0) return false

        val now = Instant.now().toEpochMilli()
        val sourceMeta = HistorySessionSourceResolver.findSessionSourceMeta(
            cleanProjectPath,
            cleanSessionId,
            cleanAdapterName
        )
        val newSession = extractedSession ?: HistorySessionIndexEntry(
            sessionId = cleanSessionId,
            adapterName = cleanAdapterName,
            createdAt = sourceMeta?.createdAt ?: now,
            updatedAt = sourceMeta?.updatedAt ?: now,
            changes = null
        )
        val existingConversation = conversations[normalizedConversationIndex]
        val alreadyPresent = existingConversation.sessions.any { session ->
            session.sessionId == cleanSessionId && session.adapterName == cleanAdapterName
        }
        if (alreadyPresent) {
            HistoryStorage.writeProjectIndex(indexFile, conversations)
            return true
        }

        conversations[normalizedConversationIndex] = existingConversation.copy(
            title = existingConversation.title.ifBlank { titleCandidate?.trim().orEmpty() },
            promptCount = mergePromptCounts(existingConversation.promptCount, extractedPromptCount),
            sessions = existingConversation.sessions + newSession
        )
        HistoryStorage.writeProjectIndex(indexFile, conversations)
        HistoryReplayStore.mergeConversationReplayFiles(
            cleanProjectPath,
            extractedConversationId,
            existingConversation.id
        )
        return true
    }

    @Synchronized
    fun renameConversation(projectPath: String?, conversationId: String, newTitle: String): Boolean {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        val cleanConversationId = runCatching {
            HistoryStorage.requireSafeConversationId(conversationId)
        }.getOrElse { return false }
        val normalizedTitle = newTitle.trim()
        if (cleanProjectPath.isBlank() || cleanConversationId.isBlank() || normalizedTitle.isBlank()) return false

        val indexFile = HistoryStorage.ensureProjectIndexFile(cleanProjectPath)
        val existing = HistoryStorage.readProjectIndex(indexFile)
        var updated = false

        val rewritten = existing.map { conversation ->
            if (conversation.id == cleanConversationId) {
                updated = true
                conversation.copy(title = normalizedTitle, titleUserSet = true)
            } else {
                conversation
            }
        }

        if (updated) {
            HistoryStorage.writeProjectIndex(indexFile, rewritten)
        }
        return updated
    }

    private fun mergeIndexConversations(
        left: HistoryConversationIndexEntry,
        right: HistoryConversationIndexEntry
    ): HistoryConversationIndexEntry {
        val mergedSessionsByKey = linkedMapOf<String, HistorySessionIndexEntry>()

        fun mergeSession(session: HistorySessionIndexEntry) {
            val key = "${session.sessionId}\u0000${session.adapterName}"
            val existing = mergedSessionsByKey[key]
            if (existing == null) {
                mergedSessionsByKey[key] = session
                return
            }
            mergedSessionsByKey[key] = existing.copy(
                createdAt = minOf(existing.createdAt, session.createdAt),
                updatedAt = maxOf(existing.updatedAt, session.updatedAt),
                changes = when {
                    existing.changes == null -> session.changes
                    session.changes == null -> existing.changes
                    existing.changes.updatedAt >= session.changes.updatedAt -> existing.changes
                    else -> session.changes
                }
            )
        }

        left.sessions.forEach(::mergeSession)
        right.sessions.forEach(::mergeSession)

        return HistoryConversationIndexEntry(
            id = left.id,
            title = when {
                left.title.isNotBlank() -> left.title
                right.title.isNotBlank() -> right.title
                else -> ""
            },
            titleUserSet = left.titleUserSet || right.titleUserSet,
            promptCount = mergePromptCounts(left.promptCount, right.promptCount),
            transcriptPath = when {
                !left.transcriptPath.isNullOrBlank() -> left.transcriptPath
                !right.transcriptPath.isNullOrBlank() -> right.transcriptPath
                else -> null
            },
            sessions = mergedSessionsByKey.values.toList()
        )
    }

    private fun mergeMatchingConversations(
        conversations: List<HistoryConversationIndexEntry>,
        indices: List<Int>
    ): HistoryConversationIndexEntry? {
        var merged: HistoryConversationIndexEntry? = null
        indices.forEach { index ->
            val current = conversations[index]
            merged = merged?.let { existing -> mergeIndexConversations(existing, current) } ?: current
        }
        return merged
    }

    private fun mergePromptCounts(current: Int?, incoming: Int?): Int? {
        return when {
            current == null -> incoming
            incoming == null -> current
            else -> maxOf(current, incoming)
        }
    }
}
