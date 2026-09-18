package agentdock

import agentdock.ui.AgentDockUiHost
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory

/**
 * Creates the tool window in whichever process owns the UI: the IDE itself, or the JetBrains Client
 * in Remote Development. The browser itself is owned by [AgentDockUiHost] so it can move between
 * this tool window and an editor tab without being recreated.
 */
class AgentDockToolWindowFactory : ToolWindowFactory, DumbAware {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        AgentDockUiHost.getInstance(project).bindToolWindow(toolWindow)
    }
}
