package agentdock.acp

import com.intellij.openapi.project.Project
import org.jetbrains.plugins.terminal.ShellTerminalWidget
import org.jetbrains.plugins.terminal.TerminalProjectOptionsProvider
import org.jetbrains.plugins.terminal.TerminalToolWindowManager

internal class IdeTerminalBridgeImpl(private val project: Project) : IdeTerminalBridge {
    override fun openInTerminal(workingDir: String, title: String, command: String) {
        val widget = TerminalToolWindowManager.getInstance(project)
            .createShellWidget(workingDir, title, true, true)
        ShellTerminalWidget.toShellJediTermWidgetOrThrow(widget).executeCommand(command)
    }

    override fun resolveShellPath(): String? =
        runCatching { TerminalProjectOptionsProvider.getInstance(project).shellPath }.getOrNull()
}
