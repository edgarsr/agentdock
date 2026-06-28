package agentdock.settings

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import agentdock.acp.AcpAdapterPaths
import agentdock.gitcommit.GitCommitFeatureRuntimeState
import agentdock.utils.atomicWriteText
import java.io.File
import java.io.RandomAccessFile

object GlobalSettingsStore {
    private val storeLock = Any()

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

        val loaded = runCatching {
            json.decodeFromString<GlobalSettings>(file.readText())
        }.getOrDefault(GlobalSettings())
        GitCommitFeatureRuntimeState.setEnabled(loaded.gitCommitGeneration.enabled)
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
        return withStoreLock {
            val current = loadLocked()
            saveLocked(
                current.copy(
                    audioTranscription = current.audioTranscription.copy(
                        language = normalizeLanguage(settings.language)
                    )
                )
            ).audioTranscription
        }
    }

    private fun loadLocked(): GlobalSettings {
        val file = settingsFile()
        if (!file.isFile) {
            return saveLocked(GlobalSettings())
        }

        val loaded = runCatching {
            json.decodeFromString<GlobalSettings>(file.readText())
        }.getOrDefault(GlobalSettings())
        GitCommitFeatureRuntimeState.setEnabled(loaded.gitCommitGeneration.enabled)
        return loaded
    }

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
