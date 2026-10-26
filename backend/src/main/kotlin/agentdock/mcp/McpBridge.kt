package agentdock.mcp

import agentdock.bridge.BridgeHost
import agentdock.utils.jsCallback
import agentdock.utils.jsStringLiteral
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

private val json = Json { ignoreUnknownKeys = true }

class McpBridge(
    private val host: BridgeHost,
    private val scope: CoroutineScope
) {
    private val statusJobMutex = Mutex()
    private val statusJobs = mutableMapOf<String, Job>()
    private var nextStatusRunId = 0L

    fun install() {
        host.register("loadMcpServers") {
            scope.launch(Dispatchers.IO) {
                push(McpConfigStore.load())
            }
        }

        host.register("saveMcpServers") { payload ->
            if (payload.isNotBlank()) {
                scope.launch(Dispatchers.IO) {
                    val servers = runCatching {
                        json.decodeFromString<List<McpServerConfig>>(payload)
                    }.getOrNull()
                    if (servers != null) {
                        McpConfigStore.save(servers)
                        push(servers)
                    }
                }
            }
        }

        host.register("checkMcpStatus") { id ->
            scope.launch(Dispatchers.IO) {
                statusJobMutex.withLock {
                    val server = McpConfigStore.load().firstOrNull { it.id == id } ?: return@withLock
                    val runId = nextStatusRunId++
                    pushStatus(McpStatusUpdate(server.id, McpStatus.LOADING, "Checking…", runId))
                    statusJobs.remove(id)?.cancel()
                    statusJobs[id] = scope.launch(Dispatchers.IO) {
                        val result = McpStatusChecker.check(server).copy(runId = runId)
                        statusJobMutex.withLock {
                            if (statusJobs[id] != coroutineContext.job) return@withLock
                            statusJobs.remove(id)
                            pushStatus(result)
                        }
                    }
                }
            }
        }

        host.register("cancelMcpStatus") { id ->
            scope.launch(Dispatchers.IO) {
                statusJobMutex.withLock { statusJobs.remove(id)?.cancel() }
            }
        }
    }

    private fun push(servers: List<McpServerConfig>) {
        val escaped = Json.encodeToString(ListSerializer(McpServerConfig.serializer()), servers).jsStringLiteral()
        host.eval(jsCallback("__onMcpServers", "JSON.parse($escaped)"))
    }

    private fun pushStatus(update: McpStatusUpdate) {
        val escaped = json.encodeToString(update).jsStringLiteral()
        host.eval(jsCallback("__onMcpStatus", "JSON.parse($escaped)"))
    }
}
