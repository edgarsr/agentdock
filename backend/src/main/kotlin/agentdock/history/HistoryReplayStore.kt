package agentdock.history

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import agentdock.utils.atomicWriteText
import java.io.File

internal object HistoryReplayStore {
    fun readConversationData(file: File): ConversationReplayData? {
        if (!file.exists() || !file.isFile) return null
        return runCatching {
            HistoryStorage.json.decodeFromString<ConversationReplayData>(file.readText())
        }.getOrNull()
    }

    fun writeConversationData(projectPath: String, conversationId: String, data: ConversationReplayData) {
        val file = HistoryStorage.conversationDataFile(projectPath, conversationId)
        file.atomicWriteText(HistoryStorage.json.encodeToString(data))
        // Otherwise the search rebuilds it, as it is older than the data.
        runCatching { writeSearchText(HistoryStorage.conversationSearchTextFile(projectPath, conversationId), data) }
    }

    /**
     * The first of each conversation's messages where a word starts with the query, as a snippet keyed by the
     * conversation id. Rebuilds missing or outdated search text from the conversation data.
     */
    fun searchConversations(projectPath: String, conversationIds: List<String>, query: String): Map<String, String> {
        val pattern = Regex("(?<![\\p{L}\\p{N}])${Regex.escape(query)}", RegexOption.IGNORE_CASE)
        return conversationIds.mapNotNull { conversationId ->
            runCatching {
                val searchFile = HistoryStorage.conversationSearchTextFile(projectPath, conversationId)
                val dataFile = HistoryStorage.conversationDataFile(projectPath, conversationId)
                val dataModified = dataFile.lastModified()
                if (searchFile.lastModified() < dataModified) {
                    writeSearchText(searchFile, readConversationData(dataFile) ?: return@runCatching null)
                    // Data written meanwhile stays newer, so the next search rebuilds again.
                    searchFile.setLastModified(dataModified)
                }
                searchFile.useLines { lines ->
                    lines.firstNotNullOfOrNull { line -> pattern.find(line)?.let { snippet(line, it.range.first) } }
                }?.let { conversationId to it }
            }.getOrNull()
        }.toMap()
    }

    private fun writeSearchText(file: File, data: ConversationReplayData) {
        val messages = data.sessions.flatMap { session ->
            session.prompts.flatMap { prompt -> prompt.blocks + prompt.events }
        }.mapNotNull { block ->
            val type = (block["type"] as? JsonPrimitive)?.content
            if (type != "text" && type != "elicitation_answer") return@mapNotNull null
            (block["text"] as? JsonPrimitive)?.content?.replace(whitespace, " ")?.trim()?.ifEmpty { null }
        }
        file.atomicWriteText(messages.joinToString("\n"))
    }

    private val whitespace = Regex("\\s+")

    /** Up to 200 characters of the line, starting a little before the match. */
    private fun snippet(line: String, matchStart: Int): String {
        var start = (matchStart - 40).coerceAtLeast(0)
        var end = (start + 200).coerceAtMost(line.length)
        if (start > 0 && line[start].isLowSurrogate()) start++
        if (end < line.length && line[end - 1].isHighSurrogate()) end--
        return (if (start > 0) "…" else "") + line.substring(start, end) + (if (end < line.length) "…" else "")
    }

    fun copyPromptPrefix(data: ConversationReplayData, promptCount: Int): ConversationReplayData {
        if (promptCount <= 0) return ConversationReplayData()
        var remaining = promptCount
        val sessions = data.sessions.mapNotNull { session ->
            if (remaining <= 0) return@mapNotNull null
            val prompts = session.prompts.take(remaining)
            remaining -= prompts.size
            if (prompts.isEmpty()) {
                null
            } else {
                session.copy(prompts = prompts)
            }
        }
        return ConversationReplayData(sessions = sessions)
    }

    fun normalizeReplayBlocks(blocks: List<JsonObject>): List<JsonObject> {
        if (blocks.size < 2) return blocks
        val normalized = ArrayList<JsonObject>(blocks.size)
        // The text merged into the last block so far, written into it once its run of chunks ends.
        var mergedText: StringBuilder? = null
        fun writeMergedText() {
            val text = mergedText ?: return
            normalized[normalized.lastIndex] = JsonObject(normalized.last() + ("text" to JsonPrimitive(text.toString())))
            mergedText = null
        }
        blocks.forEach { block ->
            val currentRole = (block["role"] as? JsonPrimitive)?.content
            val currentType = (block["type"] as? JsonPrimitive)?.content
            val currentText = (block["text"] as? JsonPrimitive)?.content
            val last = normalized.lastOrNull()
            val lastRole = last?.get("role")?.let { it as? JsonPrimitive }?.content
            val lastType = last?.get("type")?.let { it as? JsonPrimitive }?.content
            val lastText = last?.get("text")?.let { it as? JsonPrimitive }?.content
            val mergeable = last != null &&
                currentRole == "assistant" &&
                lastRole == "assistant" &&
                currentText != null &&
                lastText != null &&
                currentType == lastType &&
                (currentType == "thinking" || currentType == "text")
            if (!mergeable) {
                writeMergedText()
                normalized.add(block)
                return@forEach
            }
            (mergedText ?: StringBuilder(lastText).also { mergedText = it }).append(currentText)
        }
        writeMergedText()
        return normalized
    }

    fun normalizeReplayData(data: ConversationReplayData): ConversationReplayData {
        val normalizedSessions = data.sessions.map { session ->
            session.copy(prompts = session.prompts.map(::normalizeReplayPrompt))
        }
        return data.copy(sessions = normalizedSessions)
    }

    fun titleCandidateFromReplayData(data: ConversationReplayData): String? {
        val firstPromptBlocks = data.sessions.asSequence()
            .flatMap { session -> session.prompts.asSequence() }
            .firstOrNull()
            ?.blocks
            ?: return null
        return titleCandidateFromPromptBlocks(firstPromptBlocks)
    }

    fun replayPromptCount(data: ConversationReplayData): Int {
        return data.sessions.sumOf { session -> session.prompts.size }
    }

    fun deleteConversationReplay(projectPath: String, conversationId: String): Boolean {
        deleteHistoryFileIfExists(HistoryStorage.conversationSearchTextFile(projectPath, conversationId))
        return deleteHistoryFileIfExists(HistoryStorage.conversationDataFile(projectPath, conversationId))
    }

    fun mergeConversationReplayFiles(
        projectPath: String,
        sourceConversationId: String?,
        targetConversationId: String
    ) {
        val cleanSourceConversationId = sourceConversationId?.trim().orEmpty()
        val cleanTargetConversationId = targetConversationId.trim()
        if (cleanSourceConversationId.isBlank() || cleanTargetConversationId.isBlank()) return
        if (cleanSourceConversationId == cleanTargetConversationId) return

        val sourceFile = HistoryStorage.conversationDataFile(projectPath, cleanSourceConversationId)
        val targetFile = HistoryStorage.conversationDataFile(projectPath, cleanTargetConversationId)
        val source = readConversationData(sourceFile) ?: return
        val target = readConversationData(targetFile) ?: ConversationReplayData()

        val mergedSessions = target.sessions.toMutableList()
        source.sessions.forEach { sourceSession ->
            val existingIndex = mergedSessions.indexOfFirst {
                it.sessionId == sourceSession.sessionId && it.adapterName == sourceSession.adapterName
            }
            if (existingIndex >= 0) {
                val existingSession = mergedSessions[existingIndex]
                mergedSessions[existingIndex] = existingSession.copy(
                    prompts = existingSession.prompts + sourceSession.prompts
                )
            } else {
                mergedSessions.add(sourceSession)
            }
        }

        writeConversationData(projectPath, cleanTargetConversationId, ConversationReplayData(sessions = mergedSessions))
        deleteConversationReplay(projectPath, cleanSourceConversationId)
    }

    private fun normalizeReplayPrompt(prompt: ConversationPromptReplayEntry): ConversationPromptReplayEntry {
        val normalizedBlocks = normalizeReplayBlocks(prompt.blocks)
        val normalizedEvents = normalizeReplayBlocks(prompt.events)
        return if (normalizedBlocks === prompt.blocks && normalizedEvents === prompt.events) {
            prompt
        } else {
            prompt.copy(
                blocks = normalizedBlocks,
                events = normalizedEvents
            )
        }
    }

    private fun titleCandidateFromPromptBlocks(blocks: List<JsonObject>): String? {
        val text = blocks.asSequence()
            .mapNotNull { block ->
                val type = (block["type"] as? JsonPrimitive)?.content
                if (type != "text") return@mapNotNull null
                (block["text"] as? JsonPrimitive)?.content
            }
            .joinToString("")
            .replace(Regex("\\s+"), " ")
            .trim()
        if (text.isBlank()) return null
        return if (text.length <= 64) text else "${text.take(64)}..."
    }
}
