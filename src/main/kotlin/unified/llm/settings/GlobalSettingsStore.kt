package unified.llm.settings

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import unified.llm.acp.AcpAdapterPaths
import java.io.File

object GlobalSettingsStore {
    private val json = Json {
        ignoreUnknownKeys = true
        prettyPrint = true
    }

    private fun settingsFile(): File = File(AcpAdapterPaths.getBaseRuntimeDir(), "settings.json")

    fun load(): GlobalSettings {
        val file = settingsFile()
        if (!file.isFile) {
            return GlobalSettings()
        }

        return runCatching {
            json.decodeFromString<GlobalSettings>(file.readText())
        }.getOrDefault(GlobalSettings())
    }

    fun save(settings: GlobalSettings): GlobalSettings {
        val normalized = settings.copy(
            audioTranscription = settings.audioTranscription.copy(
                language = normalizeLanguage(settings.audioTranscription.language)
            )
        )
        val file = settingsFile()
        file.parentFile?.mkdirs()
        file.writeText(json.encodeToString(normalized))
        return normalized
    }

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
}
