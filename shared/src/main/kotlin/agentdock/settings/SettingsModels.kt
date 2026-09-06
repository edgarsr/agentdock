package agentdock.settings

import kotlinx.serialization.Serializable

@Serializable
data class AudioTranscriptionFeatureState(
    val id: String,
    val title: String,
    val installed: Boolean,
    val installing: Boolean,
    val supported: Boolean,
    val installable: Boolean = false,
    val installPath: String = ""
)

object AudioTranscriptionProviders {
    const val NONE = "none"
    const val GPT_TRANSCRIBER = "gpt-transcriber"
    const val GEMINI_TRANSCRIBER = "gemini-transcriber"
    const val WHISPER = "whisper-transcription"
}

@Serializable
data class AudioTranscriptionProviderSettings(
    val apiKey: String = ""
)

@Serializable
data class AudioTranscriptionResultPayload(
    val requestId: String,
    val success: Boolean,
    val text: String? = null,
    val error: String? = null,
    val cancelled: Boolean = false
)

@Serializable
data class StopRecordingRequest(
    val requestId: String,
    val ownerId: String = ""
)

@Serializable
data class AudioRecordingStatePayload(
    val recording: Boolean,
    val error: String? = null,
    val ownerId: String? = null
)

@Serializable
data class AudioTranscriptionSettings(
    val provider: String = AudioTranscriptionProviders.NONE,
    val language: String = "auto",
    val providers: Map<String, AudioTranscriptionProviderSettings> = emptyMap()
)

@Serializable
data class GitCommitGenerationSettings(
    val enabled: Boolean = false,
    val adapterId: String = "",
    val modelId: String = "",
    val reasoningEffortId: String = "",
    val instructions: String = ""
)

@Serializable
data class GlobalSettings(
    val audioNotificationsEnabled: Boolean = true,
    val uiFontSizeOffsetPx: Int = 0,
    val userMessageBackgroundStyle: String = "default",
    val audioTranscription: AudioTranscriptionSettings = AudioTranscriptionSettings(),
    val gitCommitGeneration: GitCommitGenerationSettings = GitCommitGenerationSettings(),
    val quotaWidgetEnabled: Boolean = false
)

@Serializable
data class GlobalSettingsPayload(
    val settings: GlobalSettings = GlobalSettings()
)
