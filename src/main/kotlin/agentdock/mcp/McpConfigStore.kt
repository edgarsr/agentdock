package agentdock.mcp

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import agentdock.acp.AcpAdapterPaths
import agentdock.acp.AcpExecutionMode
import agentdock.utils.atomicWriteText
import java.io.File

@Serializable
data class McpEnvVar(val name: String, val value: String)

@Serializable
data class McpHeader(val name: String, val value: String)

@Serializable
data class McpServerConfig(
    val id: String,
    val name: String,
    val enabled: Boolean,
    val transport: String,
    val command: String? = null,
    val args: List<String>? = null,
    val env: List<McpEnvVar>? = null,
    val url: String? = null,
    val headers: List<McpHeader>? = null
)

private val json = Json { ignoreUnknownKeys = true; prettyPrint = true }

object McpConfigStore {
    private val defaultServers = listOf(
        McpServerConfig(
            id = "jetbrains-ide",
            name = "Jetbrains IDE",
            enabled = false,
            transport = "sse",
            url = "http://localhost:64342/sse",
            headers = emptyList()
        )
    )

    private val configFile: File
        get() = File(AcpAdapterPaths.getBaseRuntimeDir(), "mcp-servers.json")

    fun ensureConfigFileExists() {
        val file = configFile
        if (file.exists()) return
        save(defaultServers)
    }

    fun load(): List<McpServerConfig> {
        val file = configFile
        if (!file.exists()) return emptyList()
        return try {
            normalizeServers(json.decodeFromString<List<McpServerConfig>>(file.readText()))
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun save(servers: List<McpServerConfig>) {
        val normalized = normalizeServers(servers)
        configFile.atomicWriteText(json.encodeToString(ListSerializer(McpServerConfig.serializer()), normalized))
    }

    fun loadEnabled(): List<McpServerConfig> = load().filter { it.enabled }

    private fun normalizeServers(servers: List<McpServerConfig>): List<McpServerConfig> =
        servers.map(::normalizeServer)

    private fun normalizeServer(server: McpServerConfig): McpServerConfig {
        if (!AcpExecutionMode.isWindowsHost()) return server
        if (!server.transport.equals("stdio", ignoreCase = true)) return server
        if (!server.command.equals("npx", ignoreCase = true)) return server
        return server.copy(command = "npx.cmd")
    }
}
