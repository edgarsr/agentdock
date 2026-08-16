package agentdock.acp

import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity
import agentdock.mcp.McpConfigStore
import agentdock.settings.GlobalSettingsStore

class AcpStartupActivity : ProjectActivity {
    override suspend fun execute(project: Project) {
        McpConfigStore.ensureConfigFileExists()
        AcpProcessRegistry.registerOwner()
        AcpClientService.getInstance(project).initializeDownloadedAdaptersInBackground()
        if (GlobalSettingsStore.load().quotaWidgetEnabled) {
            AcpQuotaService.getInstance().updateQuotas()
        }
    }
}
