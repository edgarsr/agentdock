package agentdock.acp

import agentdock.bridge.BridgeHost
import agentdock.utils.jsCallback
import agentdock.utils.jsStringLiteral
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

private val customAcpJson = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
}

@Serializable
private data class CustomAcpTestRequest(val id: String, val requestId: String)

@Serializable
private data class CustomAcpStatusUpdate(
    val id: String,
    val requestId: String,
    val status: String,
    val message: String = ""
)

class CustomAcpBridge(
    private val host: BridgeHost,
    private val service: AcpClientService,
    private val acpBridge: AcpBridge,
    private val scope: CoroutineScope
) {
    private val mutex = Mutex()
    private val testJobs = mutableMapOf<String, Job>()

    fun install() {
        host.register("loadCustomAcpConfigs") {
            scope.launch(Dispatchers.IO) { push(CustomAcpConfigStore.load()) }
        }

        host.register("saveCustomAcpConfigs") { payload ->
            if (payload.isBlank()) return@register
            scope.launch(Dispatchers.IO) {
                mutex.withLock {
                    val requested = runCatching {
                        customAcpJson.decodeFromString<List<CustomAcpConfig>>(payload)
                    }.getOrNull() ?: return@withLock

                    val previous = CustomAcpConfigStore.load().associateBy(CustomAcpConfig::id)
                    val saved = CustomAcpConfigStore.save(requested)
                    val current = saved.associateBy(CustomAcpConfig::id)
                    val changedIds = (previous.keys + current.keys).filterTo(linkedSetOf()) { id ->
                        previous[id] != current[id]
                    }

                    changedIds.forEach { adapterId ->
                        testJobs.remove(adapterId)?.cancel()
                        AcpClientService.stopCustomAdapterInAllProjects(adapterId)
                        if (adapterId !in current) AcpConfigOptionsCache.remove(adapterId)
                        acpBridge.resetDownloadProbeState(adapterId)
                        acpBridge.resetUpdateCheckState(adapterId)
                    }
                    changedIds.filter { current[it]?.enabled == true }.forEach { adapterId ->
                        service.initializeAdapterInBackground(adapterId)
                    }

                    push(saved)
                    acpBridge.pushAdapters(includeRuntimeChecks = true)
                }
            }
        }

        host.register("testCustomAcpConnection") { payload ->
            val request = runCatching { customAcpJson.decodeFromString<CustomAcpTestRequest>(payload) }
                .getOrNull() ?: return@register
            scope.launch(Dispatchers.IO) {
                mutex.withLock {
                    val config = CustomAcpConfigStore.load().firstOrNull { it.id == request.id }
                    if (config == null) {
                        pushStatus(CustomAcpStatusUpdate(request.id, request.requestId, "error", "Configuration no longer exists."))
                        return@withLock
                    }
                    testJobs.remove(config.id)?.cancel()
                    val job = scope.launch(Dispatchers.IO, start = CoroutineStart.LAZY) {
                        val (success, message) = service.testCustomAcpConnection(config)
                        mutex.withLock result@{
                            if (CustomAcpConfigStore.load().firstOrNull { it.id == config.id } != config) return@result
                            pushStatus(CustomAcpStatusUpdate(
                                config.id, request.requestId, if (success) "connected" else "error", message
                            ))
                        }
                    }
                    testJobs[config.id] = job
                    job.start()
                }
            }
        }

        host.register("cancelCustomAcpConnectionTest") { id ->
            scope.launch(Dispatchers.IO) {
                mutex.withLock { testJobs.remove(id)?.cancel() }
            }
        }
    }

    private fun pushStatus(update: CustomAcpStatusUpdate) {
        val payload = customAcpJson.encodeToString(update).jsStringLiteral()
        host.eval(jsCallback("__onCustomAcpStatus", "JSON.parse($payload)"))
    }

    private fun push(configs: List<CustomAcpConfig>) {
        val payload = customAcpJson
            .encodeToString(ListSerializer(CustomAcpConfig.serializer()), configs)
            .jsStringLiteral()
        host.eval(jsCallback("__onCustomAcpConfigs", "JSON.parse($payload)"))
    }
}
