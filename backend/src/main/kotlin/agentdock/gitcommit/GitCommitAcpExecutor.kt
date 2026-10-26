package agentdock.gitcommit

import com.agentclientprotocol.client.ClientSession
import com.agentclientprotocol.client.ClientOperationsFactory
import com.agentclientprotocol.common.ClientSessionOperations
import com.agentclientprotocol.common.Event
import com.agentclientprotocol.common.SessionCreationParameters
import com.agentclientprotocol.model.ContentBlock
import com.agentclientprotocol.model.PermissionOption
import com.agentclientprotocol.model.RequestPermissionOutcome
import com.agentclientprotocol.model.RequestPermissionResponse
import com.agentclientprotocol.model.SessionUpdate
import com.intellij.openapi.project.Project
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonElement
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import agentdock.acp.AcpAdapterPaths
import agentdock.acp.AcpClientService
import agentdock.acp.applySessionConfigOptions
import agentdock.acp.awaitPendingSessionUpdates
import agentdock.acp.ensureSharedProcessStarted
import agentdock.acp.findReasoningEffortOption
import agentdock.acp.resolveModelToApply
import agentdock.acp.serializeContentBlock
import agentdock.history.AgentDockHistoryService
import kotlin.time.Duration.Companion.minutes

internal class GitCommitAcpExecutor(
    private val project: Project,
    private val acpService: AcpClientService = AcpClientService.getInstance(project)
) {
    companion object {
        private val GENERATION_TIMEOUT = 2.minutes
    }

    suspend fun generateMessage(
        config: GitCommitGenerationConfig,
        prompt: String,
    ): String = withContext(Dispatchers.IO) {

        val adapterInfo = AcpAdapterPaths.getAdapterInfo(config.adapterId)
        val sharedProcess = acpService.activeProcesses.computeIfAbsent(adapterInfo.id) {
            acpService.createSharedProcess(adapterInfo.id)
        }
        acpService.ensureSharedProcessStarted(sharedProcess, adapterInfo)

        val client = sharedProcess.client ?: error("ACP client is not initialized for ${adapterInfo.id}")
        val cwd = project.basePath ?: System.getProperty("user.dir")
        val runtimeMetadata = acpService.adapterRuntimeMetadata(adapterInfo.id)
        val selectedModelId = resolveModelToApply(
            config.modelId,
            runtimeMetadata?.availableModels ?: emptyList(),
            runtimeMetadata?.currentModelId
        )
        val blockedPermissionTitles = ConcurrentLinkedQueue<String>()

        var ephemeralSessionId: String? = null
        var session: ClientSession? = null
        val commitChatId = "git-commit:${UUID.randomUUID()}"
        try {
            val factory = ClientOperationsFactory { sessionId, _ ->
                ephemeralSessionId = sessionId.value
                acpService.bindLiveSessionOwner(commitChatId, sessionId.value)
                object : ClientSessionOperations {
                    override suspend fun requestPermissions(
                        toolCall: SessionUpdate.ToolCallUpdate,
                        permissions: List<PermissionOption>,
                        _meta: JsonElement?
                    ): RequestPermissionResponse {
                        toolCall.title?.takeIf { it.isNotBlank() }?.let(blockedPermissionTitles::add)
                        return RequestPermissionResponse(RequestPermissionOutcome.Cancelled)
                    }

                    override suspend fun notify(notification: SessionUpdate, _meta: JsonElement?) {
                    }
                }
            }

            val responseText = StringBuilder()
            try {
                // Covers the session setup too: the SDK has no request timeout, and an agent without network
                // access may never answer session/new or session/set_config_option.
                withTimeout(GENERATION_TIMEOUT) {
                    val newSession = client.newSession(
                        SessionCreationParameters(cwd = cwd, mcpServers = emptyList()),
                        factory
                    ).also { session = it }
                    ephemeralSessionId = newSession.sessionId.value
                    AgentDockHistoryService.registerEphemeralSession(project.basePath, adapterInfo.id, newSession.sessionId.value)

                    val metadata = runtimeMetadata ?: AcpClientService.AdapterRuntimeMetadata(emptyList())
                    val preferredValues = buildMap {
                        metadata.modelConfigId?.let { id -> selectedModelId?.let { put(id, it) } }
                        metadata.configOptions.findReasoningEffortOption()?.let { option ->
                            config.reasoningEffortId.trim().takeIf(String::isNotEmpty)?.let { put(option.id, it) }
                        }
                    }
                    // The context is not registered as a chat, so applying options publishes nothing to the UI.
                    val context = acpService.createAgentContext(commitChatId).also {
                        it.session = newSession
                        it.sharedProcess = sharedProcess
                        it.sessionIdRef.set(newSession.sessionId.value)
                        it.runtimeMetadataRef.set(metadata)
                    }
                    if (!acpService.applySessionConfigOptions(context, adapterInfo.id, preferredValues)) {
                        error("Failed to apply session config options")
                    }

                    newSession.prompt(listOf(ContentBlock.Text(prompt))).collect { event ->
                        if (event is Event.SessionUpdateEvent) {
                            appendVisibleAssistantText(responseText, event.update)
                        }
                    }
                    acpService.awaitPendingSessionUpdates(adapterInfo.id)
                }
            } catch (_: TimeoutCancellationException) {
                withContext(NonCancellable) {
                    runCatching { session?.cancel() }
                    runCatching { acpService.awaitPendingSessionUpdates(adapterInfo.id) }
                }
                error("Commit message generation timed out after 2 minutes. You can write the message manually.")
            }

            val parsed = GitCommitResponseParser.parse(responseText.toString())
            if (parsed.isBlank()) {
                val blockedAction = blockedPermissionTitles.firstOrNull()
                if (!blockedAction.isNullOrBlank()) {
                    error("AI requested a restricted action ($blockedAction) and did not return a commit message.")
                }
                error("AI returned an empty commit message.")
            }
            parsed
        } finally {
            acpService.bindLiveSessionOwner(commitChatId, null)
            val sessionId = ephemeralSessionId
            val projectBasePath = project.basePath
            val adapterId = adapterInfo.id
            if (!sessionId.isNullOrBlank()) {
                acpService.scope.launch {
                    // A session that cannot be deleted yet stays registered and the history sync retries it.
                    val deleted = runCatching {
                        AgentDockHistoryService.deleteSessionImmediately(projectBasePath, sessionId, adapterId)
                    }.getOrDefault(false)
                    if (deleted) {
                        AgentDockHistoryService.removeEphemeralSession(projectBasePath, adapterId, sessionId)
                    }
                }
            }
        }
    }

    private fun appendVisibleAssistantText(buffer: StringBuilder, update: SessionUpdate) {
        val content = when (update) {
            is SessionUpdate.AgentMessageChunk -> update.content
            else -> null
        } ?: return

        val serialized = serializeContentBlock(content) ?: return
        if (serialized.type == "text" && !serialized.text.isNullOrBlank()) {
            buffer.append(serialized.text)
        }
    }
}
