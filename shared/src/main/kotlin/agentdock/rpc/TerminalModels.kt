package agentdock.rpc

import kotlinx.serialization.Serializable

@Serializable
data class TerminalCapability(
    val available: Boolean,
    val shellPath: String = "",
)

@Serializable
data class TerminalLaunchRequest(
    val workingDirectory: String,
    val title: String,
    val command: String,
)
