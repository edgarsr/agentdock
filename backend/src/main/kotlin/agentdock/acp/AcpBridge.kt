package agentdock.acp

import agentdock.bridge.BridgeHost
import agentdock.utils.jsCallback
import com.intellij.openapi.application.ApplicationManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.sync.Mutex
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.time.Duration.Companion.seconds

internal class HistoryLoadMutexEntry {
    val mutex = Mutex()
    var references = 0
}

/**
 * Connects AcpClientService to the JCEF/React UI.
 * Handles: startAgent, sendPrompt, loadSession (from frontend);
 * pushes content chunks, status, adapters, permissions (to frontend).
 */
class AcpBridge(
    internal val host: BridgeHost,
    internal val service: AcpClientService,
    internal val scope: CoroutineScope
) {
    internal var fileIconProvider: FileIconProvider? = null
    /** The running file search; a new one cancels it, as only the latest one is shown. */
    @Volatile internal var fileSearchJob: Job? = null
    /** Runs undo requests one at a time, so two requests never restore the same file at once. */
    internal val undoMutex = Mutex()
    /**
     * Runs change-state reads and writes one at a time, in the order they arrived: each write
     * rewrites the whole saved state, so two at once would lose one of them.
     */
    internal val changesStateDispatcher = Dispatchers.IO.limitedParallelism(1)

    internal val promptJobs = ConcurrentHashMap<String, Job>()
    internal val lastStatusByChatId = ConcurrentHashMap<String, String>()
    internal val awaitingBackgroundOutput = ConcurrentHashMap<String, String>()
    internal val downloadStatuses = ConcurrentHashMap<String, String>()
    internal val adapterInstallJobs = ConcurrentHashMap<String, Job>()
    internal val adapterInstallCancellations = ConcurrentHashMap<String, AcpAdapterInstallCancellation>()
    internal val downloadProbeJobs = ConcurrentHashMap<String, Job>()
    internal val downloadProbeStates = ConcurrentHashMap<String, AdapterDownloadProbeState>()
    internal val authActionJobs = ConcurrentHashMap<String, Job>()
    internal val authActionMethodIds = ConcurrentHashMap<String, String>()
    internal val authErrors = ConcurrentHashMap<String, String>()
    internal val loginStatusJobs = ConcurrentHashMap<String, Job>()
    internal val completedLoginStatusRefreshes = ConcurrentHashMap.newKeySet<String>()
    internal val updateCheckJobs = ConcurrentHashMap<String, Job>()
    internal val latestVersionStates = ConcurrentHashMap<String, String>()
    internal val agentVersionJobs = ConcurrentHashMap<String, Job>()
    internal val agentVersionStates = ConcurrentHashMap<String, String>()
    internal val initialAdapterRefreshStarted = AtomicBoolean(false)
    /** Adapters being refreshed; true while their runtime checks are still being started. */
    internal val refreshingAdapters = ConcurrentHashMap<String, Boolean>()
    internal val livePromptCaptures = ConcurrentHashMap<String, LivePromptCapture>()
    /** Bumped each time a finished prompt reaches a chat's stored conversation; see [attachChat]. */
    internal val historyRevisions = ConcurrentHashMap<String, Long>()
    internal val chatDeliveryLocks = ConcurrentHashMap<String, Any>()
    internal val lateHistoryEventQueues = ConcurrentHashMap<String, Channel<LateHistoryEvent>>()
    internal val historyReplayCaptures = ConcurrentHashMap<String, HistoryReplayCapture>()
    internal val historyLoadMutexes = ConcurrentHashMap<String, HistoryLoadMutexEntry>()
    internal val replayFreshnessProbes = ConcurrentHashMap<String, ReplayFreshnessProbe>()
    internal val suppressReplayForChatIds: MutableSet<String> = ConcurrentHashMap.newKeySet()
    internal val todoToolCallKeys: MutableSet<String> = ConcurrentHashMap.newKeySet()
    // Tool calls whose output is never truncated; updates often omit the kind that identifies them.
    internal val fullOutputToolCallKeys: MutableSet<String> = ConcurrentHashMap.newKeySet()
    internal val emittedTodoPlanKeys: MutableSet<String> = ConcurrentHashMap.newKeySet()

    internal val cli = AcpBridgeCli(service.project, host::openTerminal)

    companion object {
        // The service owns the 300s adapter-initialization budget. Leave time
        // for session creation and preference application after it completes.
        val START_AGENT_TIMEOUT = 360.seconds
    }

    fun install() {
        installServiceCallbacks()
        installAdapterQueries()
        installConversationQueries()
        installFileChangeQueries()
        installMiscQueries()
        installFileIconQuery()
    }

    internal fun runOnEdt(action: () -> Unit) = ApplicationManager.getApplication().invokeLater(action)

    /**
     * Records and sends one of a chat's events, or ends its prompt, as one step relative to
     * [attachChat]: a UI taking the chat over then receives each event either in its snapshot or
     * after it, never twice and never not at all. Apart from storing a finished prompt, only
     * in-memory work runs inside: the session updates of all chats of an adapter pass through one
     * queue, which a waiting update holds up.
     */
    internal inline fun <T> withChatDelivery(chatId: String, action: () -> T): T =
        synchronized(chatDeliveryLocks.computeIfAbsent(chatId) { Any() }) { action() }

    internal fun dispatchContentChunkJson(json: String) {
        if (!host.isAttached) return
        host.eval(jsCallback("__onContentChunk", json))
    }
}
