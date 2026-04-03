package unified.llm.history

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import unified.llm.acp.AcpAdapterConfig
import unified.llm.acp.AcpAdapterPaths
import unified.llm.acp.AcpExecutionMode
import unified.llm.acp.AcpExecutionTarget
import java.io.File
import java.nio.file.Files
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap

@Serializable
data class SessionMeta(
    val sessionId: String,
    val adapterName: String,
    val conversationId: String? = null,
    val sessionCount: Int = 1,
    val promptCount: Int? = null,
    val modelId: String? = null,
    val modeId: String? = null,
    val projectPath: String,
    val title: String,
    val filePath: String,
    val createdAt: Long = Instant.now().toEpochMilli(),
    val updatedAt: Long = Instant.now().toEpochMilli(),
    val allAdapterNames: List<String> = emptyList()
)

data class SessionChangesData(
    val baseToolCallIndex: Int = 0,
    val processedFileStates: List<ProcessedFileState> = emptyList(),
    val updatedAt: Long = Instant.now().toEpochMilli()
)

@Serializable
data class ProcessedFileState(
    val filePath: String,
    val toolCallIndex: Int
)

@Serializable
data class ConversationAssistantMetadata(
    val agentId: String? = null,
    val agentName: String? = null,
    val modelId: String? = null,
    val modelName: String? = null,
    val modeId: String? = null,
    val modeName: String? = null,
    val promptStartedAtMillis: Long? = null,
    val durationSeconds: Double? = null,
    val contextTokensUsed: Long? = null,
    val contextWindowSize: Long? = null
)

@Serializable
data class ConversationPromptReplayEntry(
    val blocks: List<JsonObject> = emptyList(),
    val events: List<JsonObject> = emptyList(),
    val assistantMeta: ConversationAssistantMetadata? = null
)

@Serializable
data class ConversationSessionReplayEntry(
    val sessionId: String,
    val adapterName: String,
    val prompts: List<ConversationPromptReplayEntry> = emptyList()
)

@Serializable
data class ConversationReplayData(
    val sessions: List<ConversationSessionReplayEntry> = emptyList()
)

@Serializable
data class DeleteConversationFailure(
    val conversationId: String,
    val message: String
)

@Serializable
data class DeleteConversationsResult(
    val success: Boolean,
    val failures: List<DeleteConversationFailure> = emptyList()
)

@Serializable
private data class HistorySessionChangesEntry(
    val baseToolCallIndex: Int = 0,
    val processedFileStates: List<ProcessedFileState> = emptyList(),
    val updatedAt: Long = Instant.now().toEpochMilli()
)

@Serializable
private data class HistorySessionIndexEntry(
    val sessionId: String,
    val adapterName: String,
    val createdAt: Long,
    val updatedAt: Long,
    val sourceFilePath: String? = null,
    val changes: HistorySessionChangesEntry? = null
)

@Serializable
private data class HistoryConversationIndexEntry(
    val id: String,
    val title: String = "",
    val promptCount: Int? = null,
    val transcriptPath: String? = null,
    val sessions: List<HistorySessionIndexEntry> = emptyList(),
    val wslDistributionName: String? = null
)

@Serializable
private data class EphemeralSessionEntry(
    val sessionId: String,
    val adapterName: String,
    val createdAt: Long = Instant.now().toEpochMilli()
)

private data class AvailableSessionMetaResult(
    val sessions: List<SessionMeta>,
    val scannedAdapters: Set<String>
)
object UnifiedHistoryService {
    private val backgroundScope = CoroutineScope(Dispatchers.IO)
    private val ephemeralDeletionJobs = ConcurrentHashMap<String, Boolean>()
    private val indexJson = Json {
        ignoreUnknownKeys = true
        prettyPrint = true
        encodeDefaults = false
        explicitNulls = false
    }
    private const val CONVERSATION_REPLAY_STALE_TOLERANCE_MS = 60_000L

    private fun currentWslDistributionName(): String? {
        if (AcpAdapterPaths.getExecutionTarget() != AcpExecutionTarget.WSL) return null
        return AcpExecutionMode.selectedWslDistributionName().trim().takeIf { it.isNotEmpty() }
    }

    private fun historySyncKey(projectPath: String, wslDistributionName: String? = currentWslDistributionName()): String {
        return if (wslDistributionName.isNullOrBlank()) projectPath else "$projectPath||wsl:$wslDistributionName"
    }

    private fun matchesCurrentHistoryEnvironment(
        conversation: HistoryConversationIndexEntry,
        wslDistributionName: String? = currentWslDistributionName()
    ): Boolean {
        return if (wslDistributionName.isNullOrBlank()) {
            conversation.wslDistributionName.isNullOrBlank()
        } else {
            conversation.wslDistributionName == wslDistributionName
        }
    }
    private fun projectIndexFile(projectPath: String): File {
        val baseDir = File(AcpAdapterPaths.getBaseRuntimeDir(), "projects")
        val slug = historyProjectPathSlug(projectPath.replace("/", "\\"))
        return File(File(baseDir, slug), "index.json")
    }

    private fun projectConversationsDir(projectPath: String): File {
        return File(projectIndexFile(projectPath).parentFile, "conversations")
    }

    private fun ephemeralSessionsFile(projectPath: String): File {
        return File(projectIndexFile(projectPath).parentFile, "ephemeral-sessions.json")
    }

    private fun ensureProjectConversationsDir(projectPath: String): File {
        val dir = projectConversationsDir(projectPath)
        if (!dir.exists()) {
            dir.mkdirs()
        }
        return dir
    }

    private fun conversationDataFile(projectPath: String, conversationId: String): File {
        return File(ensureProjectConversationsDir(projectPath), "$conversationId.json")
    }

    private fun conversationTranscriptFile(projectPath: String, conversationId: String): File {
        return File(ensureProjectConversationsDir(projectPath), "$conversationId.transcript.txt")
    }

    private fun ensureProjectIndexFile(projectPath: String): File {
        val indexFile = projectIndexFile(projectPath)
        if (!indexFile.parentFile.exists()) {
            indexFile.parentFile.mkdirs()
        }
        if (!indexFile.exists()) {
            indexFile.writeText("[]")
        }
        return indexFile
    }

    private fun readProjectIndex(indexFile: File): MutableList<HistoryConversationIndexEntry> {
        return runCatching {
            indexJson.decodeFromString<List<HistoryConversationIndexEntry>>(indexFile.readText()).toMutableList()
        }.getOrElse { mutableListOf() }
    }

    private fun readExistingProjectIndex(projectPath: String): List<HistoryConversationIndexEntry> {
        if (projectPath.isBlank()) return emptyList()
        val indexFile = projectIndexFile(projectPath)
        if (!indexFile.exists() || !indexFile.isFile) return emptyList()
        return readProjectIndex(indexFile)
    }

    private fun readEphemeralSessions(projectPath: String): MutableList<EphemeralSessionEntry> {
        if (projectPath.isBlank()) return mutableListOf()
        val file = ephemeralSessionsFile(projectPath)
        if (!file.exists() || !file.isFile) return mutableListOf()
        return runCatching {
            indexJson.decodeFromString<List<EphemeralSessionEntry>>(file.readText()).toMutableList()
        }.getOrElse { mutableListOf() }
    }

    private fun writeEphemeralSessions(projectPath: String, entries: List<EphemeralSessionEntry>) {
        if (projectPath.isBlank()) return
        val file = ephemeralSessionsFile(projectPath)
        val parent = file.parentFile
        if (!parent.exists()) parent.mkdirs()
        file.writeText(indexJson.encodeToString(entries))
    }

    private fun removeEphemeralSession(projectPath: String, adapterName: String, sessionId: String) {
        if (projectPath.isBlank() || adapterName.isBlank() || sessionId.isBlank()) return
        val remaining = readEphemeralSessions(projectPath)
            .filterNot { it.adapterName == adapterName && it.sessionId == sessionId }
        writeEphemeralSessions(projectPath, remaining)
    }

    fun registerEphemeralSession(projectPath: String?, adapterName: String, sessionId: String) {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        val cleanAdapterName = adapterName.trim()
        val cleanSessionId = sessionId.trim()
        if (cleanProjectPath.isBlank() || cleanAdapterName.isBlank() || cleanSessionId.isBlank()) return

        val existing = readEphemeralSessions(cleanProjectPath)
        if (existing.any { it.adapterName == cleanAdapterName && it.sessionId == cleanSessionId }) return
        writeEphemeralSessions(
            cleanProjectPath,
            existing + EphemeralSessionEntry(
                sessionId = cleanSessionId,
                adapterName = cleanAdapterName
            )
        )
    }

    private fun writeProjectIndex(indexFile: File, conversations: List<HistoryConversationIndexEntry>) {
        indexFile.writeText(indexJson.encodeToString(conversations))
    }

    private fun readConversationData(file: File): ConversationReplayData? {
        if (!file.exists() || !file.isFile) return null
        return runCatching {
            indexJson.decodeFromString<ConversationReplayData>(file.readText())
        }.getOrNull()
    }

    private fun writeConversationData(file: File, data: ConversationReplayData) {
        file.writeText(indexJson.encodeToString(data))
    }

    private fun normalizeReplayBlocks(blocks: List<JsonObject>): List<JsonObject> {
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

    private fun normalizeReplayData(data: ConversationReplayData): ConversationReplayData {
        val normalizedSessions = data.sessions.map { session ->
            session.copy(prompts = session.prompts.map(::normalizeReplayPrompt))
        }
        return data.copy(sessions = normalizedSessions)
    }

    private fun latestConversationSourceSessionFile(projectPath: String, conversationId: String): File? {
        val currentWslDistributionName = currentWslDistributionName()
        val conversation = readExistingProjectIndex(projectPath)
            .firstOrNull { it.id == conversationId && matchesCurrentHistoryEnvironment(it, currentWslDistributionName) }
            ?: return null
        val latestSession = conversation.sessions.maxByOrNull { it.updatedAt } ?: return null
        val sourceFilePath = latestSession.sourceFilePath?.trim().orEmpty()
        if (sourceFilePath.isBlank()) return null
        val sourceFile = File(sourceFilePath)
        return sourceFile.takeIf { it.exists() && it.isFile }
    }

    private fun resolveFreshConversationReplayFile(projectPath: String, conversationId: String): File? {
        val replayFile = conversationDataFile(projectPath, conversationId)
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

    fun startBackgroundHistorySync(projectPath: String?) {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        if (cleanProjectPath.isBlank()) return
        backgroundScope.launch {
            syncProjectIndex(cleanProjectPath)
        }
    }

    private fun findSessionSourceMeta(projectPath: String, sessionId: String, adapterName: String): SessionMeta? {
        if (projectPath.isBlank() || sessionId.isBlank() || adapterName.isBlank()) return null
        return collectAvailableSessionMeta(projectPath)
            .firstOrNull { it.sessionId == sessionId && it.adapterName == adapterName }
    }

    fun upsertRuntimeSessionMetadata(
        projectPath: String?,
        conversationId: String,
        sessionId: String,
        adapterName: String,
        promptCount: Int,
        titleCandidate: String?,
        touchUpdatedAt: Boolean = false
    ): Boolean {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        val cleanConversationId = conversationId.trim()
        val cleanSessionId = sessionId.trim()
        val cleanAdapterName = adapterName.trim()
        if (cleanProjectPath.isBlank() || cleanConversationId.isBlank() || cleanSessionId.isBlank() || cleanAdapterName.isBlank()) return false

        val now = Instant.now().toEpochMilli()
        val normalizedTitle = titleCandidate?.trim().orEmpty()
        val currentWslDistributionName = currentWslDistributionName()
        val indexFile = ensureProjectIndexFile(cleanProjectPath)
        val conversations = readProjectIndex(indexFile).toMutableList()

        val sameConversationIndices = conversations.mapIndexedNotNull { index, conversation ->
            index.takeIf {
                conversation.id == cleanConversationId &&
                    ((conversation.wslDistributionName ?: "") == (currentWslDistributionName ?: ""))
            }
        }
        val insertIndex = sameConversationIndices.firstOrNull() ?: conversations.size

        var mergedConversation: HistoryConversationIndexEntry? = null
        sameConversationIndices.forEach { index ->
            val current = conversations[index]
            mergedConversation = if (mergedConversation == null) current else mergeIndexConversations(mergedConversation!!, current)
        }

        val existingSession = mergedConversation?.sessions?.firstOrNull { session ->
            session.sessionId == cleanSessionId && session.adapterName == cleanAdapterName
        }

                val sourceMeta = findSessionSourceMeta(cleanProjectPath, cleanSessionId, cleanAdapterName)
        val sourceFilePath = sourceMeta?.filePath?.takeIf { it.isNotBlank() }

        val updatedSessions = when {
            existingSession != null -> mergedConversation!!.sessions.map { session ->
                if (session.sessionId != cleanSessionId || session.adapterName != cleanAdapterName) return@map session
                session.copy(
                    updatedAt = if (touchUpdatedAt) now else session.updatedAt,
                    createdAt = if (session.createdAt > 0) session.createdAt else now,
                    sourceFilePath = sourceFilePath ?: session.sourceFilePath
                )
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

        val updatedConversation = HistoryConversationIndexEntry(
            id = cleanConversationId,
            title = when {
                mergedConversation?.title?.isNotBlank() == true -> mergedConversation!!.title
                normalizedTitle.isNotBlank() -> normalizedTitle
                else -> "Untitled Session"
            },
            promptCount = mergePromptCounts(mergedConversation?.promptCount, promptCount),
            transcriptPath = mergedConversation?.transcriptPath,
            sessions = updatedSessions,
            wslDistributionName = mergedConversation?.wslDistributionName ?: currentWslDistributionName
        )

        // Keep one canonical row per conversationId in index.json.
        sameConversationIndices.asReversed().forEach { index -> conversations.removeAt(index) }
        conversations.add(insertIndex.coerceAtMost(conversations.size), updatedConversation)
        writeProjectIndex(indexFile, conversations)
        return true
    }

    fun hasConversationReplay(projectPath: String?, conversationId: String?): Boolean {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        val cleanConversationId = conversationId?.trim().orEmpty()
        if (cleanProjectPath.isBlank() || cleanConversationId.isBlank()) return false
        if (readExistingProjectIndex(cleanProjectPath).none { it.id == cleanConversationId && matchesCurrentHistoryEnvironment(it) }) {
            return false
        }
        return resolveFreshConversationReplayFile(cleanProjectPath, cleanConversationId) != null
    }

    fun loadConversationReplay(projectPath: String?, conversationId: String?): ConversationReplayData? {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        val cleanConversationId = conversationId?.trim().orEmpty()
        if (cleanProjectPath.isBlank() || cleanConversationId.isBlank()) return null
        if (readExistingProjectIndex(cleanProjectPath).none { it.id == cleanConversationId && matchesCurrentHistoryEnvironment(it) }) {
            return null
        }
        val replayFile = resolveFreshConversationReplayFile(cleanProjectPath, cleanConversationId) ?: return null
        return readConversationData(replayFile)
    }

    fun saveConversationReplay(projectPath: String?, conversationId: String, data: ConversationReplayData): Boolean {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        val cleanConversationId = conversationId.trim()
        if (cleanProjectPath.isBlank() || cleanConversationId.isBlank()) return false
        val file = conversationDataFile(cleanProjectPath, cleanConversationId)
        writeConversationData(file, normalizeReplayData(data))
        return true
    }

    fun saveConversationTranscript(projectPath: String?, conversationId: String, transcriptText: String): String? {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        val cleanConversationId = conversationId.trim()
        val normalizedTranscript = transcriptText.trim()
        if (cleanProjectPath.isBlank() || cleanConversationId.isBlank() || normalizedTranscript.isBlank()) return null

        val transcriptFile = conversationTranscriptFile(cleanProjectPath, cleanConversationId)
        transcriptFile.writeText(normalizedTranscript)

        val currentWslDistributionName = currentWslDistributionName()
        val indexFile = ensureProjectIndexFile(cleanProjectPath)
        val conversations = readProjectIndex(indexFile).toMutableList()
        val sameConversationIndices = conversations.mapIndexedNotNull { index, conversation ->
            index.takeIf {
                conversation.id == cleanConversationId &&
                    ((conversation.wslDistributionName ?: "") == (currentWslDistributionName ?: ""))
            }
        }
        val insertIndex = sameConversationIndices.firstOrNull() ?: conversations.size

        var mergedConversation: HistoryConversationIndexEntry? = null
        sameConversationIndices.forEach { index ->
            val current = conversations[index]
            mergedConversation = if (mergedConversation == null) current else mergeIndexConversations(mergedConversation!!, current)
        }

        val updatedConversation = (mergedConversation ?: HistoryConversationIndexEntry(
            id = cleanConversationId,
            wslDistributionName = currentWslDistributionName()
        )).copy(
            transcriptPath = transcriptFile.absolutePath
        )

        sameConversationIndices.asReversed().forEach { index -> conversations.removeAt(index) }
        conversations.add(insertIndex.coerceAtMost(conversations.size), updatedConversation)
        writeProjectIndex(indexFile, conversations)
        return transcriptFile.absolutePath
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
        val cleanConversationId = conversationId.trim()
        val cleanSessionId = sessionId.trim()
        val cleanAdapterName = adapterName.trim()
        if (cleanProjectPath.isBlank()) return false
        if (cleanConversationId.isBlank() || cleanSessionId.isBlank() || cleanAdapterName.isBlank()) return false

        val file = conversationDataFile(cleanProjectPath, cleanConversationId)
        val current = readConversationData(file) ?: ConversationReplayData()
        val prompt = ConversationPromptReplayEntry(
            blocks = normalizeReplayBlocks(blocks),
            events = normalizeReplayBlocks(events),
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

        writeConversationData(file, current.copy(sessions = updatedSessions))
        return true
    }

    fun deleteConversationReplay(projectPath: String?, conversationId: String?): Boolean {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        val cleanConversationId = conversationId?.trim().orEmpty()
        if (cleanProjectPath.isBlank() || cleanConversationId.isBlank()) return false
        return deleteFileIfExists(conversationDataFile(cleanProjectPath, cleanConversationId))
    }

    private fun deleteConversationTranscript(projectPath: String, conversation: HistoryConversationIndexEntry): Boolean {
        val transcriptPath = conversation.transcriptPath?.takeIf { it.isNotBlank() }
        val transcriptFile = if (transcriptPath != null) File(transcriptPath) else conversationTranscriptFile(projectPath, conversation.id)
        return deleteFileIfExists(transcriptFile)
    }

    private fun mergeConversationReplayFiles(
        projectPath: String,
        sourceConversationId: String?,
        targetConversationId: String
    ) {
        val cleanSourceConversationId = sourceConversationId?.trim().orEmpty()
        val cleanTargetConversationId = targetConversationId.trim()
        if (cleanSourceConversationId.isBlank() || cleanTargetConversationId.isBlank()) return
        if (cleanSourceConversationId == cleanTargetConversationId) return

        val sourceFile = conversationDataFile(projectPath, cleanSourceConversationId)
        val targetFile = conversationDataFile(projectPath, cleanTargetConversationId)
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
        deleteFileIfExists(sourceFile)
    }

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

        val indexFile = ensureProjectIndexFile(cleanProjectPath)
        val existingConversations = readProjectIndex(indexFile).toMutableList()
        val conversationIndex = existingConversations.indexOfFirst { conversation ->
            conversation.sessions.any { session ->
                session.sessionId == cleanPreviousSessionId && session.adapterName == cleanPreviousAdapterName
            }
        }
        if (conversationIndex < 0) return false

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
        val sourceMeta = findSessionSourceMeta(cleanProjectPath, cleanSessionId, cleanAdapterName)
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
            writeProjectIndex(indexFile, conversations)
            return true
        }

        conversations[normalizedConversationIndex] = existingConversation.copy(
            title = existingConversation.title.ifBlank { titleCandidate?.trim().orEmpty() },
            promptCount = mergePromptCounts(existingConversation.promptCount, extractedPromptCount),
            sessions = existingConversation.sessions + newSession
        )
        writeProjectIndex(indexFile, conversations)
        mergeConversationReplayFiles(cleanProjectPath, extractedConversationId, existingConversation.id)
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
            promptCount = mergePromptCounts(left.promptCount, right.promptCount),
            transcriptPath = when {
                !left.transcriptPath.isNullOrBlank() -> left.transcriptPath
                !right.transcriptPath.isNullOrBlank() -> right.transcriptPath
                else -> null
            },
            sessions = mergedSessionsByKey.values.toList(),
            wslDistributionName = left.wslDistributionName ?: right.wslDistributionName
        )
    }

    private fun mergePromptCounts(current: Int?, incoming: Int?): Int? {
        return when {
            current == null -> incoming
            incoming == null -> current
            else -> maxOf(current, incoming)
        }
    }

    private fun updateSessionEntry(
        projectPath: String,
        sessionId: String,
        adapterName: String,
        transform: (HistorySessionIndexEntry) -> HistorySessionIndexEntry
    ): Boolean {
        if (projectPath.isBlank()) return false

        val indexFile = ensureProjectIndexFile(projectPath)
        val synced = readProjectIndex(indexFile)

        var updated = false
        val rewritten = synced.map { conversation ->
            val sessions = conversation.sessions.map { session ->
                if (session.sessionId == sessionId && session.adapterName == adapterName) {
                    updated = true
                    transform(session)
                } else {
                    session
                }
            }
            conversation.copy(sessions = sessions)
        }

        if (!updated) return false
        writeProjectIndex(indexFile, rewritten)
        return true
    }

    fun loadSessionChanges(projectPath: String, sessionId: String, adapterName: String): SessionChangesData? {
        if (projectPath.isBlank() || sessionId.isBlank() || adapterName.isBlank()) return null
        val indexFile = ensureProjectIndexFile(projectPath)
        val conversations = readProjectIndex(indexFile)
        val session = conversations.asSequence()
            .flatMap { it.sessions.asSequence() }
            .firstOrNull { it.sessionId == sessionId && it.adapterName == adapterName }
            ?: return null
        val changes = session.changes ?: return null
        return SessionChangesData(
            baseToolCallIndex = changes.baseToolCallIndex,
            processedFileStates = changes.processedFileStates,
            updatedAt = changes.updatedAt
        )
    }

    fun saveSessionChanges(
        projectPath: String,
        sessionId: String,
        adapterName: String,
        baseToolCallIndex: Int,
        processedFileStates: List<ProcessedFileState>
    ): Boolean {
        val updatedAt = Instant.now().toEpochMilli()
        return updateSessionEntry(projectPath, sessionId, adapterName) { session ->
            session.copy(
                changes = HistorySessionChangesEntry(
                    baseToolCallIndex = baseToolCallIndex,
                    processedFileStates = processedFileStates,
                    updatedAt = updatedAt
                )
            )
        }
    }

    fun deleteSessionChanges(projectPath: String, sessionId: String, adapterName: String): Boolean {
        return updateSessionEntry(projectPath, sessionId, adapterName) { session ->
            session.copy(changes = null)
        }
    }

    private fun conversationId(adapterName: String, sessionId: String): String {
        val wslDistributionName = currentWslDistributionName()
        val suffix = if (wslDistributionName.isNullOrBlank()) "" else ":wsl:$wslDistributionName"
        return "conv_" + historyHashMd5("$adapterName:$sessionId$suffix")
    }

    private fun deleteFileIfExists(file: File): Boolean {
        return deleteHistoryFileIfExists(file)
    }

    private fun deleteDirectoryIfExists(dir: File): Boolean {
        return deleteHistoryDirectoryIfExists(dir)
    }

    private fun deleteSessionArtifacts(projectPath: String, session: HistorySessionIndexEntry): Boolean {
        val sourceMeta = findSessionSourceMeta(projectPath, session.sessionId, session.adapterName)
        val sourceFilePath = session.sourceFilePath?.takeIf { it.isNotBlank() } ?: sourceMeta?.filePath.orEmpty()
        val history = AdapterHistoryRegistry.get(session.adapterName) ?: return false
        return history.deleteSession(projectPath, session.sessionId, sourceFilePath)
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

    private fun collectAvailableSessionMeta(projectPath: String): List<SessionMeta> {
        val result = mutableListOf<SessionMeta>()
        val ephemeralKeys = readEphemeralSessions(projectPath)
            .associateBy { "${it.adapterName}:${it.sessionId}" }

        AdapterHistoryRegistry.all().forEach { history ->
            if (!AcpAdapterPaths.isDownloaded(history.adapterId)) return@forEach
            result.addAll(runCatching { history.collectSessions(projectPath) }.getOrDefault(emptyList()))
        }

        return result
            .filterNot { meta ->
                val key = "${meta.adapterName}:${meta.sessionId}"
                if (ephemeralKeys[key] == null) return@filterNot false
                scheduleEphemeralSessionDeletion(projectPath, meta)
                true
            }
            .sortedByDescending { it.updatedAt }
            .distinctBy { "${it.adapterName}:${it.sessionId}" }
    }

    private fun scheduleEphemeralSessionDeletion(projectPath: String, session: SessionMeta) {
        val jobKey = historySyncKey(projectPath) + "||${session.adapterName}:${session.sessionId}"
        if (ephemeralDeletionJobs.putIfAbsent(jobKey, true) != null) return

        backgroundScope.launch {
            try {
                val history = AdapterHistoryRegistry.get(session.adapterName)
                val deleted = history?.deleteSession(
                    projectPath = projectPath,
                    sessionId = session.sessionId,
                    sourceFilePath = session.filePath.takeIf { it.isNotBlank() }
                ) == true
                if (deleted) {
                    removeEphemeralSession(projectPath, session.adapterName, session.sessionId)
                }
            } finally {
                ephemeralDeletionJobs.remove(jobKey)
            }
        }
    }

    private fun resolveSyncedUpdatedAt(currentUpdatedAt: Long, discoveredUpdatedAt: Long): Long {
        return when {
            currentUpdatedAt > 0L && discoveredUpdatedAt > 0L -> maxOf(currentUpdatedAt, discoveredUpdatedAt)
            currentUpdatedAt > 0L -> currentUpdatedAt
            else -> discoveredUpdatedAt
        }
    }

    private fun syncProjectIndex(projectPath: String): List<HistoryConversationIndexEntry> {
        if (projectPath.isBlank()) return emptyList()

        val indexFile = ensureProjectIndexFile(projectPath)
        val existing = readProjectIndex(indexFile)
        val currentWslDistributionName = currentWslDistributionName()
        val untouchedConversations = existing.filterNot { matchesCurrentHistoryEnvironment(it, currentWslDistributionName) }
        val targetConversations = existing.filter { matchesCurrentHistoryEnvironment(it, currentWslDistributionName) }
        val availableSessions = collectAvailableSessionMeta(projectPath)

        val availableByKey = availableSessions.associateBy { "${it.adapterName}:${it.sessionId}" }
        val keptKeys = linkedSetOf<String>()
        var changed = false

        val syncedExisting = targetConversations.mapNotNull { conversation ->
            val keptSessions = conversation.sessions.mapNotNull { session ->
                val key = "${session.adapterName}:${session.sessionId}"
                val meta = availableByKey[key] ?: return@mapNotNull null
                if (!keptKeys.add(key)) return@mapNotNull null
                val syncedSession = session.copy(
                    createdAt = if (session.createdAt > 0) minOf(session.createdAt, meta.createdAt) else meta.createdAt,
                    updatedAt = resolveSyncedUpdatedAt(session.updatedAt, meta.updatedAt),
                    sourceFilePath = meta.filePath.takeIf { it.isNotBlank() } ?: session.sourceFilePath
                )
                if (syncedSession != session) {
                    changed = true
                }
                syncedSession
            }

            if (keptSessions.isEmpty()) {
                changed = true
                deleteConversationReplay(projectPath, conversation.id)
                null
            } else {
                if (keptSessions.size != conversation.sessions.size) {
                    changed = true
                    val latestOriginalSession = conversation.sessions.maxByOrNull { it.updatedAt }
                    if (latestOriginalSession != null && keptSessions.none {
                        it.sessionId == latestOriginalSession.sessionId && it.adapterName == latestOriginalSession.adapterName
                    }) {
                        deleteConversationReplay(projectPath, conversation.id)
                    }
                }
                val syncedTitle = keptSessions.firstNotNullOfOrNull { session ->
                    val key = "${session.adapterName}:${session.sessionId}"
                    availableByKey[key]?.title?.takeIf { it.isNotBlank() }
                }
                val needsTitleUpdate = syncedTitle != null
                    && (conversation.title.isBlank() || conversation.title == "Untitled Session")
                    && syncedTitle != conversation.title
                val updatedConversation = if (needsTitleUpdate) {
                    changed = true
                    conversation.copy(title = syncedTitle, sessions = keptSessions)
                } else {
                    conversation.copy(sessions = keptSessions)
                }
                updatedConversation
            }
        }.toMutableList()

        val newConversations = availableSessions
            .filter { keptKeys.add("${it.adapterName}:${it.sessionId}") }
            .map { meta ->
                HistoryConversationIndexEntry(
                    id = conversationId(meta.adapterName, meta.sessionId),
                    title = meta.title,
                    sessions = listOf(
                        HistorySessionIndexEntry(
                            sessionId = meta.sessionId,
                            adapterName = meta.adapterName,
                            createdAt = meta.createdAt,
                            updatedAt = meta.updatedAt,
                            sourceFilePath = meta.filePath.takeIf { it.isNotBlank() },
                            changes = null
                        )
                    ),
                    wslDistributionName = currentWslDistributionName
                )
            }

        val combinedConversations = (untouchedConversations + syncedExisting + newConversations)
        syncedExisting.addAll(newConversations)
        if (newConversations.isNotEmpty()) {
            changed = true
        }
        if (changed || untouchedConversations.size != existing.size - targetConversations.size) {
            writeProjectIndex(indexFile, combinedConversations)
        }
        deleteOrphanedConversationFiles(projectPath, combinedConversations)
        return combinedConversations
    }

    private fun deleteOrphanedConversationFiles(
        projectPath: String,
        conversations: List<HistoryConversationIndexEntry>
    ) {
        val conversationsDir = projectConversationsDir(projectPath)
        if (!conversationsDir.exists() || !conversationsDir.isDirectory) return
        val referencedIds = conversations.mapTo(hashSetOf()) { it.id }
        conversationsDir.listFiles()?.forEach { file ->
            if (!file.isFile) return@forEach
            val name = file.name
            val conversationId = when {
                name.endsWith(".json") -> name.removeSuffix(".json")
                name.endsWith(".transcript.txt") -> name.removeSuffix(".transcript.txt")
                else -> return@forEach
            }
            if (conversationId !in referencedIds) {
                runCatching { file.delete() }
            }
        }
    }


    private fun buildHistoryList(
        projectPath: String,
        conversations: List<HistoryConversationIndexEntry>
    ): List<SessionMeta> {
        return conversations
            .filter { matchesCurrentHistoryEnvironment(it) }
            .mapNotNull { conversation ->
            val latestSession = conversation.sessions.maxByOrNull { it.updatedAt } ?: return@mapNotNull null
            SessionMeta(
                sessionId = latestSession.sessionId,
                adapterName = latestSession.adapterName,
                conversationId = conversation.id,
                sessionCount = conversation.sessions.size,
                promptCount = conversation.promptCount,
                projectPath = projectPath,
                title = conversation.title.ifBlank { "Untitled" },
                filePath = latestSession.sourceFilePath.orEmpty(),
                createdAt = latestSession.createdAt,
                updatedAt = latestSession.updatedAt,
                allAdapterNames = conversation.sessions.map { it.adapterName }.distinct()
            )
        }.sortedByDescending { it.updatedAt }
    }

    fun syncHistoryIndex(projectPath: String?): Boolean {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        if (cleanProjectPath.isBlank()) return false
        syncProjectIndex(cleanProjectPath)
        return true
    }

    suspend fun getHistoryList(projectPath: String?): List<SessionMeta> = withContext(Dispatchers.IO) {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        buildHistoryList(cleanProjectPath, readExistingProjectIndex(cleanProjectPath))
    }

    suspend fun syncAndGetHistoryList(projectPath: String?): List<SessionMeta> = withContext(Dispatchers.IO) {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        buildHistoryList(cleanProjectPath, syncProjectIndex(cleanProjectPath))
    }

    suspend fun getConversationSessions(projectPath: String?, conversationId: String?): List<SessionMeta> = withContext(Dispatchers.IO) {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        val cleanConversationId = conversationId?.trim().orEmpty()
        if (cleanProjectPath.isBlank() || cleanConversationId.isBlank()) return@withContext emptyList()

        val conversation = readExistingProjectIndex(cleanProjectPath)
            .firstOrNull { it.id == cleanConversationId && matchesCurrentHistoryEnvironment(it) }
            ?: return@withContext emptyList()

        val title = conversation.title.ifBlank { "Untitled" }
        val availableMetaByKey = collectAvailableSessionMeta(cleanProjectPath)
            .associateBy { "${it.adapterName}:${it.sessionId}" }

        conversation.sessions.map { session ->
            val sessionMeta = availableMetaByKey["${session.adapterName}:${session.sessionId}"]
            SessionMeta(
                sessionId = session.sessionId,
                adapterName = session.adapterName,
                conversationId = conversation.id,
                sessionCount = conversation.sessions.size,
                promptCount = conversation.promptCount,
                modelId = sessionMeta?.modelId,
                modeId = sessionMeta?.modeId,
                projectPath = cleanProjectPath,
                title = title,
                filePath = sessionMeta?.filePath?.takeIf { it.isNotBlank() } ?: session.sourceFilePath.orEmpty(),
                createdAt = sessionMeta?.createdAt ?: session.createdAt,
                updatedAt = resolveSyncedUpdatedAt(session.updatedAt, sessionMeta?.updatedAt ?: 0L),
                allAdapterNames = conversation.sessions.map { it.adapterName }.distinct()
            )
        }
    }

    suspend fun deleteConversations(projectPath: String?, conversationIds: List<String>): DeleteConversationsResult = withContext(Dispatchers.IO) {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        if (cleanProjectPath.isBlank()) return@withContext DeleteConversationsResult(success = false)
        if (conversationIds.isEmpty()) return@withContext DeleteConversationsResult(success = true)

        val indexFile = ensureProjectIndexFile(cleanProjectPath)
        val existing = readProjectIndex(indexFile)
        val targetIds = conversationIds.toSet()
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
                deleteConversationReplay(cleanProjectPath, conversation.id)
                deleteConversationTranscript(cleanProjectPath, conversation)
            }
        }

        writeProjectIndex(indexFile, kept)
        DeleteConversationsResult(
            success = failures.isEmpty(),
            failures = failures
        )
    }

    suspend fun deleteSessionImmediately(
        projectPath: String?,
        sessionId: String,
        adapterName: String,
        waitTimeoutMillis: Long = 5_000L,
        pollIntervalMillis: Long = 250L
    ): Boolean = withContext(Dispatchers.IO) {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        val cleanSessionId = sessionId.trim()
        val cleanAdapterName = adapterName.trim()
        if (cleanProjectPath.isBlank() || cleanSessionId.isBlank() || cleanAdapterName.isBlank()) {
            return@withContext false
        }

        val deadline = System.currentTimeMillis() + waitTimeoutMillis.coerceAtLeast(0L)
        var sourceMeta = findSessionSourceMeta(cleanProjectPath, cleanSessionId, cleanAdapterName)
        while (sourceMeta == null && System.currentTimeMillis() < deadline) {
            delay(pollIntervalMillis.coerceAtLeast(50L))
            sourceMeta = findSessionSourceMeta(cleanProjectPath, cleanSessionId, cleanAdapterName)
        }

        val sessionEntry = HistorySessionIndexEntry(
            sessionId = cleanSessionId,
            adapterName = cleanAdapterName,
            createdAt = sourceMeta?.createdAt ?: Instant.now().toEpochMilli(),
            updatedAt = sourceMeta?.updatedAt ?: Instant.now().toEpochMilli(),
            sourceFilePath = sourceMeta?.filePath?.takeIf { it.isNotBlank() },
            changes = null
        )

        val deletedArtifacts = if (sourceMeta != null || !sessionEntry.sourceFilePath.isNullOrBlank()) {
            deleteSessionArtifacts(cleanProjectPath, sessionEntry)
        } else {
            true
        }

        val indexFile = ensureProjectIndexFile(cleanProjectPath)
        val existing = readProjectIndex(indexFile)
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
                deleteConversationReplay(cleanProjectPath, conversation.id)
                deleteConversationTranscript(cleanProjectPath, conversation)
                null
            } else {
                conversation.copy(sessions = remainingSessions)
            }
        }

        if (indexChanged) {
            writeProjectIndex(indexFile, rewritten)
        }

        syncProjectIndex(cleanProjectPath)
        deletedArtifacts
    }

    suspend fun renameConversation(projectPath: String?, conversationId: String, newTitle: String): Boolean = withContext(Dispatchers.IO) {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        val cleanConversationId = conversationId.trim()
        val normalizedTitle = newTitle.trim()
        
        if (cleanProjectPath.isBlank() || cleanConversationId.isBlank() || normalizedTitle.isBlank()) return@withContext false

        val indexFile = ensureProjectIndexFile(cleanProjectPath)
        val existing = readProjectIndex(indexFile)
        var updated = false

        val rewritten = existing.map { conversation ->
            if (conversation.id == cleanConversationId) {
                updated = true
                conversation.copy(title = normalizedTitle)
            } else {
                conversation
            }
        }

        if (updated) {
            writeProjectIndex(indexFile, rewritten)
        }
        updated
    }
}
