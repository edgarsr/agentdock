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
data class GitCommitGenerationSettings(
    val enabled: Boolean = false,
    val adapterId: String = "",
    val modelId: String = "",
    val instructions: String = ""
)

@Serializable
data class GlobalSettings(
    val useWslForAcpAdapters: Boolean = false,
    val wslDistributionName: String = "",
    val audioNotificationsEnabled: Boolean = true,
    val uiFontSizeOffsetPx: Int = 0,
    val userMessageBackgroundStyle: String = "accent",
    val audioTranscription: AudioTranscriptionSettings = AudioTranscriptionSettings(),
    val gitCommitGeneration: GitCommitGenerationSettings = GitCommitGenerationSettings()
)

@Serializable
data class WslDistributionInfo(
    val name: String
)

@Serializable
data class HostSettingsInfo(
    val hostOs: String,
    val wslSupported: Boolean,
    val wslDistributions: List<WslDistributionInfo>
) {
    companion object {
        fun resolve(): HostSettingsInfo {
            val isWindows = unified.llm.acp.AcpExecutionMode.isWindowsHost()
            return HostSettingsInfo(
                hostOs = if (isWindows) "windows" else "other",
                wslSupported = if (isWindows) unified.llm.acp.AcpExecutionMode.isWslSupportedHost() else false,
                wslDistributions = if (isWindows) unified.llm.acp.AcpExecutionMode.listWslDistributions()
                    .map { WslDistributionInfo(it) } else emptyList()
            )
        }
    }
}

@Serializable
data class GlobalSettingsPayload(
    val settings: GlobalSettings = GlobalSettings(),
    val host: HostSettingsInfo
)

@Serializable
data class ExecutionTargetSwitchPayload(
    val executionTarget: String
)
