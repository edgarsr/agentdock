package agentdock.bridge

import agentdock.acp.AcpBridge
import agentdock.acp.AcpClientService
import agentdock.acp.initializeDownloadedAdaptersInBackground
import agentdock.history.HistoryBridge
import agentdock.mcp.McpBridge
import agentdock.promptlibrary.PromptLibraryBridge
import agentdock.settings.SettingsBridge
import agentdock.systeminstructions.SystemInstructionsBridge
import com.intellij.openapi.Disposable
import com.intellij.openapi.project.Project
import com.intellij.platform.util.coroutines.childScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel

/**
 * Builds the bridges for one attached UI and tears them down when it goes away.
 *
 * The bridges are per attachment rather than per project because that is how they behaved when the
 * tool window owned them: their in-flight jobs and per-chat state belong to the UI that started
 * them. The agent sessions themselves live in [AcpClientService] and outlive all of this.
 */
internal object AgentDockBridges {

    fun install(project: Project, host: BridgeHost, parentScope: CoroutineScope): Disposable {
        // The tool window used to create this scope on the EDT dispatcher; handlers that launch
        // without naming a dispatcher still rely on that, so it is preserved rather than inherited.
        val scope = parentScope.childScope("AgentDockBridges", Dispatchers.Main.immediate)
        val service = AcpClientService.getInstance(project)

        val acpBridge = AcpBridge(host, service, scope)
        acpBridge.install()
        HistoryBridge(host, project, scope).install()
        McpBridge(host, scope).install()
        SystemInstructionsBridge(host, scope).install()
        PromptLibraryBridge(host, scope).install()
        SettingsBridge(host, scope).install()

        // The tool window can be restored while the project is still opening, so adapter
        // initialization is warmed up on attach rather than relying on AcpStartupActivity ordering.
        runCatching { service.initializeDownloadedAdaptersInBackground() }

        return Disposable {
            service.releaseUiCallbacks(acpBridge)
            scope.cancel()
        }
    }
}
