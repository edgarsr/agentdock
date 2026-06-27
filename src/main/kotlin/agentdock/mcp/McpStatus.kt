package agentdock.mcp

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Runtime status of an MCP server. This is transient (not persisted) and reflects the
 * outcome of the latest reachability/health probe performed by [McpStatusChecker].
 *
 * [SerialName] keeps the wire format lowercase to match the frontend contract
 * (frontend/src/types/mcp.ts -> McpStatus); the Kotlin enum names stay idiomatic uppercase.
 */
@Serializable
enum class McpStatus {
    @SerialName("loading") LOADING,
    @SerialName("connected") CONNECTED,
    @SerialName("error") ERROR,
    @SerialName("disabled") DISABLED
}

@Serializable
data class McpStatusUpdate(
    val id: String,
    val status: McpStatus,
    val message: String = ""
)
