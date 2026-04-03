package unified.llm.acp

import com.agentclientprotocol.model.ContentBlock
import com.agentclientprotocol.model.SessionUpdate
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import unified.llm.history.ConversationAssistantMetadata
import unified.llm.history.HistoryDiffCompactor
import unified.llm.history.UnifiedHistoryService

private val replayIgnoredUserCommandTags = listOf(
    "command-name",
    "command-message",
    "command-args",
    "local-command-stdout",
    "local-command-stderr"
)

private val replayIgnoredUserCommandRegexes = replayIgnoredUserCommandTags.map { tag ->
    Regex("<$tag>.*?</$tag>", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))
}


internal fun AcpBridge.beginLivePromptCapture(chatId: String, blocks: List<JsonObject>): String? {
    val projectPath = service.project.basePath.orEmpty()
    val sessionId = service.sessionId(chatId).orEmpty()
    val adapterName = service.activeAdapterName(chatId).orEmpty()
    if (projectPath.isBlank() || sessionId.isBlank() || adapterName.isBlank()) return null
    val captureId = "prompt-${System.nanoTime()}"
    val capture = LivePromptCapture(
        captureId = captureId,
        projectPath = projectPath,
        conversationId = chatId,
        sessionId = sessionId,
        adapterName = adapterName,
        blocks = blocks,
        startedAtMillis = System.currentTimeMillis(),
        assistantMeta = buildAssistantMetadata(
            adapterName = adapterName,
            modelId = service.activeModelId(chatId),
            modeId = service.activeModeId(chatId)
        )
    )
    livePromptCaptures.put(chatId, capture)?.let { previous ->
        synchronized(previous) {
            previous.closed = true
        }
    }
    return captureId
}

internal fun AcpBridge.appendLivePromptTextEvent(chatId: String, text: String, expectedCaptureId: String? = null) {
    val capture = livePromptCaptures[chatId] ?: return
    if (expectedCaptureId != null && capture.captureId != expectedCaptureId) return
    synchronized(capture) {
        if (capture.closed) return
        capture.events.add(buildStoredContentChunk("assistant", "text", text = text))
    }
}

internal fun AcpBridge.markLivePromptVisibleAssistantOutput(chatId: String, expectedCaptureId: String? = null) {
    val capture = livePromptCaptures[chatId] ?: return
    if (expectedCaptureId != null && capture.captureId != expectedCaptureId) return
    synchronized(capture) {
        if (capture.closed) return
        capture.hasVisibleAssistantOutput = true
    }
}

internal fun AcpBridge.ensureLivePromptNoResponseFallback(
    chatId: String,
    fallbackText: String,
    expectedCaptureId: String? = null
): Boolean {
    val capture = livePromptCaptures[chatId] ?: return false
    if (expectedCaptureId != null && capture.captureId != expectedCaptureId) return false
    return synchronized(capture) {
        if (capture.closed) return false
        if (capture.hasVisibleAssistantOutput) return false
        capture.events.add(buildStoredContentChunk("assistant", "text", text = fallbackText))
        capture.hasVisibleAssistantOutput = true
        true
    }
}

internal fun AcpBridge.flushLivePromptCapture(chatId: String, expectedCaptureId: String? = null): ConversationAssistantMetadata? {
    val capture = livePromptCaptures[chatId] ?: return null
    if (expectedCaptureId != null && capture.captureId != expectedCaptureId) return null
    val snapshot = synchronized(capture) {
        if (capture.closed) return null
        capture.closed = true
        LivePromptCaptureSnapshot(
            projectPath = capture.projectPath,
            conversationId = capture.conversationId,
            sessionId = capture.sessionId,
            adapterName = capture.adapterName,
            blocks = capture.blocks,
            events = capture.events.toList(),
            startedAtMillis = capture.startedAtMillis,
            assistantMeta = capture.assistantMeta,
            contextTokensUsed = capture.contextTokensUsed,
            contextWindowSize = capture.contextWindowSize
        )
    }
    livePromptCaptures.remove(chatId, capture)
    if (snapshot.blocks.isEmpty() && snapshot.events.isEmpty()) return null
    val durationSeconds = ((System.currentTimeMillis() - snapshot.startedAtMillis).coerceAtLeast(0L)) / 1000.0
    val assistantMeta = snapshot.assistantMeta?.copy(
        promptStartedAtMillis = snapshot.startedAtMillis,
        durationSeconds = durationSeconds,
        contextTokensUsed = snapshot.contextTokensUsed,
        contextWindowSize = snapshot.contextWindowSize
    ) ?: buildAssistantMetadata(
        adapterName = snapshot.adapterName,
        promptStartedAtMillis = snapshot.startedAtMillis,
        durationSeconds = durationSeconds,
        contextTokensUsed = snapshot.contextTokensUsed,
        contextWindowSize = snapshot.contextWindowSize
    )
    UnifiedHistoryService.appendConversationPrompt(
        projectPath = snapshot.projectPath,
        conversationId = snapshot.conversationId,
        sessionId = snapshot.sessionId,
        adapterName = snapshot.adapterName,
        blocks = snapshot.blocks,
        events = snapshot.events,
        assistantMeta = assistantMeta
    )
    return assistantMeta
}

internal fun AcpBridge.startHistoryReplayCapture(
    chatId: String,
    projectPath: String,
    conversationId: String
) {
    if (projectPath.isBlank() || conversationId.isBlank()) return
    historyReplayCaptures[chatId] = HistoryReplayCapture(
        projectPath = projectPath,
        conversationId = conversationId
    )
}

internal fun AcpBridge.beginImportedReplaySession(
    chatId: String,
    sessionId: String,
    adapterName: String,
    modelId: String?,
    modeId: String?
) {
    val capture = historyReplayCaptures[chatId] ?: return
    capture.currentSessionId = sessionId.takeIf { it.isNotBlank() }
    capture.currentAdapterName = adapterName.takeIf { it.isNotBlank() }
    capture.currentModelId = modelId?.takeIf { it.isNotBlank() }
    capture.currentModeId = modeId?.takeIf { it.isNotBlank() }
}

internal fun AcpBridge.discardHistoryReplayCapture(chatId: String) {
    historyReplayCaptures.remove(chatId)
}

internal fun AcpBridge.flushHistoryReplayCapture(chatId: String) {
    val capture = historyReplayCaptures.remove(chatId) ?: return
    val sessions = capture.sessions
        .filter { it.prompts.isNotEmpty() }
        .map { session ->
            unified.llm.history.ConversationSessionReplayEntry(
                sessionId = session.sessionId,
                adapterName = session.adapterName,
                prompts = session.prompts.map { prompt ->
                    unified.llm.history.ConversationPromptReplayEntry(
                        blocks = prompt.blocks,
                        events = prompt.events,
                        assistantMeta = prompt.assistantMeta
                    )
                }
            )
        }
    if (sessions.isEmpty()) return
    UnifiedHistoryService.saveConversationReplay(
        projectPath = capture.projectPath,
        conversationId = capture.conversationId,
        data = unified.llm.history.ConversationReplayData(sessions = sessions)
    )
}

internal fun AcpBridge.recordReplayUserBlock(chatId: String, sessionId: String, adapterName: String, content: ContentBlock) {
    val capture = historyReplayCaptures[chatId] ?: return
    if (sessionId.isBlank() || adapterName.isBlank()) return
    val block = storedReplayPromptBlockFromContentBlock(content) ?: return
    val session = getOrCreateReplaySession(capture, sessionId, adapterName)
    val prompt = getOrCreateReplayPrompt(session, startNewIfNeeded = true)
    prompt.blocks.add(block)
}

internal fun AcpBridge.recordContentBlock(
    chatId: String,
    sessionId: String,
    adapterName: String,
    role: String,
    content: ContentBlock,
    isThought: Boolean,
    isReplay: Boolean
) {
    val stored = storedEventFromContentBlock(role, content, isThought) ?: return
    recordStoredEvent(chatId, sessionId, adapterName, stored, isReplay)
}

internal fun AcpBridge.recordStoredEvent(
    chatId: String,
    sessionId: String,
    adapterName: String,
    event: JsonObject,
    isReplay: Boolean
) {
    if (isReplay) {
        val capture = historyReplayCaptures[chatId] ?: return
        if (sessionId.isBlank() || adapterName.isBlank()) return
        val session = getOrCreateReplaySession(capture, sessionId, adapterName)
        val prompt = getOrCreateReplayPrompt(session, startNewIfNeeded = false)
        val role = event["role"]?.jsonPrimitive?.contentOrNull
        if (role == "assistant" && prompt.assistantMeta == null) {
            prompt.assistantMeta = buildAssistantMetadata(
                adapterName = adapterName,
                modelId = capture.currentModelId,
                modeId = capture.currentModeId
            )
        }
        prompt.events.add(event)
        return
    }

    val capture = livePromptCaptures[chatId] ?: return
    synchronized(capture) {
        if (capture.closed) return
        capture.events.add(event)
    }
}

internal fun AcpBridge.getOrCreateReplaySession(
    capture: HistoryReplayCapture,
    sessionId: String,
    adapterName: String
): ReplaySessionCapture {
    val existing = capture.sessions.firstOrNull {
        it.sessionId == sessionId && it.adapterName == adapterName
    }
    if (existing != null) return existing
    return ReplaySessionCapture(sessionId = sessionId, adapterName = adapterName).also {
        capture.sessions.add(it)
    }
}

internal fun AcpBridge.getOrCreateReplayPrompt(
    session: ReplaySessionCapture,
    startNewIfNeeded: Boolean
): ReplayPromptCapture {
    val current = session.prompts.lastOrNull()
    if (current == null) {
        return ReplayPromptCapture().also { session.prompts.add(it) }
    }
    if (startNewIfNeeded && (current.events.isNotEmpty() || current.blocks.isNotEmpty())) {
        return ReplayPromptCapture().also { session.prompts.add(it) }
    }
    return current
}

internal fun AcpBridge.storedReplayPromptBlockFromContentBlock(content: ContentBlock): JsonObject? {
    val serialized = serializeContentBlock(content) ?: return null
    if (serialized.type != "text") {
        return buildJsonObject {
            put("type", serialized.type)
            serialized.text?.let { put("text", it) }
            serialized.data?.let { put("data", it) }
            serialized.mimeType?.let { put("mimeType", it) }
        }
    }

    val sanitizedText = sanitizeReplayUserText(serialized.text ?: return null) ?: return null
    return buildJsonObject {
        put("type", serialized.type)
        put("text", sanitizedText)
        serialized.data?.let { put("data", it) }
        serialized.mimeType?.let { put("mimeType", it) }
    }
}

internal fun AcpBridge.storedPromptBlockFromContentBlock(content: ContentBlock): JsonObject? {
    val serialized = serializeContentBlock(content) ?: return null
    return buildJsonObject {
        put("type", serialized.type)
        serialized.text?.let { put("text", it) }
        serialized.data?.let { put("data", it) }
        serialized.mimeType?.let { put("mimeType", it) }
    }
}

internal fun AcpBridge.sanitizeReplayUserText(text: String): String? {
    var sanitized = text
    replayIgnoredUserCommandRegexes.forEach { regex ->
        sanitized = sanitized.replace(regex, "")
    }
    return sanitized.takeUnless { it.isBlank() }
}

internal fun AcpBridge.storedEventFromContentBlock(role: String, content: ContentBlock, isThought: Boolean): JsonObject? {
    val serialized = serializeContentBlock(content, if (isThought) "thinking" else "text") ?: return null
    return buildStoredContentChunk(
        role = role,
        type = serialized.type,
        text = serialized.text,
        data = serialized.data,
        mimeType = serialized.mimeType
    )
}

internal fun AcpBridge.buildStoredContentChunk(
    role: String,
    type: String,
    text: String? = null,
    data: String? = null,
    mimeType: String? = null
): JsonObject {
    return buildJsonObject {
        put("role", role)
        put("type", type)
        if (text != null) put("text", text)
        if (data != null) put("data", data)
        if (mimeType != null) put("mimeType", mimeType)
    }
}

internal fun AcpBridge.buildAssistantMetadata(
    adapterName: String,
    modelId: String? = null,
    modeId: String? = null,
    promptStartedAtMillis: Long? = null,
    durationSeconds: Double? = null,
    contextTokensUsed: Long? = null,
    contextWindowSize: Long? = null
): ConversationAssistantMetadata? {
    val cleanAdapterName = adapterName.trim()
    if (cleanAdapterName.isBlank()) return null

    val adapterInfo = runCatching { AcpAdapterPaths.getAdapterInfo(cleanAdapterName) }.getOrNull()
    val runtimeMetadata = service.adapterRuntimeMetadata(cleanAdapterName)
    val cleanModelId = modelId?.trim()?.takeIf { it.isNotBlank() }
    val cleanModeId = modeId?.trim()?.takeIf { it.isNotBlank() }

    return ConversationAssistantMetadata(
        agentId = cleanAdapterName,
        agentName = adapterInfo?.name ?: cleanAdapterName,
        modelId = cleanModelId,
        modelName = cleanModelId?.let { model ->
            runtimeMetadata?.availableModels?.firstOrNull { it.modelId == model }?.name ?: model
        },
        modeId = cleanModeId,
        modeName = cleanModeId?.let { mode ->
            runtimeMetadata?.availableModes?.firstOrNull { it.id == mode }?.name ?: mode
        },
        promptStartedAtMillis = promptStartedAtMillis,
        durationSeconds = durationSeconds,
        contextTokensUsed = contextTokensUsed,
        contextWindowSize = contextWindowSize
    )
}

internal fun AcpBridge.buildStoredToolCallChunk(rawJson: String): JsonObject {
    val parsed = try { Json.parseToJsonElement(rawJson).jsonObject } catch (_: Exception) { null }
    return buildJsonObject {
        put("role", "assistant")
        put("type", "tool_call")
        put("toolCallId", parsed?.get("toolCallId")?.jsonPrimitive?.contentOrNull ?: "")
        put("toolKind", parsed?.get("kind")?.jsonPrimitive?.contentOrNull ?: "")
        put("toolTitle", parsed?.get("title")?.jsonPrimitive?.contentOrNull ?: "")
        put("toolStatus", parsed?.get("status")?.jsonPrimitive?.contentOrNull ?: "")
        put("toolRawJson", storedToolRawJson(rawJson))
    }
}

internal fun AcpBridge.buildStoredToolCallUpdateChunk(toolCallId: String, rawJson: String): JsonObject {
    return buildJsonObject {
        put("role", "assistant")
        put("type", "tool_call_update")
        put("toolCallId", toolCallId)
        put("toolRawJson", storedToolRawJson(rawJson))
    }
}

internal fun AcpBridge.storedToolRawJson(rawJson: String): String {
    val parsed = try { Json.parseToJsonElement(rawJson).jsonObject } catch (_: Exception) { null }
    return if (shouldPreserveToolRawJson(parsed)) {
        HistoryDiffCompactor.compactStoredToolRawJson(rawJson, Json)
    } else {
        truncateStoredToolRawJson(rawJson)
    }
}

internal fun AcpBridge.truncateStoredToolRawJson(rawJson: String, maxChars: Int = 2_000): String {
    if (rawJson.length <= maxChars) return rawJson
    val omitted = rawJson.length - maxChars
    return rawJson.take(maxChars) + "\n\n[Stored history truncated; $omitted chars omitted]"
}

private fun shouldPreserveToolRawJson(parsed: JsonObject?): Boolean {
    if (parsed == null) return false
    val kind = parsed["kind"]?.jsonPrimitive?.contentOrNull
    if (kind == "edit") return true

    val content = parsed["content"]?.jsonArray
    if (content != null && content.any(::isDiffLikePayload)) return true

    val diffs = parsed["diffs"]?.jsonArray
    if (diffs != null && diffs.any(::isDiffLikePayload)) return true

    return false
}

private fun isDiffLikePayload(element: JsonElement): Boolean {
    val obj = element as? JsonObject ?: return false
    val type = obj["type"]?.jsonPrimitive?.contentOrNull
    if (type == "diff") return true
    return obj["path"] != null && obj["newText"] != null
}

private data class LivePromptCaptureSnapshot(
    val projectPath: String,
    val conversationId: String,
    val sessionId: String,
    val adapterName: String,
    val blocks: List<JsonObject>,
    val events: List<JsonObject>,
    val startedAtMillis: Long,
    val assistantMeta: ConversationAssistantMetadata?,
    val contextTokensUsed: Long?,
    val contextWindowSize: Long?
)

internal fun AcpBridge.buildStoredPlanChunk(plan: SessionUpdate, meta: JsonElement?): JsonObject? {
    val entries = extractPlanEntries(plan, meta) ?: return null
    if (entries.isEmpty()) return null
    return buildJsonObject {
        put("role", "assistant")
        put("type", "plan")
        put("planEntries", entries)
    }
}

internal fun AcpBridge.replayStoredConversation(chatId: String, data: unified.llm.history.ConversationReplayData) {
    data.sessions.forEach { session ->
        session.prompts.forEach { prompt ->
            prompt.blocks.forEach { block ->
                dispatchStoredPromptBlock(chatId, block)
            }
            prompt.events.forEach { event ->
                dispatchStoredContentChunk(chatId, event)
            }
            prompt.assistantMeta?.let { meta ->
                pushPromptDoneChunk(chatId, meta, outcome = "success", isReplay = true)
            }
        }
    }
}

internal fun AcpBridge.dispatchStoredPromptBlock(chatId: String, block: JsonObject) {
    val type = block["type"]?.jsonPrimitive?.contentOrNull ?: "text"
    when (type) {
        "image", "audio", "video", "file" -> {
            dispatchStoredContentChunk(
                chatId,
                buildJsonObject {
                    put("role", "user")
                    put("type", type)
                    block["data"]?.let { put("data", it) }
                    block["text"]?.let { put("text", it) }
                    block["mimeType"]?.let { put("mimeType", it) }
                }
            )
        }
        "code_ref" -> {
            val text = codeRefBlockToText(block).text
            dispatchStoredContentChunk(chatId, buildStoredContentChunk("user", "text", text = text))
        }
        else -> {
            val text = block["text"]?.jsonPrimitive?.contentOrNull.orEmpty()
            dispatchStoredContentChunk(chatId, buildStoredContentChunk("user", "text", text = text))
        }
    }
}

internal fun AcpBridge.dispatchStoredContentChunk(chatId: String, stored: JsonObject) {
    val replaySeq = nextReplaySeq(chatId, true)
    val payload = buildJsonObject {
        put("chatId", chatId)
        stored.forEach { (key, value) -> put(key, value) }
        put("isReplay", true)
        if (replaySeq != null) put("replaySeq", replaySeq)
    }
    dispatchContentChunkJson(payload.toString())
}
