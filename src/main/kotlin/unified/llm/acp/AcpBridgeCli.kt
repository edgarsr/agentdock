package unified.llm.acp

import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.extensions.PluginId
import com.intellij.openapi.project.Project
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import unified.llm.history.UnifiedHistoryService
import java.io.File

/**
 * Handles CLI/terminal operations for ACP adapters within the IDE.
 */
internal class AcpBridgeCli(
    private val project: Project,
    private val runOnEdt: (() -> Unit) -> Unit
) {
    fun openAgentCliInTerminal(adapterId: String) {
        val (adapterInfo, command) = buildCliCommand(adapterId, emptyList()) ?: return
        if (command.isBlank()) return
        val adapterRoot = AcpAdapterPaths.getDownloadPath(adapterId, AcpAdapterPaths.getExecutionTarget())
        openInIdeTerminal(resolveTerminalWorkingDir(adapterRoot), "${adapterInfo.name} CLI", command)
    }

    fun openLoginInTerminal(adapterId: String): Boolean {
        val adapterInfo = runCatching { AcpAdapterConfig.getAdapterInfo(adapterId) }.getOrNull() ?: return false
        val commandParts = AcpAuthService.buildLoginCommand(adapterId) ?: return false
        val command = toShellCommand(commandParts)
        if (command.isBlank()) return false
        val adapterRoot = AcpAdapterPaths.getDownloadPath(adapterId, AcpAdapterPaths.getExecutionTarget())
        return openInIdeTerminal(resolveTerminalWorkingDir(adapterRoot), "${adapterInfo.name} Login", command)
    }

    suspend fun awaitInteractiveLoginCompletion(adapterId: String) {
        val timeoutAt = System.currentTimeMillis() + AcpAuthService.INTERACTIVE_LOGIN_TIMEOUT_MS
        while (System.currentTimeMillis() < timeoutAt) {
            if (!AcpAuthService.isAuthenticating(adapterId)) return
            delay(500L)
        }
    }

    fun openHistoryConversationCliInTerminal(projectPath: String, conversationId: String) {
        val latestSession = runBlocking {
            UnifiedHistoryService.getConversationSessions(projectPath, conversationId)
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
        val (_, command) = buildCliCommand(latestSession.adapterName, applyCliPlaceholders(resumeArgs, placeholders)) ?: return
        if (command.isBlank()) return

        openInIdeTerminal(resolveTerminalWorkingDir(projectPath), "${adapterInfo.name} CLI", command)
    }

    private fun resolveTerminalWorkingDir(fallback: String): String =
        project.basePath?.takeIf { it.isNotBlank() } ?: fallback

    fun isIdeTerminalAvailable(): Boolean {
        return loadIdeTerminalManagerClass() != null
    }

    private fun buildCliCommand(adapterId: String, extraArgs: List<String>): Pair<AcpAdapterConfig.AdapterInfo, String>? {
        val (adapterInfo, commandParts) = buildAdapterCliCommandParts(adapterId, extraArgs) ?: return null
        val target = AcpAdapterPaths.getExecutionTarget()

        val command = when (target) {
            AcpExecutionTarget.LOCAL -> toShellCommand(commandParts)
            AcpExecutionTarget.WSL -> buildWslTerminalCommand(commandParts, project.basePath)
        }
        return adapterInfo to command
    }

    private fun openInIdeTerminal(workingDir: String, title: String, command: String): Boolean {
        val managerClass = loadIdeTerminalManagerClass() ?: return false
        return runCatching {
            runOnEdt {
                val getInstance = managerClass.getMethod("getInstance", com.intellij.openapi.project.Project::class.java)
                val terminalManager = getInstance.invoke(null, project) ?: return@runOnEdt
                val createShellWidget = managerClass.getMethod(
                    "createShellWidget",
                    String::class.java,
                    String::class.java,
                    Boolean::class.javaPrimitiveType,
                    Boolean::class.javaPrimitiveType
                )
                createShellWidget.isAccessible = true
                val widget = createShellWidget.invoke(terminalManager, workingDir, title, true, true) ?: return@runOnEdt
                val sendCommand = widget.javaClass.methods.firstOrNull { method ->
                    method.name == "sendCommandToExecute" &&
                        method.parameterCount == 1 &&
                        method.parameterTypes[0] == String::class.java
                } ?: return@runOnEdt
                sendCommand.isAccessible = true
                sendCommand.invoke(widget, command)
            }
            true
        }.getOrElse { false }
    }

    private fun loadIdeTerminalManagerClass(): Class<*>? {
        val className = "org.jetbrains.plugins.terminal.TerminalToolWindowManager"
        val terminalPluginId = PluginId.getId("org.jetbrains.plugins.terminal")
        val pluginDescriptor = PluginManagerCore.getPlugin(terminalPluginId)
        val pluginClassLoader = runCatching {
            pluginDescriptor
                ?.javaClass
                ?.methods
                ?.firstOrNull { it.name == "getPluginClassLoader" && it.parameterCount == 0 }
                ?.invoke(pluginDescriptor) as? ClassLoader
        }.getOrNull()

        val classLoaders = listOfNotNull(
            pluginClassLoader,
            javaClass.classLoader,
            project.javaClass.classLoader,
            ApplicationManager::class.java.classLoader,
            Thread.currentThread().contextClassLoader
        ).distinct()

        classLoaders.forEach { classLoader ->
            val loaded = runCatching { Class.forName(className, false, classLoader) }.getOrNull()
            if (loaded != null) {
                return loaded
            }
        }

        return null
    }
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

    val executable = if (target == AcpExecutionTarget.WSL) cli.executable.unix else cli.executable.win
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
    return when (target) {
        AcpExecutionTarget.LOCAL -> {
            val relative = File(adapterRoot, path.replace("/", File.separator).replace("\\", File.separator))
            if (relative.exists()) relative.absolutePath else path
        }
        AcpExecutionTarget.WSL -> {
            if (path.startsWith("/")) path else "${adapterRoot.trimEnd('/')}/${path.replace("\\", "/")}"
        }
    }
}

internal fun toShellCommand(parts: List<String>): String {
    val filtered = parts.filter { it.isNotBlank() }
    if (filtered.isEmpty()) return ""

    val os = System.getProperty("os.name").lowercase()
    return if (os.contains("win")) {
        val executable = filtered.first()
        val args = filtered.drop(1).joinToString(" ") { quoteShellArg(it) }
        buildString {
            append("& ")
            append(quoteShellArg(executable))
            if (args.isNotBlank()) {
                append(" ")
                append(args)
            }
        }
    } else {
        filtered.joinToString(" ") { quoteShellArg(it) }
    }
}

internal fun quoteShellArg(value: String): String {
    val os = System.getProperty("os.name").lowercase()
    return if (os.contains("win")) {
        "'" + value.replace("'", "''") + "'"
    } else {
        "'" + value.replace("'", "'\"'\"'") + "'"
    }
}

internal fun buildWslTerminalCommand(parts: List<String>, projectPath: String?): String {
    val filtered = parts.filter { it.isNotBlank() }
    if (filtered.isEmpty()) return ""
    val distro = AcpExecutionMode.selectedWslDistributionName().takeIf { it.isNotBlank() }
    val command = filtered.joinToString(" ") { quoteUnixShellArg(it) }
    val cwd = AcpExecutionMode.toWslPath(projectPath)
    val script = buildString {
        cwd?.takeIf { it.isNotBlank() }?.let {
            append("cd ")
            append(quoteUnixShellArg(it))
            append(" && ")
        }
        append("exec ")
        append(command)
    }
    return buildString {
        append("wsl.exe ")
        if (distro != null) {
            append("-d ")
            append(quoteShellArg(distro))
            append(" ")
        }
        append("--exec bash -lic ")
        append(quoteShellArg(script))
    }
}
