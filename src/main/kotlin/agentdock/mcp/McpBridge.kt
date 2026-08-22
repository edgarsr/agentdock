package agentdock.mcp

import agentdock.bridge.BridgeHost
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import agentdock.utils.jsStringLiteral

private val json = Json { ignoreUnknownKeys = true }

class McpBridge(
    private val host: BridgeHost,
    private val scope: CoroutineScope
) {
    private val statusJobMutex = Mutex()
    private var statusJob: Job? = null
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

        host.register("checkMcpStatus") {
            requestStatusCheck()
        }
    }

    private fun requestStatusCheck(serversSnapshot: List<McpServerConfig>? = null) {
        scope.launch(Dispatchers.IO) {
            statusJobMutex.withLock {
                val servers = serversSnapshot ?: McpConfigStore.load()
                val runId = nextStatusRunId++
                pushInitialStatus(servers, runId)
                statusJob?.cancelAndJoin()
                statusJob = scope.launch(Dispatchers.IO) {
                    runStatusCheck(servers, runId)
                }
            }
        }
    }

    private suspend fun runStatusCheck(servers: List<McpServerConfig>, runId: Long) {
        if (servers.isEmpty()) return

        // Probe each server sequentially so we never spawn many processes / sockets at once.
        servers.forEach { server ->
            val result = McpStatusChecker.check(server).copy(runId = runId)
            pushStatus(result)
        }
    }

    private fun pushInitialStatus(servers: List<McpServerConfig>, runId: Long) {
        // Announce a loading state for enabled servers and disabled for the rest, so the UI can
        // show the yellow indicator immediately before each probe completes.
        servers.forEach { server ->
            val initial = if (server.enabled) {
                McpStatusUpdate(server.id, McpStatus.LOADING, "Checking…", runId)
            } else {
                McpStatusUpdate(server.id, McpStatus.DISABLED, "Disabled", runId)
            }
            pushStatus(initial)
        }
    }

    private fun push(servers: List<McpServerConfig>) {
        val escaped = Json.encodeToString(ListSerializer(McpServerConfig.serializer()), servers).jsStringLiteral()
        host.eval("if(window.__onMcpServers) window.__onMcpServers(JSON.parse($escaped));")
    }

    private fun pushStatus(update: McpStatusUpdate) {
        val escaped = json.encodeToString(update).jsStringLiteral()
        host.eval("if(window.__onMcpStatus) window.__onMcpStatus(JSON.parse($escaped));")
    }
}
