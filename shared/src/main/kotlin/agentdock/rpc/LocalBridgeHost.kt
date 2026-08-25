package agentdock.rpc

import com.intellij.openapi.Disposable
import com.intellij.openapi.project.Project
import kotlinx.coroutines.flow.Flow

/**
 * The same two-way bridge as [AgentDockRpcApi], but without a wire in between.
 *
 * The backend content module registers the implementation as a project service under this
 * interface. In a monolithic IDE the tool window finds it and every message is a plain method
 * call - no serialization, no batching, no round trip. In Split Mode the backend module is not
 * loaded in the client process, the lookup returns `null`, and the tool window falls back to RPC.
 * The presence of this service is therefore the environment check; nothing has to ask which mode
 * the IDE is running in.
 */
interface LocalBridgeHost {

    fun invokeCommand(command: String, payload: String)

    fun attachLocal(consume: (UiMessage) -> Unit): Disposable

    fun nativeState(): Flow<NativeState>

    companion object {
        fun getInstanceOrNull(project: Project): LocalBridgeHost? =
            project.getService(LocalBridgeHost::class.java)
    }
}
