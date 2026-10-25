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
data class StartRecordingRequest(
    val ownerId: String,
    val recordingLimitSeconds: Int
)

@Serializable
data class StopRecordingRequest(
    val requestId: String,
    val ownerId: String = "",
    /** The base64 WAV a web browser page recorded itself; empty when the IDE records. */
    val audio: String = ""
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
    /** Null is accepted from older settings and normalized to the default. */
    val recordingLimitSeconds: Int? = 120,
    val providers: Map<String, AudioTranscriptionProviderSettings> = emptyMap()
)

object AudioOutputProviders {
    const val SYSTEM = "system"
    const val GPT_SPEECH = "gpt-speech"
    const val GEMINI_SPEECH = "gemini-speech"
}

@Serializable
data class AudioOutputProviderSettings(
    val apiKey: String = "",
    val voice: String = ""
)

@Serializable
data class AudioOutputSettings(
    val provider: String = AudioOutputProviders.SYSTEM,
    val providers: Map<String, AudioOutputProviderSettings> = emptyMap()
)

@Serializable
data class SpeechRequest(
    val requestId: String,
    val chunks: List<String> = emptyList()
)

@Serializable
data class SpeechResultPayload(
    val requestId: String,
    val error: String? = null
)

@Serializable
data class GitCommitGenerationSettings(
    val enabled: Boolean = false,
    val adapterId: String = "",
    val modelId: String = "",
    val reasoningEffortId: String = "",
    val instructions: String = ""
)

/** Ctrl/Cmd shortcuts that override the IDE ones while the plugin has focus; an empty letter leaves the IDE one. */
@Serializable
data class ShortcutSettings(
    val search: String = "F",
    val newChat: String = "",
    val closeChat: String = "",
    val history: String = "H",
    val manage: String = "",
    val focusInput: String = "",
    val cancelPrompt: String = "",
    /** Ctrl/Cmd+1…9 open the chats in the order they are listed. */
    val tabNumbers: Boolean = false
) {
    val letters: List<String> get() = listOf(search, newChat, closeChat, history, manage, focusInput, cancelPrompt)
}

@Serializable
data class GlobalSettings(
    val audioNotificationsEnabled: Boolean = true,
    val uiZoomPercent: Int = 100,
    val contentMaxWidthPx: Int = 760,
    val userMessageBackgroundStyle: String = "default",
    val userMessageCustomColor: String = "#193d70",
    val audioTranscription: AudioTranscriptionSettings = AudioTranscriptionSettings(),
    val audioOutput: AudioOutputSettings = AudioOutputSettings(),
    val gitCommitGeneration: GitCommitGenerationSettings = GitCommitGenerationSettings(),
    val systemInstructionsEnabled: Boolean = false,
    val quotaWidgetEnabled: Boolean = false,
    val openInEditor: Boolean = true,
    /** The web server showing the UI in a web browser, and "Open in browser". */
    val browserAccessEnabled: Boolean = true,
    /** Tried first; one in use gives way to a free one. */
    val browserAccessPort: Int = 47823,
    /** At least 4 letters, digits, `-` and `_`. `null` until the backend generates one. */
    val browserAccessCode: String? = null,
    val promptNavigationHoverOnly: Boolean = true,
    val userMessageDetailsHoverOnly: Boolean = false,
    val sidebarPosition: String = "left",
    /** The history groups are listed under "Chat History" in the section popup. */
    val historyGroupsExpanded: Boolean = false,
    /** Switching the mode restores the model last used in it, and switching the model restores its last effort. */
    val rememberModelAndEffort: Boolean = false,
    /** The approval mode new chats start in: "ask" or "auto". */
    val approvalMode: String = "ask",
    /** "enter" or "ctrl-enter". */
    val sendMode: String = "enter",
    val shortcuts: ShortcutSettings = ShortcutSettings()
)

@Serializable
data class GlobalSettingsPayload(
    val settings: GlobalSettings = GlobalSettings()
)
