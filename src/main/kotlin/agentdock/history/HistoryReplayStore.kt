package agentdock.history

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import agentdock.utils.atomicWriteText
import java.io.File
import java.nio.file.Files

internal object HistoryReplayStore {
    private const val CONVERSATION_REPLAY_STALE_TOLERANCE_MS = 60_000L

    fun readConversationData(file: File): ConversationReplayData? {
        if (!file.exists() || !file.isFile) return null
        return runCatching {
            HistoryStorage.json.decodeFromString<ConversationReplayData>(file.readText())
        }.getOrNull()
    }

    fun writeConversationData(file: File, data: ConversationReplayData) {
        file.atomicWriteText(HistoryStorage.json.encodeToString(data))
    }

    fun normalizeReplayBlocks(blocks: List<JsonObject>): List<JsonObject> {
        if (blocks.size < 2) return blocks
        val normalized = ArrayList<JsonObject>(blocks.size)
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
                normalized.add(block)
                return@forEach
            }
            normalized[normalized.lastIndex] = buildJsonObject {
                last.forEach { (key, value) ->
                    if (key != "text") put(key, value)
                }
                put("text", JsonPrimitive("${lastText}${currentText}"))
            }
        }
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

        writeConversationData(targetFile, ConversationReplayData(sessions = mergedSessions))
        deleteHistoryFileIfExists(sourceFile)
    }

    fun resolveFreshConversationReplayFile(projectPath: String, conversationId: String): File? {
        val replayFile = HistoryStorage.conversationDataFile(projectPath, conversationId)
        if (!replayFile.exists() || !replayFile.isFile) return null

        val latestSourceFile = latestConversationSourceSessionFile(projectPath, conversationId)
        val latestSourceUpdatedAt = latestSourceFile?.lastModified()?.takeIf { it > 0L } ?: return replayFile
        val replayUpdatedAt = replayFile.lastModified().coerceAtLeast(0L)
        val replayStillFresh = replayUpdatedAt + CONVERSATION_REPLAY_STALE_TOLERANCE_MS >= latestSourceUpdatedAt
        if (replayStillFresh) return replayFile

        val deleted = runCatching { Files.deleteIfExists(replayFile.toPath()) }.getOrElse { cause ->
            throw IllegalStateException("Failed to delete stale conversation replay '$conversationId': ${cause.message ?: cause}")
        }
        if (!deleted && replayFile.exists()) {
            throw IllegalStateException("Failed to delete stale conversation replay '$conversationId'")
        }
        return null
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

    private fun latestConversationSourceSessionFile(projectPath: String, conversationId: String): File? {
        val conversation = HistoryStorage.readExistingProjectIndex(projectPath)
            .firstOrNull { it.id == conversationId }
            ?: return null
        val latestSession = conversation.sessions.maxByOrNull { it.updatedAt } ?: return null
        val sourceFilePath = latestSession.sourceFilePath?.trim().orEmpty()
        if (sourceFilePath.isBlank()) return null
        val sourceFile = File(sourceFilePath)
        return sourceFile.takeIf { it.exists() && it.isFile }
    }
}
