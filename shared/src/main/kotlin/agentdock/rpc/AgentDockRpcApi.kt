@file:Suppress("UnstableApiUsage")

package agentdock.rpc

import agentdock.acp.QuotaDetail
import agentdock.settings.GlobalSettings
import com.intellij.platform.project.ProjectId
import com.intellij.platform.rpc.RemoteApiProviderService
import fleet.rpc.RemoteApi
import fleet.rpc.Rpc
import fleet.rpc.remoteApiDescriptor
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.Serializable

/**
 * One message from the backend to the frontend.
 *
 * [topic] tells the frontend what [payload] is. Tool-window messages contain JavaScript to evaluate
 * in JCEF; native UI state has its own typed flow so it remains available while JCEF is closed.
 */
@Serializable
data class UiMessage(val topic: String, val payload: String) {
    companion object {
        const val TOPIC_JS: String = "js"
        const val TOPIC_FRONTEND_CAPABILITIES: String = "frontend-capabilities"
        const val TOPIC_TERMINAL: String = "terminal"
    }
}

@Serializable
data class NativeState(
    val settings: GlobalSettings = GlobalSettings(),
    val quotas: List<QuotaDetail> = emptyList(),
)

/**
 * The whole frontend/backend contract of the plugin. The JCEF bridge remains two generic,
 * one-way operations, while native state uses a typed flow because it exists outside the browser
 * lifecycle.
 *
 * This API is only reached in Split Mode. In a monolithic IDE the tool window talks to the backend
 * services directly, so nothing here is serialized.
 */
@Rpc
interface AgentDockRpcApi : RemoteApi<Unit> {

    /** Frontend -> backend: run a bridge command. */
    suspend fun invokeCommand(projectId: ProjectId, command: String, payload: String)

    /**
     * Backend -> frontend: messages for the tool window, in emission order.
     *
     * Messages arrive in batches because the streaming path produces one script per agent output
     * chunk; coalescing them on the backend keeps a fast agent from turning into one round trip
     * per token. Collecting the flow also marks the UI as attached, so the backend stops buffering
     * once nobody is listening.
     */
    suspend fun uiMessages(projectId: ProjectId): Flow<List<UiMessage>>

    suspend fun nativeState(projectId: ProjectId): Flow<NativeState>

    companion object {
        suspend fun getInstance(): AgentDockRpcApi =
            RemoteApiProviderService.resolve(remoteApiDescriptor<AgentDockRpcApi>())
    }
}
