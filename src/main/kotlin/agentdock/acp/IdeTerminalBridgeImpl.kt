package agentdock.acp

import agentdock.rpc.TerminalLaunchRequest
import com.intellij.openapi.project.Project
import com.intellij.terminal.frontend.toolwindow.TerminalToolWindowTabsManager
import org.jetbrains.plugins.terminal.TerminalProjectOptionsProvider

internal class IdeTerminalBridgeImpl(private val project: Project) : IdeTerminalBridge {
    override fun open(request: TerminalLaunchRequest) {
        val tab = TerminalToolWindowTabsManager.getInstance(project)
            .createTabBuilder()
            .workingDirectory(request.workingDirectory)
            .tabName(request.title)
            .createTab()

        if (request.command.isNotBlank()) {
            tab.view.createSendTextBuilder()
                .shouldExecute()
                .send(request.command)
        }
    }

    override fun resolveShellPath(): String? =
        runCatching { TerminalProjectOptionsProvider.getInstance(project).shellPath }.getOrNull()
}
