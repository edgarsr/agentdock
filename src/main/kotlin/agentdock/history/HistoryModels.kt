package agentdock.history

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import java.time.Instant

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
internal data class HistorySessionChangesEntry(
    val baseToolCallIndex: Int = 0,
    val processedFileStates: List<ProcessedFileState> = emptyList(),
    val updatedAt: Long = Instant.now().toEpochMilli()
)

@Serializable
internal data class HistorySessionIndexEntry(
    val sessionId: String,
    val adapterName: String,
    val createdAt: Long,
    val updatedAt: Long,
    val sourceFilePath: String? = null,
    val changes: HistorySessionChangesEntry? = null
)

@Serializable
internal data class HistoryConversationIndexEntry(
    val id: String,
    val title: String = "",
    val promptCount: Int? = null,
    val transcriptPath: String? = null,
    val sessions: List<HistorySessionIndexEntry> = emptyList()
)

@Serializable
internal data class EphemeralSessionEntry(
    val sessionId: String,
    val adapterName: String,
    val createdAt: Long = Instant.now().toEpochMilli()
)

internal data class AvailableSessionMetaResult(
    val sessions: List<SessionMeta>,
    val scannedAdapters: Set<String>
)
