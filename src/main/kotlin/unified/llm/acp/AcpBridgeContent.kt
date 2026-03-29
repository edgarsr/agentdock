package unified.llm.acp

import com.agentclientprotocol.model.ContentBlock
import com.agentclientprotocol.model.SessionUpdate
import com.agentclientprotocol.model.ToolCallContent
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import unified.llm.changes.ChangesState
import unified.llm.changes.ChangesStateService
import unified.llm.history.ConversationAssistantMetadata
import unified.llm.history.ConversationReplayData
import unified.llm.utils.escapeForJsString


/**
 * Unified content delivery: ALL content (live streaming + history replay) goes
 * through pushContentChunk so the frontend has a single ingestion path.
 */
internal fun AcpBridge.pushContentChunk(chatId: String, role: String, type: String, text: String? = null, data: String? = null, mimeType: String? = null, isReplay: Boolean = false) {
    val replaySeq = nextReplaySeq(chatId, isReplay)
    val parts = mutableListOf<String>()
    parts.add("\"chatId\":${escapeJsonString(chatId)}")
    parts.add("\"role\":${escapeJsonString(role)}")
    parts.add("\"type\":${escapeJsonString(type)}")
    if (text != null) parts.add("\"text\":${escapeJsonString(text)}")
    if (data != null) parts.add("\"data\":${escapeJsonString(data)}")
    if (mimeType != null) parts.add("\"mimeType\":${escapeJsonString(mimeType)}")
    parts.add("\"isReplay\":$isReplay")
    if (replaySeq != null) parts.add("\"replaySeq\":$replaySeq")
    val json = "{${parts.joinToString(",")}}"
    dispatchContentChunkJson(json)
}

internal fun AcpBridge.pushConversationReplayLoaded(chatId: String, data: ConversationReplayData) {
    val payload = buildJsonObject {
        put("chatId", chatId)
        put("data", Json.encodeToJsonElement(data))
    }.toString().escapeForJsString()
    runOnEdt {
        browser.cefBrowser.executeJavaScript(
            "if(window.__onConversationReplayLoaded) window.__onConversationReplayLoaded(JSON.parse('$payload'));",
            browser.cefBrowser.url,
            0
        )
    }
}

/** Convenience: send a ContentBlock from the ACP SDK through the unified pipeline. */
internal fun AcpBridge.pushContentBlock(chatId: String, role: String, content: ContentBlock, isThought: Boolean, isReplay: Boolean) {
    val serialized = serializeContentBlock(content, if (isThought) "thinking" else "text") ?: return
    pushContentChunk(
        chatId = chatId,
        role = role,
        type = serialized.type,
        text = serialized.text,
        data = serialized.data,
        mimeType = serialized.mimeType,
        isReplay = isReplay
    )
}

internal fun AcpBridge.pushToolCallChunk(chatId: String, rawJson: String, isReplay: Boolean = false) {
    val replaySeq = nextReplaySeq(chatId, isReplay)
    val parsed = try { Json.parseToJsonElement(rawJson).jsonObject } catch (_: Exception) { null }
    val toolCallId = parsed?.get("toolCallId")?.jsonPrimitive?.contentOrNull ?: ""
    val kind = parsed?.get("kind")?.jsonPrimitive?.contentOrNull ?: ""
    val title = parsed?.get("title")?.jsonPrimitive?.contentOrNull ?: ""
    val status = parsed?.get("status")?.jsonPrimitive?.contentOrNull ?: ""

    val parts = mutableListOf<String>()
    parts.add("\"chatId\":${escapeJsonString(chatId)}")
    parts.add("\"role\":\"assistant\"")
    parts.add("\"type\":\"tool_call\"")
    parts.add("\"isReplay\":$isReplay")
    parts.add("\"toolCallId\":${escapeJsonString(toolCallId)}")
    parts.add("\"toolKind\":${escapeJsonString(kind)}")
    parts.add("\"toolTitle\":${escapeJsonString(title)}")
    parts.add("\"toolStatus\":${escapeJsonString(status)}")
    parts.add("\"toolRawJson\":${escapeJsonString(rawJson)}")
    if (replaySeq != null) parts.add("\"replaySeq\":$replaySeq")
    val json = "{${parts.joinToString(",")}}"
    dispatchContentChunkJson(json)
}

internal fun AcpBridge.pushToolCallUpdateChunk(chatId: String, toolCallId: String, rawJson: String, isReplay: Boolean = false) {
    val replaySeq = nextReplaySeq(chatId, isReplay)
    val parts = mutableListOf<String>()
    parts.add("\"chatId\":${escapeJsonString(chatId)}")
    parts.add("\"role\":\"assistant\"")
    parts.add("\"type\":\"tool_call_update\"")
    parts.add("\"isReplay\":$isReplay")
    parts.add("\"toolCallId\":${escapeJsonString(toolCallId)}")
    parts.add("\"toolRawJson\":${escapeJsonString(rawJson)}")
    if (replaySeq != null) parts.add("\"replaySeq\":$replaySeq")
    val json = "{${parts.joinToString(",")}}"
    dispatchContentChunkJson(json)
}

internal fun AcpBridge.recordUsageUpdate(
    chatId: String,
    sessionId: String,
    adapterName: String,
    used: Long?,
    size: Long?,
    isReplay: Boolean
) {
    if (isReplay) {
        val capture = historyReplayCaptures[chatId] ?: return
        if (sessionId.isBlank() || adapterName.isBlank()) return
        val session = getOrCreateReplaySession(capture, sessionId, adapterName)
        val prompt = getOrCreateReplayPrompt(session, startNewIfNeeded = false)
        val current = prompt.assistantMeta ?: buildAssistantMetadata(
            adapterName = adapterName,
            modelId = capture.currentModelId,
            modeId = capture.currentModeId
        )
        prompt.assistantMeta = current?.copy(
            contextTokensUsed = used ?: current.contextTokensUsed,
            contextWindowSize = size ?: current.contextWindowSize
        )
        return
    }

    val capture = livePromptCaptures[chatId] ?: return
    synchronized(capture) {
        if (capture.closed) return
        if (used != null) capture.contextTokensUsed = used
        if (size != null) capture.contextWindowSize = size
    }
}

internal fun AcpBridge.extractUsageUpdate(update: SessionUpdate, meta: JsonElement?): Pair<Long?, Long?>? {
    val updateObj = when {
        meta is JsonObject -> meta["update"]?.jsonObject ?: meta
        else -> try {
            Json.parseToJsonElement(Json.encodeToString(update)).jsonObject
        } catch (_: Exception) {
            null
        }
    } ?: return null

    if (updateObj["sessionUpdate"]?.jsonPrimitive?.contentOrNull != "usage_update") {
        return null
    }

    val used = updateObj["used"]?.jsonPrimitive?.longOrNull
    val size = updateObj["size"]?.jsonPrimitive?.longOrNull
    return used to size
}

internal fun AcpBridge.isPlanUpdate(update: SessionUpdate, _meta: JsonElement?): Boolean {
    if (_meta is JsonObject) {
        val updateObj = _meta["update"]?.jsonObject ?: _meta
        if (updateObj["sessionUpdate"]?.jsonPrimitive?.contentOrNull == "plan") return true
    }
    return try {
        val parsed = Json.parseToJsonElement(Json.encodeToString(update)).jsonObject
        parsed["sessionUpdate"]?.jsonPrimitive?.contentOrNull == "plan"
    } catch (_: Exception) { false }
}

internal fun AcpBridge.extractPlanEntries(plan: SessionUpdate, _meta: JsonElement?): JsonArray? {
    if (_meta is JsonObject) {
        val updateObj = _meta["update"]?.jsonObject ?: _meta
        updateObj["entries"]?.jsonArray?.let { return it }
    }
    return try {
        Json.parseToJsonElement(Json.encodeToString(plan)).jsonObject["entries"]?.jsonArray
    } catch (_: Exception) { null }
}

internal fun AcpBridge.pushPlanChunk(chatId: String, plan: SessionUpdate, isReplay: Boolean = false, _meta: JsonElement? = null) {
    val replaySeq = nextReplaySeq(chatId, isReplay)
    val entries = try {
        extractPlanEntries(plan, _meta)
    } catch (e: Exception) {
        null
    }

    if (entries == null || entries.isEmpty()) {
        return
    }

    val chunk = buildJsonObject {
        put("chatId", chatId)
        put("role", "assistant")
        put("type", "plan")
        put("isReplay", isReplay)
        if (replaySeq != null) put("replaySeq", replaySeq)
        put("planEntries", entries)
    }

    val json = chunk.toString()
    dispatchContentChunkJson(json)
}

internal fun AcpBridge.pushStatus(chatId: String, status: String) {
    val previousStatus = lastStatusByChatId.put(chatId, status)
    val escapedStatus = jsStringLiteral(status)
    val escapedChatId = jsStringLiteral(chatId)
    runOnEdt {
        browser.cefBrowser.executeJavaScript(
            "if(window.__onStatus) window.__onStatus($escapedChatId, $escapedStatus);",
            browser.cefBrowser.url, 0
        )
    }
    if (previousStatus == "prompting" && status == "ready") {
        audio.playResponseCompleteSound()
    }
}

internal fun AcpBridge.pushMode(chatId: String, modeId: String?) {
    if (modeId == null) return
    val escapedModeId = jsStringLiteral(modeId)
    val escapedChatId = jsStringLiteral(chatId)
    runOnEdt {
        browser.cefBrowser.executeJavaScript(
            "if(window.__onMode) window.__onMode($escapedChatId, $escapedModeId);",
            browser.cefBrowser.url, 0
        )
    }
}

internal fun AcpBridge.pushAvailableCommands(adapterId: String, commands: List<AvailableCommandPayload>) {
    val payloadJson = adapterJson.encodeToString(commands)
    val escapedAdapterId = jsStringLiteral(adapterId)
    val escapedPayload = payloadJson.escapeForJsString()
    runOnEdt {
        browser.cefBrowser.executeJavaScript(
            "if(window.__onAvailableCommands) window.__onAvailableCommands($escapedAdapterId, JSON.parse('$escapedPayload'));",
            browser.cefBrowser.url, 0
        )
    }
}

internal fun AcpBridge.pushAllAvailableCommands() {
    service.allAvailableCommands().forEach { (adapterId, commands) ->
        pushAvailableCommands(adapterId, commands)
    }
}

internal fun AcpBridge.pushSessionId(chatId: String, sid: String?) {
    if (sid == null) return
    val escapedSessionId = jsStringLiteral(sid)
    val escapedChatId = jsStringLiteral(chatId)
    runOnEdt {
        browser.cefBrowser.executeJavaScript(
            "if(window.__onSessionId) window.__onSessionId($escapedChatId, $escapedSessionId);",
            browser.cefBrowser.url, 0
        )
    }
}

internal fun AcpBridge.pushPermissionRequest(request: PermissionRequest) {
    val requestIdLiteral = jsStringLiteral(request.requestId)
    val chatIdLiteral = jsStringLiteral(request.chatId)
    val titleLiteral = jsStringLiteral(request.title)
    val optionsJson = request.options.joinToString(",") { opt ->
        "{optionId: ${jsStringLiteral(opt.optionId.value)}, label: ${jsStringLiteral(opt.name)}}"
    }
    runOnEdt {
        browser.cefBrowser.executeJavaScript(
            "if(window.__onPermissionRequest) window.__onPermissionRequest({ requestId: $requestIdLiteral, chatId: $chatIdLiteral, title: $titleLiteral, options: [$optionsJson] });",
            browser.cefBrowser.url, 0
        )
    }
    audio.playPermissionRequestSound()
}

internal fun AcpBridge.pushUndoResult(chatId: String, result: unified.llm.changes.UndoResult) {
    val successStr = if (result.success) "true" else "false"
    val messageLiteral = jsStringLiteral(result.message)
    val chatIdLiteral = jsStringLiteral(chatId)
    runOnEdt {
        browser.cefBrowser.executeJavaScript(
            "if(window.__onUndoResult) window.__onUndoResult($chatIdLiteral, {success:$successStr,message:$messageLiteral});",
            browser.cefBrowser.url, 0
        )
    }
}

internal fun AcpBridge.pushConversationTranscriptSaved(result: SaveConversationTranscriptResultPayload) {
    val payloadJson = adapterJson.encodeToString(result)
    val escaped = payloadJson.escapeForJsString()
    runOnEdt {
        browser.cefBrowser.executeJavaScript(
            "if(window.__onConversationTranscriptSaved) window.__onConversationTranscriptSaved(JSON.parse('$escaped'));",
            browser.cefBrowser.url, 0
        )
    }
}

internal fun AcpBridge.pushChangesState(chatId: String, state: ChangesState, hasPluginEdits: Boolean) {
    val hasPluginEditsStr = if (hasPluginEdits) "true" else "false"
    val processedJson = state.processedFiles.joinToString(",") { escapeJsonString(it) }
    val payload = """{"sessionId":${escapeJsonString(state.sessionId)},"adapterName":${escapeJsonString(state.adapterName)},"baseToolCallIndex":${state.baseToolCallIndex},"processedFiles":[$processedJson],"hasPluginEdits":$hasPluginEditsStr}"""
    val chatIdLiteral = jsStringLiteral(chatId)
    val escaped = payload.escapeForJsString()
    runOnEdt {
        browser.cefBrowser.executeJavaScript(
            "if(window.__onChangesState) window.__onChangesState($chatIdLiteral, JSON.parse('$escaped'));",
            browser.cefBrowser.url, 0
        )
    }
}

/**
 * When the agent modifies files in a live (non-replay) tool call, remove those paths from
 * processedFiles so they show again in Edits. Only called when isReplay == false.
 */
internal fun AcpBridge.removeProcessedFilesForDiffs(chatId: String, content: List<ToolCallContent>?) {
    val sessionId = service.sessionId(chatId) ?: return
    val adNameValue = service.activeAdapterName(chatId) ?: return
    val diffs = content?.filterIsInstance<ToolCallContent.Diff>() ?: return
    if (diffs.isEmpty()) return

    val projectPath = service.project.basePath.orEmpty()
    if (!ChangesStateService.hasState(projectPath, sessionId, adNameValue)) {
        ChangesStateService.ensureState(projectPath, sessionId, adNameValue)
    }

    val paths = diffs.map { it.path }
    ChangesStateService.removeProcessedFiles(projectPath, sessionId, adNameValue, paths)
    val state = ChangesStateService.loadState(projectPath, sessionId, adNameValue) ?: ChangesStateService.ensureState(projectPath, sessionId, adNameValue)
    pushChangesState(chatId, state, true)
}

internal fun AcpBridge.pushPromptDoneChunk(
    chatId: String,
    metadata: ConversationAssistantMetadata,
    outcome: String,
    isReplay: Boolean = false
) {
    val replaySeq = nextReplaySeq(chatId, isReplay)
    val parts = mutableListOf<String>()
    parts.add("\"chatId\":${escapeJsonString(chatId)}")
    parts.add("\"role\":\"assistant\"")
    parts.add("\"type\":\"prompt_done\"")
    parts.add("\"isReplay\":$isReplay")
    parts.add("\"promptOutcome\":${escapeJsonString(outcome)}")
    metadata.agentId?.let { parts.add("\"agentId\":${escapeJsonString(it)}") }
    metadata.agentName?.let { parts.add("\"agentName\":${escapeJsonString(it)}") }
    metadata.modelId?.let { parts.add("\"modelId\":${escapeJsonString(it)}") }
    metadata.modelName?.let { parts.add("\"modelName\":${escapeJsonString(it)}") }
    metadata.modeId?.let { parts.add("\"modeId\":${escapeJsonString(it)}") }
    metadata.modeName?.let { parts.add("\"modeName\":${escapeJsonString(it)}") }
    metadata.promptStartedAtMillis?.let { parts.add("\"promptStartedAtMillis\":$it") }
    metadata.durationSeconds?.let { parts.add("\"durationSeconds\":$it") }
    metadata.contextTokensUsed?.let { parts.add("\"contextTokensUsed\":$it") }
    metadata.contextWindowSize?.let { parts.add("\"contextWindowSize\":$it") }
    if (replaySeq != null) parts.add("\"replaySeq\":$replaySeq")
    val json = "{${parts.joinToString(",")}}"
    dispatchContentChunkJson(json)
}
