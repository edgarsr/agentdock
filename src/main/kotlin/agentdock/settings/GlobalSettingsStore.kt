package agentdock.settings

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import agentdock.acp.AcpAdapterPaths
import agentdock.utils.atomicWriteText
import java.io.File
import java.io.RandomAccessFile

object GlobalSettingsStore {
    private val storeLock = Any()

    @Volatile
    private var gitCommitGenerationEnabled = false

    private val json = Json {
        ignoreUnknownKeys = true
        prettyPrint = true
        encodeDefaults = true
    }

    private fun settingsFile(): File = File(AcpAdapterPaths.getBaseRuntimeDir(), "settings.json")

    fun load(): GlobalSettings = withStoreLock {
        val file = settingsFile()
        if (!file.isFile) {
            return@withStoreLock saveLocked(GlobalSettings())
        }

        val loaded = decodeSettings(file)
        gitCommitGenerationEnabled = loaded.gitCommitGeneration.enabled
        loaded
    }

    fun save(settings: GlobalSettings): GlobalSettings = withStoreLock {
        saveLocked(settings)
    }

    private fun saveLocked(settings: GlobalSettings): GlobalSettings {
        val normalized = settings.copy(
            audioNotificationsEnabled = settings.audioNotificationsEnabled,
            uiFontSizeOffsetPx = normalizeUiFontSizeOffsetPx(settings.uiFontSizeOffsetPx),
            userMessageBackgroundStyle = normalizeUserMessageBackgroundStyle(settings.userMessageBackgroundStyle),
            audioTranscription = normalizeAudioTranscriptionSettings(settings.audioTranscription),
            gitCommitGeneration = settings.gitCommitGeneration.copy(
                adapterId = settings.gitCommitGeneration.adapterId.trim(),
                modelId = settings.gitCommitGeneration.modelId.trim(),
                reasoningEffortId = settings.gitCommitGeneration.reasoningEffortId.trim(),
                instructions = settings.gitCommitGeneration.instructions.trim()
            )
        )
        val file = settingsFile()
        file.parentFile?.mkdirs()
        file.atomicWriteText(json.encodeToString(normalized))
        gitCommitGenerationEnabled = normalized.gitCommitGeneration.enabled
        return normalized
    }

    fun isGitCommitGenerationEnabled(): Boolean = gitCommitGenerationEnabled

    fun areAudioNotificationsEnabled(): Boolean = load().audioNotificationsEnabled

    fun uiFontSizeOffsetPx(): Int = normalizeUiFontSizeOffsetPx(load().uiFontSizeOffsetPx)

    fun userMessageBackgroundStyle(): String = normalizeUserMessageBackgroundStyle(load().userMessageBackgroundStyle)

    private inline fun <T> withStoreLock(action: () -> T): T = synchronized(storeLock) {
        val lockFile = File(AcpAdapterPaths.getBaseRuntimeDir(), "settings.lock")
        lockFile.parentFile?.mkdirs()
        RandomAccessFile(lockFile, "rw").use { raf ->
            raf.channel.use { channel ->
                channel.lock().use {
                    action()
                }
            }
        }
    }

    private fun normalizeLanguage(language: String?): String {
        return language?.trim()?.lowercase()?.takeIf { it.isNotEmpty() } ?: "auto"
    }

    private fun normalizeProvider(provider: String?): String {
        return provider?.trim()?.lowercase()
            ?.takeIf(String::isNotEmpty)
            ?: AudioTranscriptionProviders.NONE
    }

    private fun normalizeApiKey(apiKey: String?): String = apiKey?.trim().orEmpty()

    private fun normalizeAudioTranscriptionSettings(settings: AudioTranscriptionSettings): AudioTranscriptionSettings =
        settings.copy(
            provider = normalizeProvider(settings.provider),
            language = normalizeLanguage(settings.language),
            providers = settings.providers.mapValues { (_, provider) ->
                provider.copy(apiKey = normalizeApiKey(provider.apiKey))
            }
        )

    private fun decodeSettings(file: File): GlobalSettings {
        return runCatching {
            val root = json.parseToJsonElement(file.readText())
            val loaded = json.decodeFromJsonElement<GlobalSettings>(root)
            val legacyApiKey = root.jsonObject["audioTranscription"]
                ?.jsonObject
                ?.get("apiKey")
                ?.jsonPrimitive
                ?.contentOrNull
                ?.trim()
                .orEmpty()
            if (legacyApiKey.isNotEmpty() && loaded.audioTranscription.providers[AudioTranscriptionProviders.GPT_TRANSCRIBER]
                    ?.apiKey.orEmpty().isBlank()
            ) {
                loaded.copy(
                    audioTranscription = loaded.audioTranscription.copy(
                        providers = loaded.audioTranscription.providers + (
                            AudioTranscriptionProviders.GPT_TRANSCRIBER to
                                AudioTranscriptionProviderSettings(apiKey = legacyApiKey)
                            )
                    )
                )
            } else {
                loaded
            }
        }.getOrDefault(GlobalSettings())
    }

    private fun normalizeUiFontSizeOffsetPx(offset: Int?): Int {
        return (offset ?: 0).coerceIn(-3, 3)
    }

    private fun normalizeUserMessageBackgroundStyle(style: String?): String {
        return when (style?.trim()?.lowercase()) {
            "default", "blue", "background-secondary", "primary", "secondary", "accent", "input", "editor-bg" -> style.trim().lowercase()
            else -> "default"
        }
    }
}
