package agentdock.history

import agentdock.bridge.BridgeHost
import com.intellij.openapi.project.Project
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import agentdock.utils.jsCallback
import agentdock.utils.jsStringLiteral

private val permissiveJson = Json {
    ignoreUnknownKeys = true
    isLenient = true
}

class HistoryBridge(
    private val host: BridgeHost,
    private val project: Project,
    private val scope: CoroutineScope,
    private val closeConversation: suspend (String) -> Unit
) {
    @Serializable
    private data class DeleteHistoryPayload(
        val projectPath: String,
        val conversationIds: List<String>
    )

    @Serializable
    private data class UpdateHistoryPayload(
        val projectPath: String,
        val conversationIds: List<String>,
        val newTitle: String? = null,
        val pinned: Boolean? = null,
        val archived: Boolean? = null,
        val group: String? = null
    )

    @Serializable
    private data class RenameHistoryGroupPayload(
        val projectPath: String,
        val group: String,
        val newGroup: String
    )

    @Serializable
    private data class SearchHistoryPayload(
        val projectPath: String,
        val conversationIds: List<String>,
        val query: String
    )

    @Serializable
    private data class SearchHistoryResultPayload(
        val query: String,
        val snippets: Map<String, String>
    )

    @Serializable
    private data class DeleteHistoryResultPayload(
        val success: Boolean,
        val requestedConversationIds: List<String>,
        val failures: List<DeleteConversationFailure> = emptyList()
    )

    fun install() {
        val defaultProjectPath = project.basePath ?: System.getProperty("user.dir")
        val canonicalProjectPath = canonicalHistoryProjectPath(defaultProjectPath)

        scope.launch(Dispatchers.Default, start = CoroutineStart.UNDISPATCHED) {
            HistorySyncService.backgroundSyncCompletions.collect { projectPath ->
                if (projectPath != canonicalProjectPath) return@collect
                try {
                    val history = AgentDockHistoryService.getHistoryList(projectPath)
                    pushHistoryList(permissiveJson.encodeToString(history))
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    sendJsError("Failed to list history after background sync: ${e.message}")
                }
            }
        }

        host.register("requestHistoryList") { payload ->
            val projectPath = payload.trim().takeUnless { it.isEmpty() || it == "undefined" } ?: defaultProjectPath
            scope.launch(Dispatchers.Default) {
                try {
                    val history = AgentDockHistoryService.getHistoryList(projectPath)
                    pushHistoryList(permissiveJson.encodeToString(history))
                } catch (e: Exception) {
                    // An empty list, so the views waiting for the history do not wait forever.
                    pushHistoryList("[]")
                    sendJsError("Failed to list history: ${e.message}")
                }
            }
        }

        host.register("syncHistoryList") { payload ->
            val projectPath = payload.trim().takeUnless { it.isEmpty() || it == "undefined" } ?: defaultProjectPath
            scope.launch(Dispatchers.Default) {
                try {
                    val history = AgentDockHistoryService.syncAndGetHistoryList(projectPath)
                    pushHistoryList(permissiveJson.encodeToString(history))
                } catch (e: Exception) {
                    sendJsError("Failed to sync history: ${e.message}")
                }
            }
        }

        host.register("deleteHistoryConversations") { payload ->
            if (payload.isBlank()) return@register

            scope.launch(Dispatchers.Default) {
                try {
                    val request = permissiveJson.decodeFromString<DeleteHistoryPayload>(payload)
                    val closeFailures = mutableListOf<DeleteConversationFailure>()
                    val deletableConversationIds = request.conversationIds.distinct().filter { conversationId ->
                        try {
                            closeConversation(conversationId)
                            true
                        } catch (e: Exception) {
                            if (e is CancellationException && e !is TimeoutCancellationException) throw e
                            closeFailures.add(
                                DeleteConversationFailure(
                                    conversationId = conversationId,
                                    message = "Failed to close chat before deletion: ${e.message ?: e.toString()}"
                                )
                            )
                            false
                        }
                    }
                    val result = AgentDockHistoryService.deleteConversations(
                        request.projectPath,
                        deletableConversationIds
                    )
                    val failures = closeFailures + result.failures
                    val history = AgentDockHistoryService.getHistoryList(request.projectPath)
                    pushHistoryList(permissiveJson.encodeToString(history))
                    pushDeleteResult(
                        DeleteHistoryResultPayload(
                            success = closeFailures.isEmpty() && result.success,
                            requestedConversationIds = request.conversationIds,
                            failures = failures
                        )
                    )
                } catch (e: Exception) {
                    val request = runCatching { permissiveJson.decodeFromString<DeleteHistoryPayload>(payload) }.getOrNull()
                    if (request != null) {
                        pushDeleteResult(
                            DeleteHistoryResultPayload(
                                success = false,
                                requestedConversationIds = request.conversationIds,
                                failures = request.conversationIds.map { conversationId ->
                                    DeleteConversationFailure(
                                        conversationId = conversationId,
                                        message = "Error during deletion: ${e.message ?: e.toString()}"
                                    )
                                }
                            )
                        )
                    }
                    sendJsError("Error during deletion: ${e.message}")
                }
            }
        }

        host.register("updateHistoryConversations") { payload ->
            if (payload.isBlank()) return@register

            scope.launch(Dispatchers.Default) {
                var failedRequest: UpdateHistoryPayload? = null
                try {
                    val request = permissiveJson.decodeFromString<UpdateHistoryPayload>(payload)
                    failedRequest = request
                    val success = AgentDockHistoryService.updateConversations(
                        request.projectPath,
                        request.conversationIds,
                        request.newTitle,
                        request.pinned,
                        request.archived,
                        request.group
                    )
                    val history = AgentDockHistoryService.getHistoryList(request.projectPath)
                    pushHistoryList(permissiveJson.encodeToString(history))
                    if (success) {
                        return@launch
                    }
                    sendJsError("Failed to update conversation")
                } catch (e: Exception) {
                    failedRequest?.let { request ->
                        runCatching {
                            val history = AgentDockHistoryService.getHistoryList(request.projectPath)
                            pushHistoryList(permissiveJson.encodeToString(history))
                        }
                    }
                    sendJsError("Error during conversation update: ${e.message}")
                }
            }
        }

        host.register("searchHistoryConversations") { payload ->
            if (payload.isBlank()) return@register

            scope.launch(Dispatchers.IO) {
                try {
                    val request = permissiveJson.decodeFromString<SearchHistoryPayload>(payload)
                    val snippets = HistoryReplayStore.searchConversations(
                        canonicalHistoryProjectPath(request.projectPath),
                        request.conversationIds,
                        request.query
                    )
                    val result = permissiveJson.encodeToString(SearchHistoryResultPayload(request.query, snippets))
                    host.eval(jsCallback("__onHistorySearchResult", "JSON.parse(${result.jsStringLiteral()})"))
                } catch (e: Exception) {
                    sendJsError("Error during history search: ${e.message}")
                }
            }
        }

        host.register("renameHistoryGroup") { payload ->
            if (payload.isBlank()) return@register

            scope.launch(Dispatchers.Default) {
                try {
                    val request = permissiveJson.decodeFromString<RenameHistoryGroupPayload>(payload)
                    val success = AgentDockHistoryService.renameGroup(request.projectPath, request.group, request.newGroup)
                    pushHistoryList(permissiveJson.encodeToString(AgentDockHistoryService.getHistoryList(request.projectPath)))
                    if (!success) sendJsError("Failed to rename group")
                } catch (e: Exception) {
                    sendJsError("Error during group rename: ${e.message}")
                }
            }
        }
    }

    private fun pushHistoryList(jsonArray: String) {
        val escaped = jsonArray.jsStringLiteral()
        host.eval(jsCallback("__onHistoryList", "JSON.parse($escaped)"))
    }

    private fun pushDeleteResult(result: DeleteHistoryResultPayload) {
        val escaped = permissiveJson.encodeToString(result).jsStringLiteral()
        host.eval(jsCallback("__onHistoryDeleteResult", "JSON.parse($escaped)"))
    }

    private fun sendJsError(msg: String) {
        host.eval("console.error('[HistoryBridge] ' + ${msg.jsStringLiteral()});")
    }
}
