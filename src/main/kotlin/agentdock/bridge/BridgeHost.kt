package agentdock.bridge

import agentdock.acp.AcpClientService
import agentdock.acp.AcpQuotaService
import agentdock.gitcommit.GitCommitAcpExecutor
import agentdock.gitcommit.GitCommitGenerationSettingsFacade
import agentdock.gitcommit.GitCommitPromptBuilder
import agentdock.rpc.LocalBridgeHost
import agentdock.rpc.NativeState
import agentdock.rpc.TerminalLaunchRequest
import agentdock.rpc.UiMessage
import agentdock.settings.GlobalSettings
import agentdock.settings.GlobalSettingsStore
import com.intellij.openapi.Disposable
import com.intellij.openapi.project.Project
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.util.concurrent.ConcurrentHashMap

/**
 * The backend half of the bridge: the commands the UI can call, and the messages the backend
 * pushes back into it.
 *
 * There is exactly one attached UI at a time. Attaching decides how messages travel: monolithic
 * IDEs hand over a direct callback, Split Mode collects [attachRemote]. Nothing else in the backend
 * knows or cares which of the two is in use.
 */

class BridgeHost(private val project: Project, private val scope: CoroutineScope) : LocalBridgeHost {

    /**
     * Handlers stay non-suspending on purpose: every bridge handler used to be a
     * `JBCefJSQuery.addHandler` block that starts its own coroutine when it needs one, and this
     * keeps those bodies unchanged.
     */
    private val commands = ConcurrentHashMap<String, (String) -> Unit>()
    private val nativeState = MutableStateFlow(NativeState())

    @Volatile
    private var attachment: Attachment? = null

    init {
        scope.launch(Dispatchers.IO) {
            updateSettings(GlobalSettingsStore.load())
        }
        scope.launch {
            AcpQuotaService.getInstance().quotas.collect { quotas ->
                nativeState.update { it.copy(quotas = quotas.values.toList()) }
            }
        }
    }

    fun register(name: String, handler: (String) -> Unit) {
        commands[name] = handler
    }

    /** Runs a bridge command. Unknown names are ignored: an older UI may call a command that no longer exists. */
    override fun invokeCommand(command: String, payload: String) {
        val handler = commands[command] ?: return
        runCatching { handler(payload) }
    }

    val isAttached: Boolean
        get() = attachment != null

    /** Queues JavaScript for the attached UI. Dropped when no UI is attached, exactly as a disposed browser used to drop it. */
    fun eval(js: String) {
        attachment?.send(UiMessage(UiMessage.TOPIC_JS, js))
    }

    fun openTerminal(request: TerminalLaunchRequest) {
        attachment?.send(UiMessage(UiMessage.TOPIC_TERMINAL, Json.encodeToString(request)))
    }

    fun updateSettings(settings: GlobalSettings) {
        nativeState.update { it.copy(settings = settings) }
    }

    override fun nativeState(): Flow<NativeState> = nativeState.asStateFlow()

    override suspend fun generateGitCommitMessage(selectedPaths: List<String>): String {
        val config = GitCommitGenerationSettingsFacade.resolve(project)
            ?: error("Git commit generation is disabled or not configured.")
        val prompt = GitCommitPromptBuilder.build(project, selectedPaths, config.instructions)
        return GitCommitAcpExecutor(project, AcpClientService.getInstance(project)).generateMessage(config, prompt)
    }

    /**
     * Monolithic IDE. [consume] is the browser call itself, so a message reaches JCEF through one
     * virtual call - no serialization, no coroutine, no buffering.
     */
    override fun attachLocal(consume: (UiMessage) -> Unit): Disposable = attach(LocalAttachment(consume))

    /**
     * Split Mode. Messages are queued and handed over in batches: whatever piles up while the
     * previous batch is in flight is delivered as one, so a fast agent costs round trips
     * proportional to network latency rather than to token count.
     */
    fun attachRemote(): Flow<List<UiMessage>> = flow {
        val remote = RemoteAttachment()
        val registration = attach(remote)
        try {
            // An empty first batch is the connection acknowledgement. It lets the frontend reload
            // only after a broken RPC link has actually reconnected, instead of reloading once per
            // retry while the backend is still unavailable.
            emit(emptyList())
            while (true) {
                emit(remote.takeBatch())
            }
        } finally {
            registration.dispose()
        }
    }

    private fun attach(next: Attachment): Disposable {
        attachment?.close()
        attachment = next
        val bridges = AgentDockBridges.install(project, this, scope)
        next.send(UiMessage(UiMessage.TOPIC_FRONTEND_CAPABILITIES, ""))
        return Disposable {
            if (attachment === next) attachment = null
            next.close()
            bridges.dispose()
        }
    }

    private interface Attachment {
        fun send(message: UiMessage)
        fun close()
    }

    private class LocalAttachment(private val consume: (UiMessage) -> Unit) : Attachment {
        override fun send(message: UiMessage) = consume(message)
        override fun close() = Unit
    }

    private class RemoteAttachment : Attachment {
        private val queue = Channel<UiMessage>(Channel.UNLIMITED)

        override fun send(message: UiMessage) {
            queue.trySend(message)
        }

        override fun close() {
            queue.close()
        }

        /** Suspends for the first message, then takes everything already queued behind it. */
        suspend fun takeBatch(): List<UiMessage> {
            val batch = ArrayList<UiMessage>()
            batch.add(queue.receive())
            while (true) {
                batch.add(queue.tryReceive().getOrNull() ?: break)
            }
            return batch
        }
    }

    companion object {
        /**
         * The service is registered under [LocalBridgeHost] so that the frontend module can look it
         * up without seeing this class. Backend callers need the full surface, so the cast is done
         * here once instead of at every call site.
         */
        fun getInstance(project: Project): BridgeHost =
            project.getService(LocalBridgeHost::class.java) as BridgeHost
    }
}
