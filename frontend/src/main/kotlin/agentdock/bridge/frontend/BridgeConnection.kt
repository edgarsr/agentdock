package agentdock.bridge.frontend

import agentdock.rpc.AgentDockRpcApi
import agentdock.rpc.BridgeCommand
import agentdock.rpc.LocalBridgeHost
import agentdock.rpc.UiMessage
import agentdock.rpc.batchWith
import com.intellij.openapi.Disposable
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.platform.project.projectId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.time.Duration.Companion.seconds

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
    private val outbox = Channel<BridgeCommand>(Channel.UNLIMITED)

    /**
     * Completed by the backend's first acknowledgement. The backend registers the command handlers
     * only when the UI attaches, so a command that overtook the attachment was silently dropped and
     * the page waited for its settings forever.
     */
    private val attached = CompletableDeferred<Unit>()

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
        outbox.trySend(BridgeCommand(command, payload))
    }

    private suspend fun receiveRemote() {
        var reconnect = false
        while (scope.isActive) {
            try {
                AgentDockRpcApi.getInstance()
                    .uiMessages(project.projectId())
                    .collect { batch ->
                        attached.complete(Unit)
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
            delay(REMOTE_RECONNECT_DELAY)
        }
    }

    private suspend fun sendRemote() {
        attached.await()
        for (first in outbox) {
            try {
                AgentDockRpcApi.getInstance().invokeCommands(project.projectId(), outbox.batchWith(first))
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // Commands lost to a broken link are not worth retrying: the reload that follows
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

internal val REMOTE_RECONNECT_DELAY = 1.seconds
