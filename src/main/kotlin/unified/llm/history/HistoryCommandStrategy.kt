package unified.llm.history

import unified.llm.acp.AcpAdapterPaths
import unified.llm.acp.AcpExecutionMode
import unified.llm.acp.AcpExecutionTarget
import unified.llm.acp.buildAdapterCliCommandParts
import java.io.File

internal fun runAgentHistoryCliCommand(
    adapterId: String,
    projectPath: String,
    args: List<String>
): String? {
    val (_, commandParts) = buildAdapterCliCommandParts(adapterId, args) ?: return null
    return when (AcpAdapterPaths.getExecutionTarget()) {
        AcpExecutionTarget.LOCAL -> {
            runCatching {
                val process = ProcessBuilder(commandParts)
                    .directory(File(projectPath))
                    .redirectErrorStream(true)
                    .start()
                val output = process.inputStream.bufferedReader().use { it.readText() }
                val exitCode = process.waitFor()
                if (exitCode != 0) null else output
            }.getOrNull()
        }
        AcpExecutionTarget.WSL -> {
            val cwd = AcpExecutionMode.toWslPath(projectPath) ?: projectPath
            AcpExecutionMode.runWslExec(commandParts, cwd = cwd, timeoutSeconds = 60)
                ?.takeIf { it.exitCode == 0 }
                ?.stdout
        }
    }?.trim()
}
