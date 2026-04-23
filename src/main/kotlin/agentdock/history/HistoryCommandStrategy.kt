package agentdock.history

import agentdock.acp.AcpExecutionTarget
import agentdock.acp.buildAdapterCliCommandParts
import agentdock.acp.isWindowsLocalTarget
import java.io.File

internal fun runAgentHistoryCliCommand(
    adapterId: String,
    projectPath: String,
    args: List<String>
): String? {
    val (_, commandParts) = buildAdapterCliCommandParts(adapterId, args) ?: return null
    return runCatching {
        val localCommandParts = if (
            isWindowsLocalTarget(AcpExecutionTarget.LOCAL) &&
            commandParts.firstOrNull()?.let { it.endsWith(".cmd", true) || it.endsWith(".bat", true) } == true
        ) {
            listOf("cmd.exe", "/c") + commandParts
        } else {
            commandParts
        }
        val process = ProcessBuilder(localCommandParts)
            .directory(File(projectPath))
            .redirectErrorStream(true)
            .start()
        val output = process.inputStream.bufferedReader().use { it.readText() }
        val exitCode = process.waitFor()
        if (exitCode != 0) null else output
    }.getOrNull()?.trim()
}
