package agentdock.history

import agentdock.utils.atomicWriteText
import java.time.Instant

/**
 * Every read-modify-write of a project's index or conversation files holds this object's monitor, which its
 * `@Synchronized` methods use; otherwise a writer working from an older read overwrites the others' changes.
 */
internal object HistoryConversationIndexService {
    @Synchronized
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
                mergedConversation.sessions.map { session ->
                    if (session.sessionId != cleanSessionId || session.adapterName != cleanAdapterName) {
                        return@map session
                    }
                    session.copy(
                        configOptions = configOptions.ifEmpty { session.configOptions },
                        updatedAt = if (touchUpdatedAt) now else session.updatedAt,
                        createdAt = if (session.createdAt > 0) session.createdAt else now,
                        sourceFilePath = sourceFilePath ?: session.sourceFilePath
                    )
                }
            }
            touchUpdatedAt -> (mergedConversation?.sessions ?: emptyList()) + HistorySessionIndexEntry(
                sessionId = cleanSessionId,
                adapterName = cleanAdapterName,
                configOptions = configOptions,
                createdAt = now,
                updatedAt = now,
                sourceFilePath = sourceFilePath,
                changes = null
            )
            else -> return false
        }

        val existingTitle = mergedConversation?.title?.takeIf { it.isNotBlank() }
        val shouldForceTitle = forceTitle &&
            normalizedTitle.isNotBlank() &&
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
            pinned = mergedConversation?.pinned ?: false,
            archived = mergedConversation?.archived ?: false,
            group = mergedConversation?.group,
            promptCount = promptCountForConversation(
                projectPath = cleanProjectPath,
                conversationId = cleanConversationId,
                fallback = mergePromptCounts(mergedConversation?.promptCount, promptCount)
            ),
            transcriptPath = mergedConversation?.transcriptPath,
            usedAdapterNames = moveAdapterNameToEnd(
                base = effectiveUsedAdapterNames(mergedConversation, inheritedAdapterNames),
                adapterName = cleanAdapterName
            ),
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
            configOptions = sourceMeta?.configOptions.orEmpty(),
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
            usedAdapterNames = moveAdapterNameToEnd(
                base = effectiveUsedAdapterNames(existingConversation),
                adapterName = cleanAdapterName
            ),
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

    /**
     * Renames the conversations (a user-set title), pins or unpins them, archives or unarchives them and/or moves them
     * to a group, a blank one leaving them ungrouped; `null` leaves that property unchanged.
     */
    @Synchronized
    fun updateConversations(
        projectPath: String?,
        conversationIds: List<String>,
        newTitle: String?,
        pinned: Boolean?,
        archived: Boolean?,
        group: String?
    ): Boolean {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        val cleanConversationIds = runCatching {
            conversationIds.mapTo(hashSetOf(), HistoryStorage::requireSafeConversationId)
        }.getOrElse { return false }
        val normalizedTitle = newTitle?.trim()
        if (cleanProjectPath.isBlank() || cleanConversationIds.isEmpty() || normalizedTitle?.isBlank() == true) return false

        val indexFile = HistoryStorage.ensureProjectIndexFile(cleanProjectPath)
        val existing = HistoryStorage.readProjectIndex(indexFile)
        var updated = false

        val rewritten = existing.map { conversation ->
            if (conversation.id in cleanConversationIds) {
                updated = true
                conversation.copy(
                    title = normalizedTitle ?: conversation.title,
                    titleUserSet = conversation.titleUserSet || normalizedTitle != null,
                    pinned = pinned ?: conversation.pinned,
                    archived = archived ?: conversation.archived,
                    group = if (group == null) conversation.group else group.trim().ifBlank { null }
                )
            } else {
                conversation
            }
        }

        if (updated) {
            HistoryStorage.writeProjectIndex(indexFile, rewritten)
        }
        return updated
    }

    /** Moves the group's conversations to `newGroup`, renaming or merging the group; a blank one ungroups them. */
    @Synchronized
    fun renameGroup(projectPath: String?, group: String, newGroup: String): Boolean {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        if (cleanProjectPath.isBlank() || group.isBlank()) return false

        val indexFile = HistoryStorage.ensureProjectIndexFile(cleanProjectPath)
        val existing = HistoryStorage.readProjectIndex(indexFile)
        val target = newGroup.trim().ifBlank { null }
        if (existing.none { it.group == group }) return false
        HistoryStorage.writeProjectIndex(
            indexFile,
            existing.map { conversation -> if (conversation.group == group) conversation.copy(group = target) else conversation }
        )
        return true
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
            pinned = left.pinned || right.pinned,
            archived = left.archived || right.archived,
            group = left.group ?: right.group,
            promptCount = mergePromptCounts(left.promptCount, right.promptCount),
            transcriptPath = when {
                !left.transcriptPath.isNullOrBlank() -> left.transcriptPath
                !right.transcriptPath.isNullOrBlank() -> right.transcriptPath
                else -> null
            },
            usedAdapterNames = normalizeAdapterNames(
                adapterNamesForConversation(left) + adapterNamesForConversation(right)
            ),
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

    private fun promptCountForConversation(projectPath: String, conversationId: String, fallback: Int?): Int? {
        val replayFile = HistoryStorage.conversationDataFile(projectPath, conversationId)
        val replayData = HistoryReplayStore.readConversationData(replayFile)
        return replayData?.let { HistoryReplayStore.replayPromptCount(it) } ?: fallback
    }

    internal fun adapterNamesForConversation(conversation: HistoryConversationIndexEntry): List<String> {
        val stored = normalizeAdapterNames(conversation.usedAdapterNames)
        if (stored.isNotEmpty()) return stored
        return normalizeAdapterNames(conversation.sessions.map { it.adapterName })
    }

    internal fun normalizeAdapterNames(adapterNames: List<String>): List<String> {
        val result = linkedMapOf<String, String>()
        adapterNames.forEach { adapterName ->
            val clean = adapterName.trim()
            if (clean.isBlank()) return@forEach
            result.remove(clean)
            result[clean] = clean
        }
        return result.values.toList()
    }

    internal fun moveAdapterNameToEnd(base: List<String>, adapterName: String): List<String> {
        return normalizeAdapterNames(base + adapterName)
    }

    private fun effectiveUsedAdapterNames(
        conversation: HistoryConversationIndexEntry?,
        inheritedAdapterNames: List<String> = emptyList()
    ): List<String> {
        return normalizeAdapterNames(
            inheritedAdapterNames + (
                conversation?.let(::adapterNamesForConversation) ?: emptyList()
            )
        )
    }
}
