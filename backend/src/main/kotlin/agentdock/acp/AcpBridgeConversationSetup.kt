package agentdock.acp

import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.*
import kotlin.time.Duration.Companion.seconds

private data class PermissionDecisionPayload(
    val requestId: String,
    val decision: String
)

private val PROMPT_HEALTH_POLL_INTERVAL = 5.seconds
private val CANCEL_REQUEST_TIMEOUT = 10.seconds
private val CANCELLED_PROMPT_RESPONSE_TIMEOUT = 10.seconds
private val PREVIOUS_PROMPT_SETTLE_TIMEOUT = 30.seconds

internal fun AcpBridge.pushConversationError(chatId: String, error: Throwable) {
    pushContentChunk(chatId, "assistant", "text", text = "[Error: ${formatAcpError(error)}]")
}

internal fun AcpBridge.pushConversationError(chatId: String, message: String) {
    pushContentChunk(chatId, "assistant", "text", text = "[Error: $message]")
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

private fun parsePermissionDecisionPayload(payload: String): PermissionDecisionPayload? {
    return runCatching {
        val obj = Json.parseToJsonElement(payload).jsonObject
        val requestId = obj["requestId"]?.jsonPrimitive?.content?.trim().orEmpty()
        val decision = obj["decision"]?.jsonPrimitive?.content?.trim().orEmpty()
        if (requestId.isBlank() || decision.isBlank()) null else PermissionDecisionPayload(requestId, decision)
    }.getOrNull()
}

internal fun AcpBridge.startInitialAdapterRefresh() {
    if (initialAdapterRefreshStarted.compareAndSet(false, true)) {
        refreshAdapters(AcpAdapterConfig.getAllAdapters().values.map { it.id })
    } else {
        scope.launch(Dispatchers.IO) { pushAdapters() }
    }
}

private fun AcpBridge.completeCancelledPromptWhenAgentSettles(chatId: String, cancelledJob: Job?) {
    scope.launch(Dispatchers.Default) {
        val promptSettled = cancelledJob == null ||
            withTimeoutOrNull(CANCELLED_PROMPT_RESPONSE_TIMEOUT) { cancelledJob.join() } != null

        if (promptSettled) {
            withChatDelivery(chatId) {
                flushLivePromptCapture(chatId)?.let {
                    pushPromptDoneChunk(chatId, it, outcome = "cancelled")
                }
                pushStatus(chatId, "ready")
            }
        } else {
            service.markChatSessionBroken(chatId)
            promptJobs.remove(chatId, cancelledJob)
            failLivePrompt(
                chatId,
                "\n\n[Warning: The cancel request was sent, but the AI agent did not finish the cancelled prompt within 10 seconds.]\n\n"
            )
        }
    }
}

/** Shows [message] in the chat and ends the live prompt with an error. */
private fun AcpBridge.failLivePrompt(chatId: String, message: String, captureId: String? = null) = withChatDelivery(chatId) {
    pushContentChunk(chatId, "assistant", "text", text = message)
    appendLivePromptTextEvent(chatId, message, captureId)
    flushLivePromptCapture(chatId, captureId)?.let {
        pushPromptDoneChunk(chatId, it, outcome = "error")
    }
    pushStatus(chatId, "error")
}


internal fun AcpBridge.installConversationQueries() {
    host.register("startAgent") { payload ->
        val parsed = parseStartRequestPayload(payload)
        val chatId = parsed.chatId
        val adapterName = parsed.adapterId
        if (chatId != null) {
            pushBridgeOperationResult(parsed.requestId, chatId, "start_agent", ok = true)
            scope.launch(Dispatchers.Default) {
                pushStatus(chatId, "initializing")
                try {
                    withTimeout(AcpBridge.START_AGENT_TIMEOUT) {
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
                    pushContentChunk(chatId, "assistant", "text", text = "[Error: ${formatAcpError(e)}]")
                }
            }
        } else {
            pushBridgeOperationResult(parsed.requestId, null, "start_agent", ok = false, error = "Invalid start request.")
        }
    }

    host.register("listAdapters") { adapterIdToRefresh ->
        if (adapterIdToRefresh.isBlank()) startInitialAdapterRefresh() else refreshAdapters(listOf(adapterIdToRefresh))
    }

    host.register("sendPrompt") { payload ->
        val parsed = parseBlocksPayload(payload)
        val chatId = parsed.chatId
        val blocks = parsed.blocks
        if (chatId != null && blocks.isNotEmpty()) {
            awaitingBackgroundOutput.remove(chatId)
            val dispatchFailure = service.promptDispatchFailure(chatId)
            if (dispatchFailure != null) {
                pushBridgeOperationResult(parsed.requestId, chatId, "send_prompt", ok = false, error = dispatchFailure)
                scope.launch(Dispatchers.Default) {
                    service.markChatSessionBroken(chatId)
                    pushConversationError(chatId, dispatchFailure)
                    pushStatus(chatId, "error")
                }
                return@register
            }

            pushBridgeOperationResult(parsed.requestId, chatId, "send_prompt", ok = true)
            val captureId = beginLivePromptCapture(
                chatId,
                parsed.rawBlocks,
                parsed.forkBase
            )
            val previousPromptJob = promptJobs[chatId]?.takeIf { it.isActive }
            lateinit var job: Job
            job = scope.launch(Dispatchers.Default, start = CoroutineStart.LAZY) {
                try {
                    if (previousPromptJob != null) {
                        val previousPromptSettled = withTimeoutOrNull(PREVIOUS_PROMPT_SETTLE_TIMEOUT) {
                            previousPromptJob.join()
                            true
                        } ?: false
                        if (!previousPromptSettled) {
                            throw IllegalStateException(
                                "Previous prompt did not finish after cancellation. Start a new session or restart the agent."
                            )
                        }
                    }
                    // Prompt dispatch is the final configuration barrier: the configuration
                    // captured at submission must be applied before the agent receives the prompt.
                    // Bounded like every other start, so a stuck agent fails the prompt
                    // instead of leaving the user waiting on a prompt that never runs.
                    val started = withTimeoutOrNull(AcpBridge.START_AGENT_TIMEOUT) {
                        service.startAgent(
                            chatId = chatId,
                            adapterName = parsed.adapterId,
                            preferredConfigValues = parsed.configValues
                        )
                        true
                    }
                    if (started == null) {
                        throw IllegalStateException(
                            "The agent did not become ready within ${AcpBridge.START_AGENT_TIMEOUT.inWholeSeconds}s."
                        )
                    }
                    refreshLivePromptAssistantMetadata(chatId, captureId)
                    pushAdapters(includeRuntimeChecks = false)
                    pushStatus(chatId, "prompting")
                    service.prompt(chatId, blocks).collect { event ->
                        when (event) {
                            AcpEvent.PromptDone -> withChatDelivery(chatId) {
                                if (captureId != null && livePromptCaptures[chatId]?.captureId == captureId) {
                                    service.sessionId(chatId)?.let { awaitingBackgroundOutput[chatId] = it }
                                }
                                val fallbackText = "[The AI agent ended the turn without providing a response.]"
                                if (ensureLivePromptNoResponseFallback(chatId, fallbackText, captureId)) {
                                    pushContentChunk(chatId, "assistant", "text", text = fallbackText)
                                }
                                flushLivePromptCapture(chatId, captureId)?.let {
                                    pushPromptDoneChunk(chatId, it, outcome = "success")
                                }
                                pushStatus(chatId, "ready")
                            }
                            is AcpEvent.Error -> failLivePrompt(chatId, "[Error: ${event.message}]", captureId)
                        }
                    }
                } catch (e: kotlinx.coroutines.CancellationException) {
                    // The bridges are torn down with their UI (a Split Mode reconnect or project
                    // close), so this prompt never finishes: keep what was captured in history.
                    if (!scope.isActive) runCatching { flushLivePromptCapture(chatId, captureId) }
                    if (service.status(chatId) == AcpClientService.Status.Error) {
                        pushStatus(chatId, "error")
                    } else {
                        pushStatus(chatId, "ready")
                    }
                    throw e
                } catch (e: Exception) {
                    if (previousPromptJob != null) {
                        service.markChatSessionBroken(chatId)
                    }
                    failLivePrompt(chatId, "[Error: ${formatAcpError(e)}]", captureId)
                } finally {
                    promptJobs.remove(chatId, job)
                }
            }
            promptJobs[chatId] = job
            job.start()
            val watcher = scope.launch(Dispatchers.Default) {
                while (job.isActive) {
                    delay(PROMPT_HEALTH_POLL_INTERVAL)
                    if (!job.isActive) break
                    if (service.status(chatId) != AcpClientService.Status.Prompting) break
                    val failure = service.promptDispatchFailure(chatId) ?: continue
                    service.markChatSessionBroken(chatId)
                    failLivePrompt(chatId, "[Error: $failure]", captureId)
                    job.cancel(kotlinx.coroutines.CancellationException(failure))
                    break
                }
            }
            job.invokeOnCompletion {
                watcher.cancel()
            }
        } else {
            pushBridgeOperationResult(parsed.requestId, chatId, "send_prompt", ok = false, error = "Invalid prompt request.")
        }
    }

    host.register("cancelPrompt") { payload ->
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
                return@register
            }

            scope.launch(Dispatchers.Default) {
                try {
                    val cancelledJob = promptJobs[chatId]?.takeIf { it.isActive }
                    withTimeout(CANCEL_REQUEST_TIMEOUT) {
                        service.cancel(chatId)
                    }
                    withChatDelivery(chatId) {
                        pushContentChunk(chatId, "assistant", "text", text = "\n\n[Cancelled]\n\n")
                        appendLivePromptTextEvent(chatId, "\n\n[Cancelled]\n\n")
                    }
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
    }

    host.register("stopAgent") { chatIdPayload ->
        val chatId = chatIdPayload.trim()
        if (chatId.isNotEmpty()) {
            scope.launch(Dispatchers.Default) {
                stopConversation(chatId)
            }
        }
    }

    host.register("respondPermission") { payload ->
        parsePermissionDecisionPayload(payload)?.let { request ->
            scope.launch(Dispatchers.Default) {
                service.respondToPermissionRequest(request.requestId, request.decision)
            }
        }
    }

    installConversationHistoryQueries()
}

internal suspend fun AcpBridge.stopConversation(chatId: String, awaitPrompt: Boolean = false) {
    if (awaitPrompt) {
        historyLoadMutexes[chatId]?.mutex?.withLock { }
        val promptJob = promptJobs[chatId]
        withTimeout(CANCEL_REQUEST_TIMEOUT) { service.cancel(chatId) }
        withTimeout(CANCELLED_PROMPT_RESPONSE_TIMEOUT) { promptJob?.join() }
    }
    service.stopAgent(chatId)
    awaitingBackgroundOutput.remove(chatId)
    livePromptCaptures.remove(chatId)
    lateHistoryEventQueues.remove(chatId)?.close()
    historyReplayCaptures.remove(chatId)
    forgetToolCallKeys(chatId)
    lastStatusByChatId.remove(chatId)
    historyRevisions.remove(chatId)
    chatDeliveryLocks.remove(chatId)
}
