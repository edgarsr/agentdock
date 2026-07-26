package agentdock.acp

import com.intellij.ui.jcef.JBCefJSQuery
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.*

private data class PermissionDecisionPayload(
    val requestId: String,
    val decision: String
)

private const val PROMPT_HEALTH_POLL_INTERVAL_MS = 5_000L
private const val CANCEL_REQUEST_TIMEOUT_MS = 10_000L
private const val CANCELLED_PROMPT_RESPONSE_TIMEOUT_MS = 10_000L
private const val PREVIOUS_PROMPT_SETTLE_TIMEOUT_MS = 30_000L

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

private fun parsePermissionDecisionPayload(payload: String?): PermissionDecisionPayload? {
    return runCatching {
        val obj = Json.parseToJsonElement(payload ?: "{}").jsonObject
        val requestId = obj["requestId"]?.jsonPrimitive?.content?.trim().orEmpty()
        val decision = obj["decision"]?.jsonPrimitive?.content?.trim().orEmpty()
        if (requestId.isBlank() || decision.isBlank()) null else PermissionDecisionPayload(requestId, decision)
    }.getOrNull()
}

internal fun AcpBridge.startInitialAdapterRefresh() {
    if (!initialAdapterRefreshStarted.compareAndSet(false, true)) {
        pushAdapterRefreshState(fullAdapterRefreshInProgress.get())
        scope.launch(Dispatchers.IO) { pushAdapters(includeRuntimeChecks = false) }
        return
    }
    startFullAdapterRefresh()
}

private fun AcpBridge.startFullAdapterRefresh() {
    if (!fullAdapterRefreshInProgress.compareAndSet(false, true)) {
        pushAdapterRefreshState(true)
        scope.launch(Dispatchers.IO) {
            pushAdapters(includeRuntimeChecks = false)
        }
        return
    }

    pushAdapterRefreshState(true)
    fullAdapterRefreshDispatching.set(true)
    scope.launch(Dispatchers.IO) {
        try {
            resetAdapterRefreshState()
            pushAdapters(includeRuntimeChecks = false)
            pushAdapters(includeRuntimeChecks = true)
        } finally {
            fullAdapterRefreshDispatching.set(false)
            finishFullAdapterRefreshIfIdle()
        }
    }
}

private fun AcpBridge.completeCancelledPromptWhenAgentSettles(chatId: String, cancelledJob: Job?) {
    scope.launch(Dispatchers.Default) {
        val promptSettled = if (cancelledJob == null) {
            true
        } else {
            withTimeoutOrNull(CANCELLED_PROMPT_RESPONSE_TIMEOUT_MS) {
                cancelledJob.join()
                true
            } ?: false
        }

        if (!promptSettled) {
            val message = "\n\n[Warning: The cancel request was sent, but the AI agent did not finish the cancelled prompt within 10 seconds.]\n\n"
            pushContentChunk(chatId, "assistant", "text", text = message, isReplay = false)
            appendLivePromptTextEvent(chatId, message)
            service.markChatSessionBroken(chatId)
            if (cancelledJob != null) {
                promptJobs.remove(chatId, cancelledJob)
            }
        }

        flushLivePromptCapture(chatId)?.let {
            pushPromptDoneChunk(chatId, it, outcome = if (promptSettled) "cancelled" else "error")
        }
        pushStatus(chatId, if (promptSettled) "ready" else "error")
    }
}


internal fun AcpBridge.installConversationQueries() {
    startAgentQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            val parsed = parseStartRequestPayload(payload)
            val chatId = parsed.chatId
            val adapterName = parsed.adapterId
            if (chatId != null) {
                pushBridgeOperationResult(parsed.requestId, chatId, "start_agent", ok = true)
                scope.launch(Dispatchers.Default) {
                    pushStatus(chatId, "initializing")
                    try {
                        withTimeout(AcpBridge.START_AGENT_TIMEOUT_MS) {
                            service.startAgent(
                                chatId,
                                adapterName,
                                parsed.configValues
                            )
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

    listAdaptersQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            if (payload == "refresh") {
                initialAdapterRefreshStarted.set(true)
                startFullAdapterRefresh()
            } else {
                startInitialAdapterRefresh()
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
                val captureId = beginLivePromptCapture(
                    chatId,
                    parsed.rawBlocks,
                    parsed.forkBase,
                    parsed.configValues
                )
                val previousPromptJob = promptJobs[chatId]?.takeIf { it.isActive }
                lateinit var job: Job
                job = scope.launch(Dispatchers.Default, start = CoroutineStart.LAZY) {
                    try {
                        if (previousPromptJob != null) {
                            val previousPromptSettled = withTimeoutOrNull(PREVIOUS_PROMPT_SETTLE_TIMEOUT_MS) {
                                previousPromptJob.join()
                                true
                            } ?: false
                            if (!previousPromptSettled) {
                                throw IllegalStateException(
                                    "Previous prompt did not finish after cancellation. Start a new session or restart the agent."
                                )
                            }
                        }
                        // Prompt dispatch is the final configuration barrier: anything shown as
                        // selected in the UI must be applied before the agent receives the prompt.
                        service.startAgent(
                            chatId = chatId,
                            adapterName = parsed.adapterId,
                            preferredConfigValues = parsed.configValues
                        )
                        pushAdapters(includeRuntimeChecks = false)
                        pushStatus(chatId, "prompting")
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
                        if (previousPromptJob != null) {
                            service.markChatSessionBroken(chatId)
                        }
                        pushContentChunk(chatId, "assistant", "text", text = message, isReplay = false)
                        appendLivePromptTextEvent(chatId, message, captureId)
                        flushLivePromptCapture(chatId, captureId)?.let {
                            pushPromptDoneChunk(chatId, it, outcome = "error")
                        }
                        pushStatus(chatId, "error")
                    } finally {
                        promptJobs.remove(chatId, job)
                    }
                }
                promptJobs[chatId] = job
                job.start()
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
                        pushStatus(chatId, "error")
                    }
                    return@addHandler JBCefJSQuery.Response("ok")
                }

                scope.launch(Dispatchers.Default) {
                    try {
                        val cancelledJob = promptJobs[chatId]?.takeIf { it.isActive }
                        withTimeout(CANCEL_REQUEST_TIMEOUT_MS) {
                            service.cancel(chatId)
                        }
                        pushContentChunk(chatId, "assistant", "text", text = "\n\n[Cancelled]\n\n", isReplay = false)
                        appendLivePromptTextEvent(chatId, "\n\n[Cancelled]\n\n")
                        pushBridgeOperationResult(parsed.requestId, chatId, "cancel_prompt", ok = true)
                        completeCancelledPromptWhenAgentSettles(chatId, cancelledJob)
                    } catch (e: Exception) {
                        val message = "Cancel request failed. ${formatAcpError(e)}"
                        service.markChatSessionBroken(chatId)
                        pushStatus(chatId, "error")
                        pushBridgeOperationResult(parsed.requestId, chatId, "cancel_prompt", ok = false, error = message)
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
