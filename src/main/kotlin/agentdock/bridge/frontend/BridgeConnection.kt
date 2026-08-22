package agentdock.bridge.frontend

import agentdock.rpc.AgentDockRpcApi
import agentdock.rpc.LocalBridgeHost
import agentdock.rpc.UiMessage
import com.intellij.openapi.Disposable
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.platform.project.projectId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * The tool window's link to the backend.
 *
 * In a monolithic IDE [LocalBridgeHost] is present and every call is direct. In Split Mode it is
 * absent and the same two operations go over [AgentDockRpcApi]. Nothing above this class knows
 * which of the two is in use.
 */
internal class BridgeConnection(
    private val project: Project,
    private val scope: CoroutineScope,
    private val onMessage: (UiMessage) -> Unit,
    private val onReconnected: () -> Unit,
) : Disposable {

    private val local: LocalBridgeHost? = LocalBridgeHost.getInstanceOrNull(project)

    private var localAttachment: Disposable? = null
    private var receiveJob: Job? = null
    private var sendJob: Job? = null

    /** Commands are queued rather than launched one coroutine each, so the backend sees them in the order the user caused them. */
    private val outbox = Channel<Pair<String, String>>(Channel.UNLIMITED)

    fun open() {
        val local = local
        if (local != null) {
            localAttachment = local.attachLocal(onMessage)
            return
        }
        receiveJob = scope.launch(Dispatchers.IO) { receiveRemote() }
        sendJob = scope.launch(Dispatchers.IO) { sendRemote() }
    }

    fun invokeCommand(command: String, payload: String) {
        val local = local
        if (local != null) {
            local.invokeCommand(command, payload)
            return
        }
        outbox.trySend(command to payload)
    }

    private suspend fun receiveRemote() {
        var reconnect = false
        while (scope.isActive) {
            try {
                AgentDockRpcApi.getInstance()
                    .uiMessages(project.projectId())
                    .collect { batch ->
                        // The backend emits an empty acknowledgement after the flow is attached.
                        // Only then is the connection genuinely back and it is safe to reload the
                        // UI so its normal ready handshake reconstructs state.
                        if (reconnect) {
                            reconnect = false
                            onReconnected()
                        }
                        batch.forEach(onMessage)
                    }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // The backend went away or the link broke; retry below.
            }
            reconnect = true
            delay(REMOTE_RECONNECT_DELAY_MS)
        }
    }

    private suspend fun sendRemote() {
        for ((command, payload) in outbox) {
            try {
                AgentDockRpcApi.getInstance().invokeCommand(project.projectId(), command, payload)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // A command lost to a broken link is not worth retrying: the reload that follows
                // reconnection makes the UI ask again for whatever it still needs.
            }
        }
    }

    override fun dispose() {
        outbox.close()
        receiveJob?.cancel()
        sendJob?.cancel()
        localAttachment?.let { Disposer.dispose(it) }
        localAttachment = null
    }
}

internal const val REMOTE_RECONNECT_DELAY_MS = 1_000L
