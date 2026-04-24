package agentdock.acp

import com.intellij.ui.jcef.JBCefJSQuery
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

private fun parseRecoverRuntimePayload(payload: String?): Pair<String?, String?> {
    return runCatching {
        val obj = Json.parseToJsonElement(payload ?: "{}").jsonObject
        val requestId = obj["requestId"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }
        val reason = obj["reason"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }
        requestId to reason
    }.getOrDefault(null to null)
}

internal fun AcpBridge.recoverRuntimeAfterFailure(reason: String) {
    promptJobs.values.forEach { it.cancel() }
    promptJobs.clear()
    livePromptCaptures.clear()
    historyReplayCaptures.clear()
    suppressReplayForChatIds.clear()

    val affectedChatIds = lastStatusByChatId
        .filterValues { status -> status == "prompting" || status == "initializing" }
        .keys
        .toList()

    affectedChatIds.forEach { chatId ->
        pushConversationError(chatId, "Plugin runtime recovered after ACP communication failed. Start a new prompt to continue.")
        pushStatus(chatId, "error")
    }

    service.recoverRuntime()
    pushAdapters(includeRuntimeChecks = false)
}

internal fun AcpBridge.installRuntimeRecoveryQuery() {
    recoverRuntimeQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            val (requestId, reason) = parseRecoverRuntimePayload(payload)
            scope.launch(Dispatchers.Default) {
                runCatching {
                    recoverRuntimeAfterFailure(reason ?: "Manual runtime recovery requested.")
                    pushBridgeOperationResult(requestId, "", "recover_runtime", ok = true)
                }.onFailure { error ->
                    pushBridgeOperationResult(requestId, "", "recover_runtime", ok = false, error = formatAcpError(error))
                }
            }
            JBCefJSQuery.Response("ok")
        }
    }
}
