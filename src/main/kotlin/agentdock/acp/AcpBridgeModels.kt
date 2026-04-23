package agentdock.acp

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import agentdock.history.ConversationAssistantMetadata

@Serializable
internal data class AdapterModelPayload(
    val modelId: String,
    val name: String,
    val description: String
)

@Serializable
internal data class AdapterModePayload(
    val id: String,
    val name: String,
    val description: String
)

@Serializable
internal data class AdapterPayload(
    val id: String,
    val name: String,
    val iconPath: String,
    val isLastUsed: Boolean = false,
    val currentModelId: String,
    val availableModels: List<AdapterModelPayload>,
    val currentModeId: String,
    val availableModes: List<AdapterModePayload>,
    val downloaded: Boolean? = null,
    val downloadedKnown: Boolean = false,
    val downloadPath: String = "",
    val hasAuthentication: Boolean,
    val authAuthenticated: Boolean? = null,
    val authKnown: Boolean = false,
    val authLoading: Boolean,
    val authError: String,
    val authenticating: Boolean,
    val authUiMode: String,
    val initializing: Boolean,
    val initializationDetail: String,
    val initializationError: String,
    val ready: Boolean? = null,
    val readyKnown: Boolean = false,
    val installedVersion: String? = null,
    val latestVersion: String? = null,
    val updateSupported: Boolean = false,
    val updateChecking: Boolean = false,
    val updateKnown: Boolean = false,
    val updateAvailable: Boolean = false,
    val downloading: Boolean,
    val downloadStatus: String,
    val disabledModels: List<String>,
    val cliAvailable: Boolean
)

@Serializable
internal data class SaveConversationTranscriptPayload(
    val requestId: String,
    val conversationId: String,
    val text: String
)

@Serializable
internal data class AvailableCommandPayload(
    val name: String,
    val description: String,
    val inputHint: String? = null
)

@Serializable
internal data class SaveConversationTranscriptResultPayload(
    val requestId: String,
    val conversationId: String,
    val success: Boolean,
    val filePath: String? = null,
    val error: String? = null
)

@Serializable
internal data class FileChangeOperationPayload(
    val oldText: String,
    val newText: String
)

@Serializable
internal data class FileChangeStatsRequestFilePayload(
    val filePath: String,
    val status: String,
    val operations: List<FileChangeOperationPayload>
)

@Serializable
internal data class FileChangeStatsRequestPayload(
    val requestId: String,
    val files: List<FileChangeStatsRequestFilePayload>
)

@Serializable
internal data class FileChangeStatsPayload(
    val filePath: String,
    val additions: Int,
    val deletions: Int
)

@Serializable
internal data class FileChangeStatsResultPayload(
    val requestId: String,
    val files: List<FileChangeStatsPayload>
)

internal val adapterJson = Json { encodeDefaults = true }

internal data class AdapterDownloadProbeState(
    val downloaded: Boolean? = null,
    val downloadedKnown: Boolean = false,
    val installedVersion: String? = null
)

internal data class LivePromptCapture(
    val captureId: String,
    val projectPath: String,
    val conversationId: String,
    val sessionId: String,
    val adapterName: String,
    val blocks: List<JsonObject>,
    val startedAtMillis: Long,
    val assistantMeta: ConversationAssistantMetadata?,
    @Volatile var closed: Boolean = false,
    var hasVisibleAssistantOutput: Boolean = false,
    var contextTokensUsed: Long? = null,
    var contextWindowSize: Long? = null,
    val events: MutableList<JsonObject> = mutableListOf()
)

internal data class ReplaySessionCapture(
    val sessionId: String,
    val adapterName: String,
    val prompts: MutableList<ReplayPromptCapture> = mutableListOf()
)

internal data class ReplayPromptCapture(
    val blocks: MutableList<JsonObject> = mutableListOf(),
    val events: MutableList<JsonObject> = mutableListOf(),
    var assistantMeta: ConversationAssistantMetadata? = null
)

internal data class HistoryReplayCapture(
    val projectPath: String,
    val conversationId: String,
    var currentSessionId: String? = null,
    var currentAdapterName: String? = null,
    var currentModelId: String? = null,
    var currentModeId: String? = null,
    val sessions: MutableList<ReplaySessionCapture> = mutableListOf()
)

@Serializable
internal data class FileSearchItem(val path: String, val name: String)
