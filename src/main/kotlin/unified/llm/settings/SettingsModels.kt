package unified.llm.settings

import kotlinx.serialization.Serializable

@Serializable
data class AudioTranscriptionFeatureState(
    val id: String,
    val title: String,
    val installed: Boolean,
    val installing: Boolean,
    val supported: Boolean,
    val status: String,
    val detail: String = "",
    val installPath: String = ""
)

@Serializable
data class AudioTranscriptionRequest(
    val requestId: String,
    val audioBase64: String
)

@Serializable
data class AudioTranscriptionResultPayload(
    val requestId: String,
    val success: Boolean,
    val text: String? = null,
    val error: String? = null
)

@Serializable
data class StopRecordingRequest(
    val requestId: String
)

@Serializable
data class AudioRecordingStatePayload(
    val recording: Boolean,
    val error: String? = null
)

@Serializable
data class AudioTranscriptionSettings(
    val language: String = "auto"
)

@Serializable
data class GlobalSettings(
    val audioTranscription: AudioTranscriptionSettings = AudioTranscriptionSettings()
)
