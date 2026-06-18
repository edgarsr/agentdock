package agentdock.gitcommit

import com.agentclientprotocol.client.ClientSession
import com.agentclientprotocol.client.ClientOperationsFactory
import com.agentclientprotocol.common.ClientSessionOperations
import com.agentclientprotocol.common.Event
import com.agentclientprotocol.common.SessionCreationParameters
import com.agentclientprotocol.model.ContentBlock
import com.agentclientprotocol.model.ModelId
import com.agentclientprotocol.model.PermissionOption
import com.agentclientprotocol.model.RequestPermissionOutcome
import com.agentclientprotocol.model.RequestPermissionResponse
import com.agentclientprotocol.model.SessionId
import com.agentclientprotocol.model.SessionUpdate
import com.intellij.openapi.project.Project
import com.intellij.openapi.vcs.changes.Change
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonElement
import java.util.concurrent.ConcurrentLinkedQueue
import agentdock.acp.AcpAdapterPaths
import agentdock.acp.AcpClientService
import agentdock.acp.awaitPendingSessionUpdates
import agentdock.acp.ensureExecutionTargetCurrent
import agentdock.acp.ensureSharedProcessStarted
import agentdock.acp.processKey
import agentdock.acp.resolveModelToApply
import agentdock.acp.resolveSessionCwd
import agentdock.acp.serializeContentBlock
import agentdock.history.AgentDockHistoryService
import com.agentclientprotocol.annotations.UnstableApi
import com.agentclientprotocol.model.AcpCreatedSessionResponse
import java.util.UUID

internal class GitCommitAcpExecutor(
    private val project: Project,
    private val acpService: AcpClientService = AcpClientService.getInstance(project)
) {
    companion object {
        private const val GENERATION_TIMEOUT_MS = 120_000L
    }

    @OptIn(UnstableApi::class)
    suspend fun generateMessage(
        config: GitCommitGenerationConfig,
        changes: Collection<Change>
    ): String = withContext(Dispatchers.IO) {
        acpService.ensureExecutionTargetCurrent()

        val adapterInfo = AcpAdapterPaths.getAdapterInfo(config.adapterId)
        val sharedProcess = acpService.activeProcesses.computeIfAbsent(acpService.processKey(adapterInfo.id)) {
            acpService.createSharedProcess(adapterInfo.id)
        }
        acpService.ensureSharedProcessStarted(sharedProcess, adapterInfo)

        val client = sharedProcess.client ?: error("ACP client is not initialized for ${adapterInfo.id}")
        val cwd = acpService.resolveSessionCwd(project.basePath ?: System.getProperty("user.dir"))
        val prompt = GitCommitPromptBuilder.build(changes, config.instructions)
        val runtimeMetadata = acpService.adapterRuntimeMetadata(adapterInfo.id)
        val selectedModelId = acpService.resolveModelToApply(
            config.modelId,
            runtimeMetadata?.availableModels ?: emptyList(),
            runtimeMetadata?.currentModelId
        )
        val blockedPermissionTitles = ConcurrentLinkedQueue<String>()

        var ephemeralSessionId: String? = null
        var session: ClientSession?
        val commitChatId = "git-commit:${UUID.randomUUID()}"
        try {
            val factory = object : ClientOperationsFactory {
                override suspend fun createClientOperations(
                    sessionId: SessionId,
                    sessionResponse: AcpCreatedSessionResponse
                ): ClientSessionOperations {
                    ephemeralSessionId = sessionId.value
                    acpService.bindLiveSessionOwner(commitChatId, sessionId.value)
                    return object : ClientSessionOperations {
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
            }

            session = client.newSession(
                SessionCreationParameters(cwd = cwd, mcpServers = emptyList()),
                factory
            )
            ephemeralSessionId = session.sessionId.value
            AgentDockHistoryService.registerEphemeralSession(project.basePath, adapterInfo.id, ephemeralSessionId)

            if (!selectedModelId.isNullOrBlank()) {
                runCatching { session.setModel(ModelId(selectedModelId)) }
            }

            val responseText = StringBuilder()
            try {
                withTimeout(GENERATION_TIMEOUT_MS) {
                    session.prompt(listOf(ContentBlock.Text(prompt))).collect { event ->
                        if (event is Event.SessionUpdateEvent) {
                            appendVisibleAssistantText(responseText, event.update)
                        }
                    }
                    acpService.awaitPendingSessionUpdates(adapterInfo.id)
                }
            } catch (_: TimeoutCancellationException) {
                withContext(NonCancellable) {
                    runCatching { session.cancel() }
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
                    runCatching {
                        AgentDockHistoryService.deleteSessionImmediately(projectBasePath, sessionId, adapterId)
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
