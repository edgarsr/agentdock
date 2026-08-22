package agentdock.bridge

import agentdock.rpc.AgentDockRpcApi
import agentdock.rpc.NativeState
import agentdock.rpc.UiMessage
import com.intellij.platform.project.ProjectId
import com.intellij.platform.project.findProjectOrNull
import com.intellij.platform.rpc.backend.RemoteApiProvider
import fleet.rpc.remoteApiDescriptor
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow

/**
 * Split Mode entry point. It only forwards to [BridgeHost], which is also what the monolithic path
 * calls, so both environments run the same backend code.
 */
private class AgentDockRemoteApi : AgentDockRpcApi {

    override suspend fun invokeCommand(projectId: ProjectId, command: String, payload: String) {
        val project = projectId.findProjectOrNull() ?: return
        BridgeHost.getInstance(project).invokeCommand(command, payload)
    }

    override suspend fun uiMessages(projectId: ProjectId): Flow<List<UiMessage>> {
        val project = projectId.findProjectOrNull() ?: return emptyFlow()
        return BridgeHost.getInstance(project).attachRemote()
    }

    override suspend fun nativeState(projectId: ProjectId): Flow<NativeState> {
        val project = projectId.findProjectOrNull() ?: return emptyFlow()
        return BridgeHost.getInstance(project).nativeState()
    }

    override suspend fun generateGitCommitMessage(projectId: ProjectId, selectedPaths: List<String>): String {
        val project = projectId.findProjectOrNull() ?: error("Project is no longer available.")
        return BridgeHost.getInstance(project).generateGitCommitMessage(selectedPaths)
    }
}

internal class AgentDockRemoteApiProvider : RemoteApiProvider {
    override fun RemoteApiProvider.Sink.remoteApis() {
        remoteApi(remoteApiDescriptor<AgentDockRpcApi>()) { AgentDockRemoteApi() }
    }
}
