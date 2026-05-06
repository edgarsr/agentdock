package agentdock.acp

import com.agentclientprotocol.model.ContentBlock
import com.agentclientprotocol.model.SessionUpdate
import kotlinx.serialization.json.*
import agentdock.history.ConversationAssistantMetadata
import agentdock.history.HistoryDiffCompactor

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

private const val MAX_TOOL_OUTPUT_LINES = 300
private const val MAX_TOOL_OUTPUT_CHARS = 5000

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
        upsertStoredToolEvent(prompt.events, event)
        return
    }

    val capture = livePromptCaptures[chatId] ?: return
    synchronized(capture) {
        if (capture.closed) return
        upsertStoredToolEvent(capture.events, event)
    }
}

private fun AcpBridge.upsertStoredToolEvent(events: MutableList<JsonObject>, event: JsonObject) {
    val merged = mergeStoredToolEvent(events, event)
    if (merged == null) {
        events.add(event)
        return
    }

    val toolCallId = merged["toolCallId"]?.jsonPrimitive?.contentOrNull.orEmpty()
    val existingIndex = events.indexOfLast { existing ->
        val existingType = existing["type"]?.jsonPrimitive?.contentOrNull
        val existingToolCallId = existing["toolCallId"]?.jsonPrimitive?.contentOrNull
        existingType == "tool_call" && existingToolCallId == toolCallId
    }

    if (existingIndex >= 0) {
        events[existingIndex] = merged
    } else {
        events.add(merged)
    }
}

private fun AcpBridge.mergeStoredToolEvent(events: List<JsonObject>, event: JsonObject): JsonObject? {
    val role = event["role"]?.jsonPrimitive?.contentOrNull
    if (role != "assistant") return null

    val type = event["type"]?.jsonPrimitive?.contentOrNull
    if (type != "tool_call" && type != "tool_call_update") return null

    val toolCallId = event["toolCallId"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() } ?: return null
    val incomingRawJson = event["toolRawJson"]?.jsonPrimitive?.contentOrNull ?: return null
    val incomingRaw = parseStoredToolRawJson(incomingRawJson) ?: return null

    val existing = events.lastOrNull { existingEvent ->
        val existingType = existingEvent["type"]?.jsonPrimitive?.contentOrNull
        val existingToolCallId = existingEvent["toolCallId"]?.jsonPrimitive?.contentOrNull
        existingType == "tool_call" && existingToolCallId == toolCallId
    }
    val existingRaw = existing
        ?.get("toolRawJson")
        ?.jsonPrimitive
        ?.contentOrNull
        ?.let(::parseStoredToolRawJson)

    val mergedRaw = mergeJsonObjects(existingRaw, incomingRaw)
    val mergedKind = event["toolKind"]?.jsonPrimitive?.contentOrNull
        ?: incomingRaw["kind"]?.jsonPrimitive?.contentOrNull
        ?: existing?.get("toolKind")?.jsonPrimitive?.contentOrNull
        ?: existingRaw?.get("kind")?.jsonPrimitive?.contentOrNull
        ?: mergedRaw["kind"]?.jsonPrimitive?.contentOrNull
        ?: ""
    val mergedRawFinal = if (mergedKind == "edit") {
        preserveEditDiffContent(existingRaw, incomingRaw, mergedRaw)
    } else {
        mergedRaw
    }
    val mergedRawJson = storedToolRawJson(mergedRawFinal.toString())

    val mergedTitle = event["toolTitle"]?.jsonPrimitive?.contentOrNull
        ?: incomingRaw["title"]?.jsonPrimitive?.contentOrNull
        ?: existing?.get("toolTitle")?.jsonPrimitive?.contentOrNull
        ?: existingRaw?.get("title")?.jsonPrimitive?.contentOrNull
        ?: mergedRawFinal["title"]?.jsonPrimitive?.contentOrNull
        ?: ""

    val mergedStatus = event["toolStatus"]?.jsonPrimitive?.contentOrNull
        ?: incomingRaw["status"]?.jsonPrimitive?.contentOrNull
        ?: existing?.get("toolStatus")?.jsonPrimitive?.contentOrNull
        ?: existingRaw?.get("status")?.jsonPrimitive?.contentOrNull
        ?: mergedRawFinal["status"]?.jsonPrimitive?.contentOrNull
        ?: ""

    return buildJsonObject {
        put("role", "assistant")
        put("type", "tool_call")
        put("toolCallId", toolCallId)
        put("toolKind", mergedKind)
        put("toolTitle", mergedTitle)
        put("toolStatus", mergedStatus)
        put("toolRawJson", mergedRawJson)
    }
}

private fun preserveEditDiffContent(
    existingRaw: JsonObject?,
    incomingRaw: JsonObject,
    mergedRaw: JsonObject
): JsonObject {
    val existingContent = existingRaw?.get("content") as? JsonArray ?: return mergedRaw
    if (!existingContent.any(::isDiffLikePayload)) return mergedRaw

    val incomingContent = incomingRaw["content"] as? JsonArray ?: return mergedRaw
    if (incomingContent.any(::isDiffLikePayload)) return mergedRaw

    return buildJsonObject {
        mergedRaw.forEach { (key, value) ->
            if (key != "content") put(key, value)
        }
        put("content", existingContent)
    }
}

private fun parseStoredToolRawJson(rawJson: String): JsonObject? =
    runCatching { Json.parseToJsonElement(rawJson).jsonObject }.getOrNull()

private fun mergeJsonObjects(base: JsonObject?, patch: JsonObject): JsonObject {
    if (base == null) return patch

    return buildJsonObject {
        val keys = linkedSetOf<String>()
        keys.addAll(base.keys)
        keys.addAll(patch.keys)
        keys.forEach { key ->
            val baseValue = base[key]
            val patchValue = patch[key]
            when {
                patchValue == null -> baseValue?.let { put(key, it) }
                baseValue is JsonObject && patchValue is JsonObject -> put(key, mergeJsonObjects(baseValue, patchValue))
                else -> put(key, patchValue)
            }
        }
    }
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
    val parsed = runCatching { Json.parseToJsonElement(rawJson).jsonObject }.getOrNull()
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
    val parsed = runCatching { Json.parseToJsonElement(rawJson).jsonObject }.getOrNull()
    val compacted = parsed?.let { compactToolRawJson(it) } ?: return rawJson
    val compactedRawJson = compacted.toString()
    return if (shouldPreserveToolRawJson(compacted)) {
        HistoryDiffCompactor.compactStoredToolRawJson(compactedRawJson, Json)
    } else {
        compactedRawJson
    }
}

internal fun compactToolRawJsonForDisplay(
    rawJson: String,
    forceReadPath: String? = null,
    forceSearchInput: JsonObject? = null
): String {
    val parsed = runCatching { Json.parseToJsonElement(rawJson).jsonObject }.getOrNull()
    return parsed?.let { compactToolRawJson(it, forceReadPath, forceSearchInput) }?.toString() ?: rawJson
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

private fun compactToolRawJson(
    parsed: JsonObject,
    forceReadPath: String? = null,
    forceSearchInput: JsonObject? = null
): JsonObject {
    normalizeToolRawJson(parsed, forceReadPath, forceSearchInput)?.let { return it }
    if (parsed["kind"]?.jsonPrimitive?.contentOrNull == "edit") return parsed
    val oversizedText = findOversizedToolOutputText(parsed) ?: return parsed

    val removedNotice = buildToolOutputRemovedNotice(oversizedText.length)
    return buildJsonObject {
        parsed.forEach { (key, value) ->
            when (key) {
                "content" -> put(key, buildToolOutputRemovedContent(removedNotice))
                "rawOutput" -> put(key, buildToolOutputRemovedRawOutput(value as? JsonObject, removedNotice))
                else -> put(key, value)
            }
        }
        if (parsed["content"] == null) {
            put("content", buildToolOutputRemovedContent(removedNotice))
        }
    }
}

private fun buildToolOutputRemovedContent(removedNotice: String): JsonArray = buildJsonArray {
    add(
        buildJsonObject {
            put("type", "content")
            put(
                "content",
                buildJsonObject {
                    put("type", "text")
                    put("text", removedNotice)
                }
            )
        }
    )
}

private fun buildToolOutputRemovedRawOutput(rawOutput: JsonObject?, removedNotice: String): JsonObject = buildJsonObject {
    rawOutput?.get("parsed_cmd")?.let { put("parsed_cmd", it) }
    put("formatted_output", removedNotice)
    put("aggregated_output", removedNotice)
    put("message", removedNotice)
    put("content", removedNotice)
    put("stdout", "")
    put("stderr", "")
}

private fun buildToolOutputRemovedNotice(removedCharacters: Int): String =
    "[Output removed: $removedCharacters characters]"

private fun extractToolContentText(item: JsonElement): String? {
    val obj = item as? JsonObject ?: return null
    return (obj["content"] as? JsonObject)
        ?.get("text")
        ?.jsonPrimitive
        ?.contentOrNull
        ?: obj["text"]?.jsonPrimitive?.contentOrNull
}

private fun findOversizedToolOutputText(parsed: JsonObject): String? {
    val content = parsed["content"] as? JsonArray
    if (content != null) {
        content.forEach { item ->
            val text = extractToolContentText(item)
            if (text != null && toolOutputTextExceedsLimit(text)) {
                return text
            }
        }
    }

    val text = (parsed["text"] as? JsonPrimitive)?.contentOrNull
    if (text != null && toolOutputTextExceedsLimit(text)) return text

    val rawOutput = parsed["rawOutput"] as? JsonObject
    return listOf("formatted_output", "aggregated_output", "stdout", "stderr", "message", "content")
        .asSequence()
        .mapNotNull { key -> (rawOutput?.get(key) as? JsonPrimitive)?.contentOrNull }
        .firstOrNull(::toolOutputTextExceedsLimit)
}

private fun toolOutputTextExceedsLimit(text: String): Boolean =
    countLines(text) > MAX_TOOL_OUTPUT_LINES || text.length > MAX_TOOL_OUTPUT_CHARS

private fun countLines(text: String): Int = text.split(Regex("\\r\\n|\\n|\\r")).size

private fun isDiffLikePayload(element: JsonElement): Boolean {
    val obj = element as? JsonObject ?: return false
    val type = obj["type"]?.jsonPrimitive?.contentOrNull
    if (type == "diff") return true
    return obj["path"] != null && obj["newText"] != null
}

internal fun AcpBridge.buildStoredPlanChunk(plan: SessionUpdate, meta: JsonElement?): JsonObject? {
    val entries = extractPlanEntries(plan, meta) ?: return null
    if (entries.isEmpty()) return null
    return buildJsonObject {
        put("role", "assistant")
        put("type", "plan")
        put("planEntries", entries)
    }
}
