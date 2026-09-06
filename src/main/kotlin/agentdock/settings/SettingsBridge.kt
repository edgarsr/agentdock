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

    /** Sends the settings to React and refreshes the client-side native snapshot. */
    private fun pushGlobalSettings(settings: GlobalSettings) {
        val encoded = json.encodeToString(GlobalSettingsPayload(settings = settings))
        host.eval("if(window.__onGlobalSettings) window.__onGlobalSettings(JSON.parse(${encoded.jsStringLiteral()}));")
        host.updateSettings(settings)
    }
}
