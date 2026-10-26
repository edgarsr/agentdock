package agentdock.settings

import agentdock.bridge.BridgeHost
import com.intellij.openapi.project.ProjectManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import agentdock.acp.AcpQuotaService
import agentdock.utils.jsCallback
import agentdock.utils.jsStringLiteral

class SettingsBridge(
    private val host: BridgeHost,
    private val scope: CoroutineScope
) {
    private val settingsSaveMutex = Mutex()

    fun install() {
        host.register("loadGlobalSettings") {
            scope.launch(Dispatchers.IO) {
                // The defaults on a failure, as the UI waits for the settings before it shows anything.
                pushGlobalSettings(host, runCatching { GlobalSettingsStore.load() }.getOrDefault(GlobalSettings()))
            }
        }

        // The payload holds only the fields the page changes; older pages send all of them.
        host.register("saveGlobalSettings") { payload ->
            if (payload.isNotBlank()) {
                scope.launch(Dispatchers.IO) {
                    settingsSaveMutex.withLock {
                        val patch = runCatching { json.parseToJsonElement(payload).jsonObject }.getOrNull()
                        val saved = patch?.let(GlobalSettingsStore::update)
                        if (saved == null) {
                            // Nothing was saved, and the page gets the saved settings back in place of its change.
                            pushGlobalSettings(host, GlobalSettingsStore.load())
                            return@withLock
                        }
                        // Every project's UI gets them, so none keeps showing, or saving over, an older copy.
                        ProjectManager.getInstance().openProjects
                            .filterNot { it.isDisposed }
                            .forEach { project -> runCatching { pushGlobalSettings(BridgeHost.getInstance(project), saved) } }
                        AcpQuotaService.getInstance().onQuotaWidgetEnabledChanged(saved.quotaWidgetEnabled)
                    }
                }
            }
        }
    }

    private companion object {
        val json = Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
        }

        /** Sends the settings to React and refreshes the client-side native snapshot. */
        fun pushGlobalSettings(host: BridgeHost, settings: GlobalSettings) {
            val encoded = json.encodeToString(GlobalSettingsPayload(settings = settings))
            host.eval(jsCallback("__onGlobalSettings", "JSON.parse(${encoded.jsStringLiteral()})"))
            host.updateSettings(settings)
        }
    }
}
