package agentdock.settings

import agentdock.bridge.BridgeHost
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import agentdock.acp.AcpQuotaService
import agentdock.utils.jsStringLiteral

/**
 * Owns the settings file. The dictation half of the old bridge moved to the frontend module,
 * because the microphone and the speech model live on the user's machine, not next to the project.
 */
class SettingsBridge(
    private val host: BridgeHost,
    private val scope: CoroutineScope
) {
    private val settingsSaveMutex = Mutex()
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    fun install() {
        host.register("loadAudioTranscriptionSettings") {
            scope.launch(Dispatchers.IO) {
                pushTranscriptionSettings(GlobalSettingsStore.loadAudioTranscriptionSettings())
            }
        }

        host.register("saveAudioTranscriptionSettings") { payload ->
            if (payload.isNotBlank()) {
                scope.launch(Dispatchers.IO) {
                    val settings = runCatching {
                        json.decodeFromString<AudioTranscriptionSettings>(payload)
                    }.getOrDefault(AudioTranscriptionSettings())
                    pushTranscriptionSettings(GlobalSettingsStore.saveAudioTranscriptionSettings(settings))
                }
            }
        }

        host.register("loadGlobalSettings") {
            scope.launch(Dispatchers.IO) {
                pushGlobalSettings(GlobalSettingsStore.load())
            }
        }

        host.register("saveGlobalSettings") { payload ->
            if (payload.isNotBlank()) {
                scope.launch(Dispatchers.IO) {
                    settingsSaveMutex.withLock {
                        val requested = runCatching {
                            json.decodeFromString<GlobalSettings>(payload)
                        }.getOrDefault(GlobalSettings())
                        val saved = GlobalSettingsStore.save(requested)
                        pushGlobalSettings(saved)
                        AcpQuotaService.getInstance().onQuotaWidgetEnabledChanged(saved.quotaWidgetEnabled)
                    }
                }
            }
        }
    }

    /** Sends the settings once for the React UI and once for the client-side native consumers. */
    private fun pushGlobalSettings(settings: GlobalSettings) {
        val encoded = json.encodeToString(GlobalSettingsPayload(settings = settings))
        host.eval("if(window.__onGlobalSettings) window.__onGlobalSettings(JSON.parse(${encoded.jsStringLiteral()}));")
        host.updateSettings(settings)
    }

    private fun pushTranscriptionSettings(settings: AudioTranscriptionSettings) {
        val payload = json.encodeToString(settings).jsStringLiteral()
        host.eval("if(window.__onAudioTranscriptionSettings) window.__onAudioTranscriptionSettings(JSON.parse($payload));")
    }
}
