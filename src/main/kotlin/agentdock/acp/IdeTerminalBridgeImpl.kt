package agentdock.acp

import com.intellij.openapi.project.Project
import com.intellij.terminal.frontend.toolwindow.TerminalToolWindowTabsManager
import org.jetbrains.plugins.terminal.TerminalProjectOptionsProvider

internal class IdeTerminalBridgeImpl(private val project: Project) : IdeTerminalBridge {
    override fun openInTerminal(workingDir: String, title: String, command: String) {
        val tab = TerminalToolWindowTabsManager.getInstance(project)
            .createTabBuilder()
            .workingDirectory(workingDir)
            .tabName(title)
            .createTab()

        if (command.isNotBlank()) {
            tab.view.createSendTextBuilder()
                .shouldExecute()
                .send(command)
        }
    }

    override fun resolveShellPath(): String? =
        runCatching { TerminalProjectOptionsProvider.getInstance(project).shellPath }.getOrNull()
}
