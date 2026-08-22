package agentdock.history

import agentdock.bridge.BridgeHost
import com.intellij.openapi.project.Project
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import agentdock.utils.jsStringLiteral

private val permissiveJson = Json {
    ignoreUnknownKeys = true
    isLenient = true
}

class HistoryBridge(
    private val host: BridgeHost,
    private val project: Project,
    private val scope: CoroutineScope
) {
    @Serializable
    private data class DeleteHistoryPayload(
        val projectPath: String,
        val conversationIds: List<String>
    )

    @Serializable
    private data class RenameHistoryPayload(
        val projectPath: String,
        val conversationId: String,
        val newTitle: String
    )

    @Serializable
    private data class DeleteHistoryResultPayload(
        val success: Boolean,
        val requestedConversationIds: List<String>,
        val failures: List<DeleteConversationFailure> = emptyList()
    )

    fun install() {
        val defaultProjectPath = project.basePath ?: System.getProperty("user.dir")

        host.register("requestHistoryList") { payload ->
            val projectPath = payload.trim().takeUnless { it.isEmpty() || it == "undefined" } ?: defaultProjectPath
            scope.launch(Dispatchers.Default) {
                try {
                    val history = AgentDockHistoryService.getHistoryList(projectPath)
                    pushHistoryList(permissiveJson.encodeToString(history))
                } catch (e: Exception) {
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
                    val result = AgentDockHistoryService.deleteConversations(request.projectPath, request.conversationIds)
                    val history = AgentDockHistoryService.getHistoryList(request.projectPath)
                    pushHistoryList(permissiveJson.encodeToString(history))
                    pushDeleteResult(
                        DeleteHistoryResultPayload(
                            success = result.success,
                            requestedConversationIds = request.conversationIds,
                            failures = result.failures
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

        host.register("renameHistoryConversation") { payload ->
            if (payload.isBlank()) return@register

            scope.launch(Dispatchers.Default) {
                try {
                    val request = permissiveJson.decodeFromString<RenameHistoryPayload>(payload)
                    val success = AgentDockHistoryService.renameConversation(request.projectPath, request.conversationId, request.newTitle)
                    if (success) {
                        val history = AgentDockHistoryService.getHistoryList(request.projectPath)
                        pushHistoryList(permissiveJson.encodeToString(history))
                    } else {
                        sendJsError("Failed to rename conversation")
                    }
                } catch (e: Exception) {
                    sendJsError("Error during rename: ${e.message}")
                }
            }
        }
    }

    private fun pushHistoryList(jsonArray: String) {
        val escaped = jsonArray.jsStringLiteral()
        host.eval("if(window.__onHistoryList) window.__onHistoryList(JSON.parse($escaped));")
    }

    private fun pushDeleteResult(result: DeleteHistoryResultPayload) {
        val escaped = permissiveJson.encodeToString(result).jsStringLiteral()
        host.eval("if(window.__onHistoryDeleteResult) window.__onHistoryDeleteResult(JSON.parse($escaped));")
    }

    private fun sendJsError(msg: String) {
        host.eval("console.error('[HistoryBridge] ' + ${msg.jsStringLiteral()});")
    }
}
