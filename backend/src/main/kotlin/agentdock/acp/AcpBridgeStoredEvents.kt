package agentdock.acp

import com.agentclientprotocol.model.ContentBlock
import com.agentclientprotocol.model.SessionUpdate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import agentdock.history.ConversationAssistantMetadata
import agentdock.history.ConversationConfigOptionMetadata
import agentdock.history.HistoryDiffCompactor
import agentdock.history.AgentDockHistoryService

private val replayIgnoredUserCommandTags = listOf(
    "command-name",
    "command-message",
    "command-args",
    "local-command-stdout",
    "local-command-stderr",
    "task-notification"
)

private val replayIgnoredUserCommandRegexes = replayIgnoredUserCommandTags.map { tag ->
    Regex("<$tag>.*?</$tag>", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))
}

private val replayImageMimeTypeRegex = Regex("^image/[A-Za-z0-9.+-]+$", RegexOption.IGNORE_CASE)

private const val MAX_TOOL_OUTPUT_LINES = 100
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
        val prompt = getOrCreateReplayPrompt(session)
        val role = event["role"]?.jsonPrimitive?.contentOrNull
        if (role == "assistant" && prompt.assistantMeta == null) {
            prompt.assistantMeta = buildAssistantMetadata(
                adapterName = adapterName
            )
        }
        upsertStoredToolEvent(prompt.events, event)
        return
    }

    val capture = livePromptCaptures[chatId]
    if (capture != null) {
        val persistAfterCapture = synchronized(capture) {
            when {
                !capture.closed -> {
                    upsertStoredToolEvent(capture.events, event)
                    false
                }
                !capture.historyPersisted -> {
                    upsertStoredToolEvent(capture.lateEvents, event)
                    false
                }
                else -> true
            }
        }
        if (persistAfterCapture) {
            enqueueLateHistoryEvent(chatId, sessionId, adapterName, event)
        }
        return
    }

    enqueueLateHistoryEvent(chatId, sessionId, adapterName, event)
}

private fun AcpBridge.enqueueLateHistoryEvent(
    chatId: String,
    sessionId: String,
    adapterName: String,
    event: JsonObject
) {
    val queue = lateHistoryEventQueues.computeIfAbsent(chatId) {
        Channel<LateHistoryEvent>(Channel.UNLIMITED).also { created ->
            scope.launch(Dispatchers.IO) {
                for ((eventSessionId, eventAdapterName, storedEvent) in created) {
                    runCatching {
                        AgentDockHistoryService.updateLastConversationPromptEvents(
                            service.project.basePath,
                            chatId,
                            eventSessionId,
                            eventAdapterName
                        ) { events -> upsertStoredToolEvent(events, storedEvent) }
                    }
                }
            }
        }
    }
    queue.trySend(LateHistoryEvent(sessionId, adapterName, event))
}

internal fun upsertStoredToolEvent(events: MutableList<JsonObject>, event: JsonObject) {
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

private fun mergeStoredToolEvent(events: List<JsonObject>, event: JsonObject): JsonObject? {
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
    val mergedRawFinal = when (mergedKind) {
        "edit" -> mergeEditDiffContent(existingRaw, incomingRaw, mergedRaw)
        else -> mergeStoredToolOutput(existingRaw, incomingRaw, mergedRaw)
    }
    val mergedRawJson = storedToolRawJson(mergedRawFinal, mergedKind in FULL_OUTPUT_TOOL_KINDS)

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

internal fun mergeStoredToolOutput(
    existingRaw: JsonObject?,
    incomingRaw: JsonObject,
    mergedRaw: JsonObject
): JsonObject {
    val existingContent = (existingRaw?.get("content") as? JsonArray).orEmpty()
    val incomingContent = (incomingRaw["content"] as? JsonArray).orEmpty()
    val existingOutput = extractStoredToolOutputText(existingRaw)
    val incomingOutput = extractStoredToolOutputText(incomingRaw)
    if (existingContent.isEmpty() && incomingContent.isEmpty()
        && (existingOutput == null || incomingOutput == null)
    ) return mergedRaw

    return buildJsonObject {
        mergedRaw.forEach { (key, value) ->
            if (key != "content") put(key, value)
        }
        put(
            "content",
            mergeStoredToolContent(
                existingContent,
                incomingContent,
                existingOutput,
                incomingOutput
            )
        )
    }
}

private fun mergeStoredToolContent(
    existingContent: List<JsonElement>,
    incomingContent: List<JsonElement>,
    existingOutput: String?,
    incomingOutput: String?
): JsonArray {
    val mergedOutput = if (existingOutput != null && incomingOutput != null) {
        mergeStoredExecuteOutput(existingOutput, incomingOutput)
    } else {
        incomingOutput ?: existingOutput
    }
    val incomingTextBlocks = incomingContent.filter { extractToolContentText(it) != null }
    val incomingStructuredBlocks = incomingContent.filter { extractToolContentText(it) == null }
    val existingHasTextBlock = existingContent.any { extractToolContentText(it) != null }
    val isIncomingSnapshot = existingOutput != null
        && incomingOutput != null
        && mergedOutput == incomingOutput
    val keepsExistingText = existingOutput != null
        && incomingOutput != null
        && mergedOutput == existingOutput

    return buildJsonArray {
        if (isIncomingSnapshot) {
            var insertedText = false
            existingContent.forEach { item ->
                if (extractToolContentText(item) == null) {
                    add(item)
                } else if (!insertedText) {
                    if (incomingTextBlocks.isEmpty()) {
                        add(storedToolTextContent(mergedOutput))
                    } else {
                        incomingTextBlocks.forEach { add(it) }
                    }
                    insertedText = true
                }
            }
            if (!insertedText) {
                if (incomingTextBlocks.isEmpty()) {
                    add(storedToolTextContent(mergedOutput))
                } else {
                    incomingTextBlocks.forEach { add(it) }
                }
            }
            incomingStructuredBlocks.forEach { item ->
                if (item !in existingContent) add(item)
            }
        } else {
            existingContent.forEach { add(it) }
            incomingContent.forEach { item ->
                if (extractToolContentText(item) != null) {
                    if (!keepsExistingText) add(item)
                } else if (item !in existingContent) {
                    add(item)
                }
            }
            if (existingOutput != null && incomingOutput != null && incomingTextBlocks.isEmpty()) {
                add(storedToolTextContent(
                    if (existingHasTextBlock && !keepsExistingText) incomingOutput else mergedOutput.orEmpty()
                ))
            }
        }
    }
}

private fun storedToolTextContent(text: String): JsonObject = buildJsonObject {
    put("type", "content")
    put("content", buildJsonObject {
        put("type", "text")
        put("text", text)
    })
}

private fun extractStoredToolOutputText(raw: JsonObject?): String? {
    if (raw == null) return null
    val contentTexts = (raw["content"] as? JsonArray)
        ?.mapNotNull(::extractToolContentText)
        .orEmpty()
    if (contentTexts.isNotEmpty()) return contentTexts.joinToString("\n\n")

    (raw["text"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotEmpty() }?.let { return it }
    val rawOutput = raw["rawOutput"] as? JsonObject
    return listOf("message", "content")
        .asSequence()
        .mapNotNull { key -> (rawOutput?.get(key) as? JsonPrimitive)?.contentOrNull }
        .firstOrNull { it.isNotEmpty() }
}

private fun mergeStoredExecuteOutput(existing: String, incoming: String): String {
    val normalizedExisting = existing.replace("\r\n", "\n").replace('\r', '\n')
    val normalizedIncoming = incoming.replace("\r\n", "\n").replace('\r', '\n')
    if (normalizedIncoming == normalizedExisting || normalizedIncoming.startsWith(normalizedExisting)) {
        return incoming
    }
    if (normalizedExisting.endsWith(normalizedIncoming)) return existing
    return "$existing\n\n$incoming"
}

internal fun mergeEditDiffContent(
    existingRaw: JsonObject?,
    incomingRaw: JsonObject,
    mergedRaw: JsonObject
): JsonObject {
    val existingContent = existingRaw?.get("content") as? JsonArray ?: return mergedRaw
    if (!existingContent.any(::isDiffLikePayload)) return mergedRaw

    val incomingContent = incomingRaw["content"] as? JsonArray ?: return mergedRaw
    val incomingDiffs = incomingContent.filter(::isDiffLikePayload)
    if (incomingDiffs.isEmpty()) {
        return buildJsonObject {
            mergedRaw.forEach { (key, value) ->
                if (key != "content") put(key, value)
            }
            put("content", existingContent)
        }
    }

    val incomingDiffsByPath = incomingDiffs
        .mapNotNull { diff -> diffPath(diff)?.let { path -> path to diff } }
        .groupBy({ it.first }, { it.second })
    val emittedPaths = mutableSetOf<String>()
    val mergedContent = buildJsonArray {
        existingContent.forEach { item ->
            val path = diffPath(item)
            val replacements = path?.let(incomingDiffsByPath::get)
            if (replacements == null) {
                add(item)
            } else if (emittedPaths.add(path)) {
                replacements.forEach { replacement -> add(replacement) }
            }
        }

        incomingContent.forEach { item ->
            if (!isDiffLikePayload(item)) {
                add(item)
                return@forEach
            }
            val path = diffPath(item)
            if (path == null || emittedPaths.add(path)) {
                if (path == null) {
                    add(item)
                } else {
                    incomingDiffsByPath[path].orEmpty().forEach { replacement -> add(replacement) }
                }
            }
        }
    }

    return buildJsonObject {
        mergedRaw.forEach { (key, value) ->
            if (key != "content") put(key, value)
        }
        put("content", mergedContent)
    }
}

private fun diffPath(element: JsonElement): String? {
    if (!isDiffLikePayload(element)) return null
    return (element as? JsonObject)
        ?.get("path")
        ?.jsonPrimitive
        ?.contentOrNull
        ?.takeIf { it.isNotBlank() }
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

internal fun storedReplayPromptBlockFromContentBlock(content: ContentBlock): JsonObject? {
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
    replayDataUriImageBlock(sanitizedText)?.let { return it }
    return buildJsonObject {
        put("type", serialized.type)
        put("text", sanitizedText)
        serialized.data?.let { put("data", it) }
        serialized.mimeType?.let { put("mimeType", it) }
    }
}

private fun replayDataUriImageBlock(text: String): JsonObject? {
    val trimmed = text.trim()
    val markdown = trimmed.removePrefix("!")
    if (!markdown.startsWith("[") || !markdown.endsWith(")")) return null

    val targetStart = markdown.indexOf("](")
    if (targetStart < 1) return null
    val dataUri = markdown.substring(targetStart + 2, markdown.lastIndex)
    if (!dataUri.startsWith("data:image/", ignoreCase = true)) return null

    val base64Marker = ";base64,"
    val base64MarkerIndex = dataUri.indexOf(base64Marker, ignoreCase = true)
    if (base64MarkerIndex <= "data:".length) return null

    val mimeType = dataUri.substring("data:".length, base64MarkerIndex)
    if (!replayImageMimeTypeRegex.matches(mimeType)) return null
    val data = dataUri.substring(base64MarkerIndex + base64Marker.length)
    if (!isValidReplayBase64(data)) return null

    return buildJsonObject {
        put("type", "image")
        put("data", data)
        put("mimeType", mimeType.lowercase())
    }
}

private fun isValidReplayBase64(data: String): Boolean {
    if (data.isEmpty() || data.length % 4 != 0) return false
    var padding = 0
    data.forEachIndexed { index, char ->
        val isBase64Character = char in 'A'..'Z' || char in 'a'..'z' || char in '0'..'9' || char == '+' || char == '/'
        when {
            isBase64Character && padding == 0 -> Unit
            char == '=' && index >= data.length - 2 && ++padding <= 2 -> Unit
            else -> return false
        }
    }
    return true
}

internal fun sanitizeReplayUserText(text: String): String? {
    var sanitized = text
    replayIgnoredUserCommandRegexes.forEach { regex ->
        sanitized = sanitized.replace(regex, "")
    }
    return sanitized.takeUnless { it.isBlank() }
}

internal fun storedEventFromContentBlock(role: String, content: ContentBlock, isThought: Boolean): JsonObject? {
    val serialized = serializeContentBlock(content, if (isThought) "thinking" else "text") ?: return null
    return buildStoredContentChunk(
        role = role,
        type = serialized.type,
        text = serialized.text,
        data = serialized.data,
        mimeType = serialized.mimeType
    )
}

internal fun buildStoredContentChunk(
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
    chatId: String? = null,
    promptStartedAtMillis: Long? = null,
    durationSeconds: Double? = null,
    contextTokensUsed: Long? = null,
    contextWindowSize: Long? = null
): ConversationAssistantMetadata? {
    val cleanAdapterName = adapterName.trim()
    if (cleanAdapterName.isBlank()) return null

    val adapterInfo = runCatching { AcpAdapterPaths.getAdapterInfo(cleanAdapterName) }.getOrNull()
    val runtimeMetadata = chatId?.let(service::sessionRuntimeMetadata)
        ?: service.adapterRuntimeMetadata(cleanAdapterName)
    val configOptions = runtimeMetadata?.configOptions.orEmpty().mapNotNull { option ->
        val value = option.currentValue.trim()
        if (value.isEmpty()) return@mapNotNull null
        ConversationConfigOptionMetadata(
            id = option.id,
            name = option.name,
            value = value,
            displayValue = option.options.firstOrNull { it.value == value }?.name ?: value
        )
    }

    return ConversationAssistantMetadata(
        agentId = cleanAdapterName,
        agentName = adapterInfo?.name ?: cleanAdapterName,
        promptStartedAtMillis = promptStartedAtMillis,
        durationSeconds = durationSeconds,
        contextTokensUsed = contextTokensUsed,
        contextWindowSize = contextWindowSize,
        configOptions = configOptions
    )
}

internal fun buildStoredToolCallChunk(raw: JsonObject): JsonObject {
    return buildJsonObject {
        put("role", "assistant")
        put("type", "tool_call")
        put("toolCallId", raw["toolCallId"]?.jsonPrimitive?.contentOrNull ?: "")
        put("toolKind", raw["kind"]?.jsonPrimitive?.contentOrNull ?: "")
        put("toolTitle", raw["title"]?.jsonPrimitive?.contentOrNull ?: "")
        put("toolStatus", raw["status"]?.jsonPrimitive?.contentOrNull ?: "")
        put("toolRawJson", storedToolRawJson(raw))
    }
}

internal fun buildStoredToolCallUpdateChunk(toolCallId: String, raw: JsonObject, fullOutput: Boolean): JsonObject {
    return buildJsonObject {
        put("role", "assistant")
        put("type", "tool_call_update")
        put("toolCallId", toolCallId)
        put("toolRawJson", storedToolRawJson(raw, fullOutput))
    }
}

internal fun storedToolRawJson(raw: JsonObject, fullOutput: Boolean = false): String {
    val compacted = compactToolRawJson(raw, fullOutput)
    val compactedRawJson = compacted.toString()
    return if (shouldPreserveToolRawJson(compacted)) {
        HistoryDiffCompactor.compactStoredToolRawJson(compactedRawJson, Json)
    } else {
        compactedRawJson
    }
}

private fun shouldPreserveToolRawJson(parsed: JsonObject?): Boolean {
    if (parsed == null) return false
    val kind = parsed["kind"]?.jsonPrimitive?.contentOrNull
    if (kind == "edit") return true

    val content = parsed["content"]?.jsonArray
    if (content != null && content.any(::isDiffLikePayload)) return true

    val diffs = parsed["diffs"]?.jsonArray
    return diffs != null && diffs.any(::isDiffLikePayload)
}

// Edits need full diffs for undo, and subagent reports are read in full.
private val FULL_OUTPUT_TOOL_KINDS = setOf("edit", "think", "task")

// Full output is not truncated, so a gigantic payload, such as an edit of a huge or minified file,
// would freeze JCEF. Such a payload is reduced to the tool call identity and is not shown.
private const val MAX_FULL_OUTPUT_TOOL_CALL_CHARS = 1_000_000
private val TOOL_CALL_IDENTITY_KEYS = setOf("toolCallId", "kind", "title", "status", "locations")

internal fun dropOversizedToolCallPayload(raw: JsonObject): JsonObject {
    if (raw.toString().length <= MAX_FULL_OUTPUT_TOOL_CALL_CHARS) return raw
    return JsonObject(raw.filterKeys { it in TOOL_CALL_IDENTITY_KEYS } + ("content" to JsonArray(emptyList())))
}

internal fun hasFullOutputToolKind(raw: JsonObject): Boolean =
    (raw["kind"] as? JsonPrimitive)?.contentOrNull in FULL_OUTPUT_TOOL_KINDS

// Long tool output is truncated before it reaches the UI or history, wherever the adapter puts it.
// Tool input, diffs and inline images stay intact: diffs are needed for undo, and images are shown.
internal fun compactToolRawJson(parsed: JsonObject, fullOutput: Boolean): JsonObject {
    if (fullOutput || (parsed["kind"] as? JsonPrimitive)?.contentOrNull in FULL_OUTPUT_TOOL_KINDS) return parsed
    return JsonObject(parsed.mapValues { (key, value) -> if (key == "rawInput") value else limitToolOutputStrings(value) })
}

private val INLINE_IMAGE_PREFIXES = listOf("data:image/", "iVBORw", "/9j/")

private fun limitToolOutputStrings(element: JsonElement): JsonElement = when {
    isDiffLikePayload(element) -> element
    element is JsonObject && (element["type"] as? JsonPrimitive)?.contentOrNull == "image" -> element
    element is JsonObject -> JsonObject(element.mapValues { (_, value) -> limitToolOutputStrings(value) })
    element is JsonArray -> JsonArray(element.map(::limitToolOutputStrings))
    element is JsonPrimitive && element.isString && INLINE_IMAGE_PREFIXES.none { element.content.trimStart().startsWith(it) } ->
        limitToolOutputText(element.content).let { if (it === element.content) element else JsonPrimitive(it) }
    else -> element
}

// The result, notice included, stays within the limits, so compacting it again changes nothing.
private fun limitToolOutputText(text: String): String {
    val lines = text.split(Regex("\\r\\n|\\n|\\r"))
    if (lines.size <= MAX_TOOL_OUTPUT_LINES && text.length <= MAX_TOOL_OUTPUT_CHARS) return text
    val kept = lines.take(MAX_TOOL_OUTPUT_LINES - 1).joinToString("\n").take(MAX_TOOL_OUTPUT_CHARS - 100)
    val omittedLines = lines.size - kept.lines().size
    return "$kept\n… " + if (omittedLines > 0) "$omittedLines more lines" else "${text.length - kept.length} more characters"
}

private fun extractToolContentText(item: JsonElement): String? {
    val obj = item as? JsonObject ?: return null
    return (obj["content"] as? JsonObject)
        ?.get("text")
        ?.jsonPrimitive
        ?.contentOrNull
        ?: obj["text"]?.jsonPrimitive?.contentOrNull
}

private fun isDiffLikePayload(element: JsonElement): Boolean {
    val obj = element as? JsonObject ?: return false
    val type = (obj["type"] as? JsonPrimitive)?.contentOrNull
    return type == "diff" || (obj["path"] != null && obj["newText"] != null)
}

internal fun buildStoredPlanChunk(plan: SessionUpdate, meta: JsonElement?): JsonObject? {
    val entries = extractPlanEntries(plan, meta) ?: return null
    if (entries.isEmpty()) return null
    return buildStoredPlanChunk(entries)
}

internal fun buildStoredPlanChunk(entries: JsonArray): JsonObject {
    return buildJsonObject {
        put("role", "assistant")
        put("type", "plan")
        put("planEntries", entries)
    }
}
