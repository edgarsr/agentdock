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
import com.agentclientprotocol.model.SessionId
import com.agentclientprotocol.model.SessionUpdate
import com.intellij.openapi.diagnostic.Logger
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
import agentdock.acp.AcpAdapterConfig
import agentdock.acp.AcpAdapterPaths
import agentdock.acp.AcpClientService
import agentdock.acp.awaitPendingSessionUpdates
import agentdock.acp.ensureExecutionTargetCurrent
import agentdock.acp.ensureSharedProcessStarted
import agentdock.acp.findReasoningEffortOption
import agentdock.acp.processKey
import agentdock.acp.resolveModelToApply
import agentdock.acp.resolveSessionCwd
import agentdock.acp.runtimeMetadataFromSetConfigOptionResponseJson
import agentdock.acp.serializeContentBlock
import agentdock.acp.setSessionConfigOptionRaw
import agentdock.acp.storeFreshAdapterRuntimeMetadata
import agentdock.history.AgentDockHistoryService
import com.agentclientprotocol.annotations.UnstableApi
import com.agentclientprotocol.model.AcpCreatedSessionResponse
import com.agentclientprotocol.protocol.Protocol

internal class GitCommitAcpExecutor(
    private val project: Project,
    private val acpService: AcpClientService = AcpClientService.getInstance(project)
) {
    companion object {
        private val log = Logger.getInstance(GitCommitAcpExecutor::class.java)
        private const val GENERATION_TIMEOUT_MS = 120_000L
    }

    @OptIn(UnstableApi::class)
    suspend fun generateMessage(
        config: GitCommitGenerationConfig,
        prompt: String,
    ): String = withContext(Dispatchers.IO) {
        acpService.ensureExecutionTargetCurrent()

        val adapterInfo = AcpAdapterPaths.getAdapterInfo(config.adapterId)
        val sharedProcess = acpService.activeProcesses.computeIfAbsent(acpService.processKey(adapterInfo.id)) {
            acpService.createSharedProcess(adapterInfo.id)
        }
        acpService.ensureSharedProcessStarted(sharedProcess, adapterInfo)

        val client = sharedProcess.client ?: error("ACP client is not initialized for ${adapterInfo.id}")
        val cwd = acpService.resolveSessionCwd(project.basePath ?: System.getProperty("user.dir"))
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

            applyConfiguration(
                session = session,
                protocol = sharedProcess.protocol,
                sharedProcess = sharedProcess,
                adapterInfo = adapterInfo,
                initialMetadata = runtimeMetadata ?: AcpClientService.AdapterRuntimeMetadata(emptyList()),
                selectedModelId = selectedModelId,
                selectedReasoningEffortId = config.reasoningEffortId,
            )

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
                    }.onSuccess { deleted ->
                        if (deleted) {
                            AgentDockHistoryService.removeEphemeralSession(projectBasePath, adapterId, sessionId)
                        } else {
                            log.warn("Failed to delete ephemeral git commit history session $adapterId:$sessionId")
                        }
                    }.onFailure { error ->
                        log.warn("Error while deleting ephemeral git commit history session $adapterId:$sessionId", error)
                    }
                }
            }
        }
    }

    @OptIn(UnstableApi::class)
    private suspend fun applyConfiguration(
        session: ClientSession,
        protocol: Protocol?,
        sharedProcess: AcpClientService.SharedProcess,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        initialMetadata: AcpClientService.AdapterRuntimeMetadata,
        selectedModelId: String?,
        selectedReasoningEffortId: String,
    ) {
        var metadata = initialMetadata
        if (!selectedModelId.isNullOrBlank()) {
            val configId = metadata.modelConfigId
            if (configId == null) {
                if (selectedModelId != metadata.currentModelId) {
                    error("ACP adapter '${adapterInfo.id}' does not provide a model config option")
                }
            } else {
                val activeProtocol = protocol
                    ?: error("ACP protocol is not initialized for ${adapterInfo.id}")
                val response = activeProtocol.setSessionConfigOptionRaw(
                    session.sessionId.value,
                    configId,
                    selectedModelId,
                )
                sharedProcess.markConfigMutated()
                metadata = runtimeMetadataFromSetConfigOptionResponseJson(response, adapterInfo)
                acpService.storeFreshAdapterRuntimeMetadata(adapterInfo, metadata)
            }
        }

        val effortId = selectedReasoningEffortId.trim().takeIf(String::isNotEmpty) ?: return
        val effortOption = metadata.configOptions.findReasoningEffortOption() ?: return
        if (!effortOption.accepts(effortId)) return

        val activeProtocol = protocol
            ?: error("ACP protocol is not initialized for ${adapterInfo.id}")
        val response = activeProtocol.setSessionConfigOptionRaw(
            session.sessionId.value,
            effortOption.id,
            effortId,
            effortOption.type,
        )
        sharedProcess.markConfigMutated()
        acpService.storeFreshAdapterRuntimeMetadata(
            adapterInfo,
            runtimeMetadataFromSetConfigOptionResponseJson(response, adapterInfo),
        )
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
