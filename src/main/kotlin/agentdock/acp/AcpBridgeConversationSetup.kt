package agentdock.acp

import com.intellij.ui.jcef.JBCefJSQuery
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.*

private data class PermissionDecisionPayload(
    val requestId: String,
    val decision: String
)

private const val PROMPT_HEALTH_POLL_INTERVAL_MS = 5_000L
private const val CANCEL_REQUEST_TIMEOUT_MS = 10_000L

internal fun AcpBridge.pushConversationError(chatId: String, error: Throwable) {
    pushContentChunk(chatId, "assistant", "text", text = "[Error: ${formatAcpError(error)}]", isReplay = false)
}

internal fun AcpBridge.pushConversationError(chatId: String, message: String) {
    pushContentChunk(chatId, "assistant", "text", text = "[Error: $message]", isReplay = false)
}

internal fun AcpBridge.pushBridgeOperationResult(
    requestId: String?,
    chatId: String?,
    operation: String,
    ok: Boolean,
    error: String? = null
) {
    if (requestId.isNullOrBlank()) return
    pushBridgeOperationResult(
        BridgeOperationResultPayload(
            requestId = requestId,
            chatId = chatId.orEmpty(),
            operation = operation,
            ok = ok,
            error = error
        )
    )
}

private suspend fun AcpBridge.handleScopedConfigChange(
    chatId: String?,
    adapterId: String?,
    valueId: String?,
    kind: String,
    applyChange: suspend (String, String) -> Boolean
) {
    if (chatId == null || adapterId == null || valueId == null) return
    if (service.activeAdapterName(chatId) != adapterId) return

    pushStatus(chatId, "initializing")
    try {
        val ok = applyChange(chatId, valueId)
        if (!ok) {
            pushConversationError(chatId, "Failed to set $kind '$valueId'")
        } else {
            pushAdapters()
        }
    } catch (e: Exception) {
        pushConversationError(chatId, e)
    } finally {
        pushStatus(chatId, service.status(chatId).name.lowercase())
    }
}

private fun parsePermissionDecisionPayload(payload: String?): PermissionDecisionPayload? {
    return runCatching {
        val obj = Json.parseToJsonElement(payload ?: "{}").jsonObject
        val requestId = obj["requestId"]?.jsonPrimitive?.content?.trim().orEmpty()
        val decision = obj["decision"]?.jsonPrimitive?.content?.trim().orEmpty()
        if (requestId.isBlank() || decision.isBlank()) null else PermissionDecisionPayload(requestId, decision)
    }.getOrNull()
}

private fun AcpBridge.refreshDownloadedAdapterInitialization() {
    val target = AcpAdapterPaths.getExecutionTarget()
    AcpAdapterConfig.getAllAdapters().values.forEach { info ->
        if (!AcpAdapterPaths.isDownloaded(info.id, target)) return@forEach
        if (service.isAdapterReady(info.id)) return@forEach
        if (service.adapterInitializationStatus(info.id) == AcpClientService.AdapterInitializationStatus.Initializing) return@forEach
        service.initializeAdapterInBackground(info.id)
    }
}


internal fun AcpBridge.installConversationQueries() {
    startAgentQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            val parsed = parseStartRequestPayload(payload)
            val chatId = parsed.chatId
            val adapterName = parsed.adapterId
            val modelId = parsed.modelId
            if (chatId != null) {
                pushBridgeOperationResult(parsed.requestId, chatId, "start_agent", ok = true)
                scope.launch(Dispatchers.Default) {
                    pushStatus(chatId, "initializing")
                    try {
                        withTimeout(AcpBridge.START_AGENT_TIMEOUT_MS) {
                            service.startAgent(chatId, adapterName, modelId)
                        }
                        pushAdapters()
                        pushStatus(chatId, service.status(chatId).name.lowercase())
                        pushSessionId(chatId, service.sessionId(chatId))
                        pushMode(chatId, service.activeModeId(chatId))
                    } catch (e: Exception) {
                        pushStatus(chatId, "error")
                        pushContentChunk(chatId, "assistant", "text", text = "[Error: ${formatAcpError(e)}]", isReplay = false)
                    }
                }
            } else {
                pushBridgeOperationResult(parsed.requestId, null, "start_agent", ok = false, error = "Invalid start request.")
            }
            JBCefJSQuery.Response("ok")
        }
    }

    setModelQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            val (chatId, adapterId, modelId) = parseScopedIdPayload(payload, "modelId")
            scope.launch(Dispatchers.Default) {
                handleScopedConfigChange(chatId, adapterId, modelId, "model", service::setModel)
            }
            JBCefJSQuery.Response("ok")
        }
    }

    setModeQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            val (chatId, adapterId, modeId) = parseScopedIdPayload(payload, "modeId")
            scope.launch(Dispatchers.Default) {
                handleScopedConfigChange(chatId, adapterId, modeId, "mode", service::setMode)
            }
            JBCefJSQuery.Response("ok")
        }
    }

    listAdaptersQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler {
            scope.launch(Dispatchers.IO) {
                resetAuthStatusRefreshState()
                pushAdapters(includeRuntimeChecks = false)
                refreshDownloadedAdapterInitialization()
                scope.launch(Dispatchers.IO) {
                    pushAdapters(includeRuntimeChecks = true)
                }
            }
            JBCefJSQuery.Response("ok")
        }
    }

    sendPromptQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            val parsed = parseBlocksPayload(payload)
            val chatId = parsed.chatId
            val blocks = parsed.blocks
            if (chatId != null && blocks.isNotEmpty()) {
                val dispatchFailure = service.promptDispatchFailure(chatId)
                if (dispatchFailure != null) {
                    pushBridgeOperationResult(parsed.requestId, chatId, "send_prompt", ok = false, error = dispatchFailure)
                    scope.launch(Dispatchers.Default) {
                        service.markChatSessionBroken(chatId)
                        pushConversationError(chatId, dispatchFailure)
                        pushStatus(chatId, "error")
                        recoverRuntimeAfterFailure(dispatchFailure)
                    }
                    return@addHandler JBCefJSQuery.Response("ok")
                }

                pushBridgeOperationResult(parsed.requestId, chatId, "send_prompt", ok = true)
                val captureId = beginLivePromptCapture(chatId, parsed.rawBlocks)
                val job = scope.launch(Dispatchers.Default) {
                    pushStatus(chatId, "prompting")
                    try {
                        service.prompt(chatId, blocks).collect { event ->
                            when (event) {
                                is AcpEvent.PromptDone -> {
                                    val fallbackText = "[The AI agent ended the turn without providing a response.]"
                                    if (ensureLivePromptNoResponseFallback(chatId, fallbackText, captureId)) {
                                        pushContentChunk(chatId, "assistant", "text", text = fallbackText, isReplay = false)
                                    }
                                    flushLivePromptCapture(chatId, captureId)?.let {
                                        pushPromptDoneChunk(chatId, it, outcome = "success")
                                    }
                                    pushStatus(chatId, "ready")
                                }
                                is AcpEvent.Error -> {
                                    pushContentChunk(chatId, "assistant", "text", text = "[Error: ${event.message}]", isReplay = false)
                                    appendLivePromptTextEvent(chatId, "[Error: ${event.message}]", captureId)
                                    flushLivePromptCapture(chatId, captureId)?.let {
                                        pushPromptDoneChunk(chatId, it, outcome = "error")
                                    }
                                    pushStatus(chatId, "error")
                                }
                            }
                        }
                    } catch (e: kotlinx.coroutines.CancellationException) {
                        if (service.status(chatId) == AcpClientService.Status.Error) {
                            pushStatus(chatId, "error")
                        } else {
                            pushStatus(chatId, "ready")
                        }
                        throw e
                    } catch (e: Exception) {
                        val message = "[Error: ${formatAcpError(e)}]"
                        pushContentChunk(chatId, "assistant", "text", text = message, isReplay = false)
                        appendLivePromptTextEvent(chatId, message, captureId)
                        flushLivePromptCapture(chatId, captureId)?.let {
                            pushPromptDoneChunk(chatId, it, outcome = "error")
                        }
                        pushStatus(chatId, "error")
                    } finally {
                        promptJobs.remove(chatId)
                    }
                }
                val watcher = scope.launch(Dispatchers.Default) {
                    while (job.isActive) {
                        delay(PROMPT_HEALTH_POLL_INTERVAL_MS)
                        if (!job.isActive) break
                        if (service.status(chatId) != AcpClientService.Status.Prompting) break
                        val failure = service.promptDispatchFailure(chatId) ?: continue
                        val message = "[Error: $failure]"
                        service.markChatSessionBroken(chatId)
                        pushContentChunk(chatId, "assistant", "text", text = message, isReplay = false)
                        appendLivePromptTextEvent(chatId, message, captureId)
                        flushLivePromptCapture(chatId, captureId)?.let {
                            pushPromptDoneChunk(chatId, it, outcome = "error")
                        }
                        pushStatus(chatId, "error")
                        job.cancel(kotlinx.coroutines.CancellationException(failure))
                        recoverRuntimeAfterFailure(failure)
                        break
                    }
                }
                job.invokeOnCompletion {
                    watcher.cancel()
                }
                promptJobs[chatId] = job
            } else {
                pushBridgeOperationResult(parsed.requestId, chatId, "send_prompt", ok = false, error = "Invalid prompt request.")
            }
            JBCefJSQuery.Response("ok")
        }
    }

    cancelPromptQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            val parsed = parseCancelPayload(payload)
            val chatId = parsed.chatId.orEmpty()
            if (chatId.isNotEmpty()) {
                val dispatchFailure = service.cancelDispatchFailure(chatId)
                if (dispatchFailure != null) {
                    val message = "Cancel request could not be delivered. $dispatchFailure"
                    pushBridgeOperationResult(parsed.requestId, chatId, "cancel_prompt", ok = false, error = message)
                    scope.launch(Dispatchers.Default) {
                        service.markChatSessionBroken(chatId)
                        pushConversationError(chatId, message)
                        pushStatus(chatId, "error")
                        recoverRuntimeAfterFailure(message)
                    }
                    return@addHandler JBCefJSQuery.Response("ok")
                }

                pushBridgeOperationResult(parsed.requestId, chatId, "cancel_prompt", ok = true)
                scope.launch(Dispatchers.Default) {
                    try {
                        withTimeout(CANCEL_REQUEST_TIMEOUT_MS) {
                            service.cancel(chatId)
                        }
                        promptJobs[chatId]?.cancel()
                        pushContentChunk(chatId, "assistant", "text", text = "\n\n[Cancelled]\n\n", isReplay = false)
                        appendLivePromptTextEvent(chatId, "\n\n[Cancelled]\n\n")
                        flushLivePromptCapture(chatId)?.let {
                            pushPromptDoneChunk(chatId, it, outcome = "cancelled")
                        }
                        pushStatus(chatId, "ready")
                    } catch (e: Exception) {
                        val message = "Cancel request failed. ${formatAcpError(e)}"
                        service.markChatSessionBroken(chatId)
                        pushConversationError(chatId, message)
                        pushStatus(chatId, "error")
                        recoverRuntimeAfterFailure(message)
                    }
                }
            } else {
                pushBridgeOperationResult(parsed.requestId, parsed.chatId, "cancel_prompt", ok = false, error = "Invalid cancel request.")
            }
            JBCefJSQuery.Response("ok")
        }
    }

    installRuntimeRecoveryQuery()

    stopAgentQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { chatIdPayload ->
            val chatId = chatIdPayload?.trim().orEmpty()
            if (chatId.isNotEmpty()) {
                scope.launch(Dispatchers.Default) {
                    service.stopAgent(chatId)
                    livePromptCaptures.remove(chatId)
                    historyReplayCaptures.remove(chatId)
                }
            }
            JBCefJSQuery.Response("ok")
        }
    }

    respondPermissionQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            parsePermissionDecisionPayload(payload)?.let { request ->
                scope.launch(Dispatchers.Default) {
                    service.respondToPermissionRequest(request.requestId, request.decision)
                }
            }
            JBCefJSQuery.Response("ok")
        }
    }

    installConversationHistoryQueries()
}
