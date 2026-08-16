package agentdock.acp

import com.intellij.openapi.project.Project
import kotlinx.coroutines.runBlocking
import agentdock.history.AgentDockHistoryService
import java.io.File

/**
 * Handles CLI/terminal operations for ACP adapters within the IDE.
 */
internal class AcpBridgeCli(
    private val project: Project,
    private val runOnEdt: (() -> Unit) -> Unit
) {
    fun openAgentCliInTerminal(adapterId: String) {
        val shellFlavor = detectIdeTerminalShellFlavor()
        val (adapterInfo, command) = buildCliCommand(adapterId, emptyList(), shellFlavor) ?: return
        if (command.isBlank()) return
        val adapterRoot = AcpAdapterPaths.getDownloadPath(adapterId, AcpAdapterPaths.getExecutionTarget())
        openInIdeTerminal(resolveTerminalWorkingDir(adapterRoot), "${adapterInfo.name} CLI", command)
    }

    fun openHistoryConversationCliInTerminal(projectPath: String, conversationId: String) {
        val latestSession = runBlocking {
            AgentDockHistoryService.getConversationSessions(projectPath, conversationId)
                .maxByOrNull { it.updatedAt }
        } ?: return

        val adapterInfo = runCatching { AcpAdapterConfig.getAdapterInfo(latestSession.adapterName) }.getOrNull() ?: return
        val resumeArgs = adapterInfo.cli?.resumeArgs.orEmpty()
        if (resumeArgs.isEmpty()) return

        val placeholders = mapOf(
            "sessionId" to latestSession.sessionId,
            "conversationId" to conversationId,
            "projectPath" to projectPath,
            "adapterId" to latestSession.adapterName
        )
        val shellFlavor = detectIdeTerminalShellFlavor()
        val (_, command) = buildCliCommand(
            latestSession.adapterName,
            applyCliPlaceholders(resumeArgs, placeholders),
            shellFlavor
        ) ?: return
        if (command.isBlank()) return

        openInIdeTerminal(resolveTerminalWorkingDir(projectPath), "${adapterInfo.name} CLI", command)
    }

    private fun resolveTerminalWorkingDir(fallback: String): String =
        project.basePath?.takeIf { it.isNotBlank() } ?: fallback

    fun isIdeTerminalAvailable(): Boolean = project.ideTerminalBridge() != null

    private fun buildCliCommand(
        adapterId: String,
        extraArgs: List<String>,
        shellFlavor: TerminalShellFlavor
    ): Pair<AcpAdapterConfig.AdapterInfo, String>? {
        val (adapterInfo, commandParts) = buildAdapterCliCommandParts(adapterId, extraArgs) ?: return null
        val interactiveParts = commandParts.map { normalizeInteractiveShellPart(it, shellFlavor) }
        val command = toShellCommand(interactiveParts, shellFlavor)
        return adapterInfo to command
    }

    private fun openInIdeTerminal(workingDir: String, title: String, command: String) {
        val bridge = project.ideTerminalBridge() ?: return
        runOnEdt {
            runCatching { bridge.openInTerminal(workingDir, title, command) }
        }
    }

    private fun detectIdeTerminalShellFlavor(): TerminalShellFlavor {
        val shellPath = resolveIdeTerminalShellPath()?.lowercase().orEmpty()
        return when {
            shellPath.contains("powershell") || shellPath.endsWith("pwsh.exe") -> TerminalShellFlavor.POWERSHELL
            shellPath.endsWith("cmd.exe") -> TerminalShellFlavor.CMD
            shellPath.isNotBlank() -> TerminalShellFlavor.POSIX
            System.getProperty("os.name").lowercase().contains("win") -> TerminalShellFlavor.POWERSHELL
            else -> TerminalShellFlavor.POSIX
        }
    }

    private fun resolveIdeTerminalShellPath(): String? =
        project.ideTerminalBridge()?.resolveShellPath()
}

internal enum class TerminalShellFlavor {
    POWERSHELL,
    CMD,
    POSIX
}

internal fun buildAdapterCliCommandParts(
    adapterId: String,
    extraArgs: List<String> = emptyList()
): Pair<AcpAdapterConfig.AdapterInfo, List<String>>? {
    val adapterInfo = runCatching { AcpAdapterConfig.getAdapterInfo(adapterId) }.getOrNull() ?: return null
    val cli = adapterInfo.cli ?: return null
    val target = AcpAdapterPaths.getExecutionTarget()
    val adapterRoot = AcpAdapterPaths.getDownloadPath(adapterId, target)
    if (!AcpAdapterPaths.isDownloaded(adapterId, target)) return null

    val executable = platformBinaryForTarget(cli.executable, target)
    val entryPath = cli.entryPath?.takeIf { it.isNotBlank() }
    if (executable.isNullOrBlank()) return null

    val commandParts = mutableListOf<String>()
    commandParts += resolveCliPath(adapterRoot, executable, target)
    if (entryPath != null) {
        commandParts += resolveCliPath(adapterRoot, entryPath, target)
    }
    commandParts += cli.args
    commandParts += extraArgs
    return adapterInfo to commandParts
}

internal fun applyCliPlaceholders(values: List<String>, placeholders: Map<String, String>): List<String> {
    return values.map { value ->
        placeholders.entries.fold(value) { acc, (key, replacement) ->
            acc.replace("{$key}", replacement)
        }
    }
}

internal fun resolveCliPath(adapterRoot: String, raw: String, target: AcpExecutionTarget): String {
    val path = raw.trim()
    if (path.isEmpty()) return path
    val file = File(path)
    if (file.isAbsolute) return file.absolutePath
    val relative = File(adapterRoot, path.replace("/", File.separator).replace("\\", File.separator))
    return if (relative.exists()) relative.absolutePath else path
}

internal fun toShellCommand(parts: List<String>, shellFlavor: TerminalShellFlavor): String {
    val filtered = parts.filter { it.isNotBlank() }
    if (filtered.isEmpty()) return ""

    return when (shellFlavor) {
        TerminalShellFlavor.POWERSHELL -> {
            val executable = filtered.first()
            val args = filtered.drop(1).joinToString(" ") { quotePowerShellArg(it) }
            buildString {
                append("& ")
                append(quotePowerShellArg(executable))
                if (args.isNotBlank()) {
                    append(" ")
                    append(args)
                }
            }
        }
        TerminalShellFlavor.CMD -> filtered.joinToString(" ") { quoteCmdArg(it) }
        TerminalShellFlavor.POSIX -> filtered.joinToString(" ") { quoteUnixShellArg(it) }
    }
}

internal fun quotePowerShellArg(value: String): String = "'" + value.replace("'", "''") + "'"

internal fun quoteCmdArg(value: String): String {
    if (value.isEmpty()) return "\"\""
    val needsQuotes = value.any { it.isWhitespace() || it in charArrayOf('"', '^', '&', '|', '<', '>', '(', ')') }
    val escaped = value.replace("\"", "\"\"")
    return if (needsQuotes) "\"$escaped\"" else escaped
}

internal fun normalizeInteractiveShellPart(value: String, shellFlavor: TerminalShellFlavor): String {
    if (shellFlavor == TerminalShellFlavor.CMD) return value
    val trimmed = value.trim()
    if (trimmed.indexOfAny(charArrayOf('\\', '/', ':')) >= 0) return value

    return when {
        trimmed.endsWith(".cmd", ignoreCase = true) -> trimmed.dropLast(4)
        trimmed.endsWith(".bat", ignoreCase = true) -> trimmed.dropLast(4)
        else -> value
    }
}
