package agentdock.settings

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import agentdock.acp.AcpAdapterPaths
import agentdock.utils.atomicWriteText
import java.io.File
import java.io.RandomAccessFile
import java.security.SecureRandom
import java.util.Base64

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
        // Saved at once, so every load gives the same generated code; an empty one from earlier versions is replaced.
        if (validAccessCode(loaded.browserAccessCode) == null) saveLocked(loaded) else loaded
    }

    fun save(settings: GlobalSettings): GlobalSettings = withStoreLock {
        saveLocked(settings)
    }

    private fun saveLocked(settings: GlobalSettings): GlobalSettings {
        val normalized = settings.copy(
            contentMaxWidthPx = settings.contentMaxWidthPx.takeIf { it == 0 || it >= 400 } ?: 760,
            userMessageBackgroundStyle = normalizeUserMessageBackgroundStyle(settings.userMessageBackgroundStyle),
            userMessageCustomColor = settings.userMessageCustomColor.takeIf { Regex("#[0-9a-fA-F]{6}").matches(it) } ?: "#193d70",
            sidebarPosition = normalizeSidebarPosition(settings.sidebarPosition),
            approvalMode = if (settings.approvalMode == "auto") "auto" else "ask",
            sendMode = if (settings.sendMode == "ctrl-enter") "ctrl-enter" else "enter",
            browserAccessPort = settings.browserAccessPort.takeIf { it in 1..65535 } ?: 47823,
            // An invalid code keeps the saved one.
            browserAccessCode = validAccessCode(settings.browserAccessCode)
                ?: validAccessCode(settingsFile().takeIf { it.isFile }?.let(::decodeSettings)?.browserAccessCode)
                ?: Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(12).also(SecureRandom()::nextBytes)),
            shortcuts = normalizeShortcuts(settings.shortcuts),
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

    /** At least 4 letters, digits, `-` or `_`, which are safe in an address and a cookie as they are. */
    private fun validAccessCode(code: String?): String? =
        code?.takeIf { it.length >= 4 && it.all { c -> c in 'a'..'z' || c in 'A'..'Z' || c in '0'..'9' || c in "-_" } }

    fun isGitCommitGenerationEnabled(): Boolean = gitCommitGenerationEnabled

    fun isSystemInstructionsEnabled(): Boolean = load().systemInstructionsEnabled

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
            recordingLimitSeconds = settings.recordingLimitSeconds?.takeIf { it > 0 }?.coerceAtMost(600) ?: 120,
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

    private fun normalizeUserMessageBackgroundStyle(style: String?): String {
        return when (style?.trim()?.lowercase()) {
            "default", "blue-highlight", "blue", "background-secondary", "accent", "custom" -> style.trim().lowercase()
            else -> "default"
        }
    }

    private fun normalizeSidebarPosition(position: String?): String =
        if (position?.trim()?.lowercase() == "right") "right" else "left"

    // One letter each, not a text editing one and not taken by an earlier action.
    private fun normalizeShortcuts(shortcuts: ShortcutSettings): ShortcutSettings {
        val used = mutableSetOf<String>()
        fun letter(value: String) = value.trim().uppercase()
            .takeIf { it.length == 1 && it[0] in 'A'..'Z' && it !in "ACVXYZ" && used.add(it) }
            .orEmpty()
        return shortcuts.copy(
            search = letter(shortcuts.search),
            newChat = letter(shortcuts.newChat),
            closeChat = letter(shortcuts.closeChat),
            history = letter(shortcuts.history),
            manage = letter(shortcuts.manage),
            focusInput = letter(shortcuts.focusInput),
            cancelPrompt = letter(shortcuts.cancelPrompt)
        )
    }
}
