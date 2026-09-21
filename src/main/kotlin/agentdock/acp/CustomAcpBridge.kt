package agentdock.acp

import agentdock.bridge.BridgeHost
import agentdock.utils.jsStringLiteral
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

private val customAcpJson = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
}

class CustomAcpBridge(
    private val host: BridgeHost,
    private val service: AcpClientService,
    private val acpBridge: AcpBridge,
    private val scope: CoroutineScope
) {
    fun install() {
        host.register("loadCustomAcpConfigs") {
            scope.launch(Dispatchers.IO) { push(CustomAcpConfigStore.load()) }
        }

        host.register("saveCustomAcpConfigs") { payload ->
            if (payload.isBlank()) return@register
            scope.launch(Dispatchers.IO) {
                val requested = runCatching {
                    customAcpJson.decodeFromString<List<CustomAcpConfig>>(payload)
                }.getOrNull() ?: return@launch

                val previous = CustomAcpConfigStore.load().associateBy(CustomAcpConfig::id)
                val saved = CustomAcpConfigStore.save(requested)
                val current = saved.associateBy(CustomAcpConfig::id)
                val changedIds = (previous.keys + current.keys).filterTo(linkedSetOf()) { id ->
                    previous[id] != current[id]
                }

                changedIds.forEach { adapterId ->
                    service.stopSharedProcess(adapterId)
                    if (adapterId !in current) AcpConfigOptionsCache.remove(adapterId)
                    acpBridge.resetDownloadProbeState(adapterId)
                    acpBridge.resetUpdateCheckState(adapterId)
                }
                changedIds.filter(current::containsKey).forEach { adapterId ->
                    service.initializeAdapterInBackground(adapterId)
                }

                push(saved)
                acpBridge.pushAdapters(includeRuntimeChecks = true)
            }
        }
    }

    private fun push(configs: List<CustomAcpConfig>) {
        val payload = customAcpJson
            .encodeToString(ListSerializer(CustomAcpConfig.serializer()), configs)
            .jsStringLiteral()
        host.eval("if(window.__onCustomAcpConfigs) window.__onCustomAcpConfigs(JSON.parse($payload));")
    }
}
