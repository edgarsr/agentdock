package agentdock.settings

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import agentdock.acp.AcpAdapterPaths
import agentdock.gitcommit.GitCommitFeatureRuntimeState
import agentdock.utils.atomicWriteText
import java.io.File

object GlobalSettingsStore {
    private val json = Json {
        ignoreUnknownKeys = true
        prettyPrint = true
        encodeDefaults = true
    }

    private fun settingsFile(): File = File(AcpAdapterPaths.getBaseRuntimeDir(), "settings.json")

    fun load(): GlobalSettings {
        val file = settingsFile()
        if (!file.isFile) {
            return save(GlobalSettings())
        }

        val loaded = runCatching {
            json.decodeFromString<GlobalSettings>(file.readText())
        }.getOrDefault(GlobalSettings())
        GitCommitFeatureRuntimeState.setEnabled(loaded.gitCommitGeneration.enabled)
        return loaded
    }

    fun save(settings: GlobalSettings): GlobalSettings {
        val normalized = settings.copy(
            audioNotificationsEnabled = settings.audioNotificationsEnabled,
            uiFontSizeOffsetPx = normalizeUiFontSizeOffsetPx(settings.uiFontSizeOffsetPx),
            userMessageBackgroundStyle = normalizeUserMessageBackgroundStyle(settings.userMessageBackgroundStyle),
            audioTranscription = settings.audioTranscription.copy(
                language = normalizeLanguage(settings.audioTranscription.language)
            ),
            gitCommitGeneration = settings.gitCommitGeneration.copy(
                adapterId = settings.gitCommitGeneration.adapterId.trim(),
                modelId = settings.gitCommitGeneration.modelId.trim(),
                instructions = settings.gitCommitGeneration.instructions.trim()
            )
        )
        val file = settingsFile()
        file.parentFile?.mkdirs()
        file.atomicWriteText(json.encodeToString(normalized))
        GitCommitFeatureRuntimeState.setEnabled(normalized.gitCommitGeneration.enabled)
        return normalized
    }

    fun areAudioNotificationsEnabled(): Boolean = load().audioNotificationsEnabled

    fun uiFontSizeOffsetPx(): Int = normalizeUiFontSizeOffsetPx(load().uiFontSizeOffsetPx)

    fun userMessageBackgroundStyle(): String = normalizeUserMessageBackgroundStyle(load().userMessageBackgroundStyle)

    fun loadAudioTranscriptionSettings(): AudioTranscriptionSettings {
        val settings = load().audioTranscription
        return settings.copy(language = normalizeLanguage(settings.language))
    }

    fun saveAudioTranscriptionSettings(settings: AudioTranscriptionSettings): AudioTranscriptionSettings {
        val current = load()
        return save(
            current.copy(
                audioTranscription = current.audioTranscription.copy(
                    language = normalizeLanguage(settings.language)
                )
            )
        ).audioTranscription
    }

    private fun normalizeLanguage(language: String?): String {
        return language?.trim()?.lowercase()?.takeIf { it.isNotEmpty() } ?: "auto"
    }

    private fun normalizeUiFontSizeOffsetPx(offset: Int?): Int {
        return (offset ?: 0).coerceIn(-3, 3)
    }

    private fun normalizeUserMessageBackgroundStyle(style: String?): String {
        return when (style?.trim()?.lowercase()) {
            "default", "background-secondary", "primary", "secondary", "accent", "input", "editor-bg" -> style.trim().lowercase()
            else -> "default"
        }
    }
}
