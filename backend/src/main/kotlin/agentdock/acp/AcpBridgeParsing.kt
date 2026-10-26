package agentdock.acp

import com.agentclientprotocol.model.*
import agentdock.history.ForkConversationBase
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

internal data class ParsedStartPayload(
    val requestId: String?,
    val chatId: String?,
    val adapterId: String?,
    val configValues: Map<String, String>
)

internal data class ParsedBlocksPayload(
    val requestId: String?,
    val chatId: String?,
    val blocks: List<ContentBlock>,
    val rawBlocks: List<JsonObject>,
    val forkBase: ForkConversationBase?,
    val adapterId: String?,
    val configValues: Map<String, String>
)

internal data class ParsedRememberConfigPayload(
    val adapterId: String,
    val configValues: Map<String, String>,
    val modelByMode: Map<String, String>,
    val effortByModel: Map<String, String>
)

internal data class ParsedCancelPayload(
    val requestId: String?,
    val chatId: String?
)

private val bridgePayloadJson = Json { ignoreUnknownKeys = true }

/** JSON fields sent with UI bridge requests; each parser reads the fields of its own request. */
@Serializable
private class BridgePayload(
    val requestId: String? = null,
    val chatId: String? = null,
    val adapterId: String? = null,
    val methodId: String? = null,
    val view: Boolean = false,
    val projectPath: String? = null,
    val conversationId: String? = null,
    val text: String? = null,
    val forkBase: ForkBasePayload? = null,
    // Kept as raw JSON so one malformed value drops only that entry, not the whole request.
    val configValues: JsonObject? = null,
    val modelByMode: JsonObject? = null,
    val effortByModel: JsonObject? = null
)

@Serializable
private class ForkBasePayload(val sourceConversationId: String? = null, val promptCount: Int? = null)

private fun decodeBridgePayload(payload: String): BridgePayload? =
    runCatching { bridgePayloadJson.decodeFromString<BridgePayload>(payload.trim()) }.getOrNull()

private fun String?.nonBlank(): String? = this?.takeIf { it.isNotBlank() }

internal fun parseIdOnlyPayload(payload: String): String? {
    return payload.trim().takeIf { it.isNotEmpty() }
}

internal fun parseFetchUsagePayload(payload: String): Pair<String?, Boolean> {
    val parsed = decodeBridgePayload(payload)
    return parsed?.adapterId.nonBlank() to (parsed?.view ?: false)
}

internal fun parseAdapterAuthMethodPayload(payload: String): Pair<String?, String?> {
    val parsed = decodeBridgePayload(payload)
    return parsed?.adapterId.nonBlank() to parsed?.methodId.nonBlank()
}

internal fun parseStartRequestPayload(payload: String): ParsedStartPayload {
    val parsed = decodeBridgePayload(payload)
    return ParsedStartPayload(
        requestId = parsed?.requestId.nonBlank(),
        chatId = parsed?.chatId.nonBlank(),
        adapterId = parsed?.adapterId.nonBlank(),
        configValues = normalizeConfigValues(parsed?.configValues)
    )
}

internal fun parseRememberConfigPayload(payload: String): ParsedRememberConfigPayload? {
    val parsed = decodeBridgePayload(payload) ?: return null
    return ParsedRememberConfigPayload(
        adapterId = parsed.adapterId.nonBlank() ?: return null,
        configValues = normalizeConfigValues(parsed.configValues),
        modelByMode = normalizeConfigValues(parsed.modelByMode),
        effortByModel = normalizeConfigValues(parsed.effortByModel)
    )
}

internal fun parseConversationLoadPayload(payload: String): Triple<String?, String?, String?> {
    val parsed = decodeBridgePayload(payload)
    return Triple(parsed?.chatId.nonBlank(), parsed?.projectPath.nonBlank(), parsed?.conversationId.nonBlank())
}

internal fun parseHistoryConversationCliPayload(payload: String): Pair<String?, String?> {
    val parsed = decodeBridgePayload(payload)
    return parsed?.projectPath.nonBlank() to parsed?.conversationId.nonBlank()
}

internal fun parseBlocksPayload(payload: String): ParsedBlocksPayload {
    val parsed = decodeBridgePayload(payload)
        ?: return ParsedBlocksPayload(null, null, emptyList(), emptyList(), null, null, emptyMap())
    val textValue = parsed.text.orEmpty()

    // The UI sends content blocks as a JSON array inside the text field.
    val structured = textValue.takeIf { it.startsWith("[") && it.endsWith("]") }?.let { text ->
        runCatching {
            val rawBlocks = Json.parseToJsonElement(text).jsonArray.filterIsInstance<JsonObject>()
            parseContentBlocks(JsonArray(rawBlocks)) to rawBlocks
        }.getOrNull()
    }?.takeIf { (blocks, _) -> blocks.isNotEmpty() }

    // Fallback: treat as plain text
    val (blocks, rawBlocks) = structured ?: (
        listOf(ContentBlock.Text(textValue)) to listOf(
            buildJsonObject {
                put("type", "text")
                put("text", textValue)
            }
        )
    )
    val forkBase = parsed.forkBase?.let { base ->
        val sourceConversationId = base.sourceConversationId?.trim().orEmpty()
        val promptCount = base.promptCount ?: 0
        if (sourceConversationId.isBlank() || promptCount <= 0) null
        else ForkConversationBase(sourceConversationId = sourceConversationId, promptCount = promptCount)
    }
    return ParsedBlocksPayload(
        requestId = parsed.requestId.nonBlank(),
        chatId = parsed.chatId.nonBlank(),
        blocks = blocks,
        rawBlocks = rawBlocks,
        forkBase = forkBase,
        adapterId = parsed.adapterId.nonBlank(),
        configValues = normalizeConfigValues(parsed.configValues)
    )
}

private fun normalizeConfigValues(values: JsonObject?): Map<String, String> =
    values.orEmpty().mapNotNull { (id, value) ->
        val normalizedId = id.trim()
        val normalizedValue = (value as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()
        if (normalizedId.isEmpty() || normalizedValue.isEmpty()) null else normalizedId to normalizedValue
    }.toMap()

internal fun parseCancelPayload(payload: String): ParsedCancelPayload {
    val parsed = decodeBridgePayload(payload)
        ?: return ParsedCancelPayload(null, payload.trim().takeIf { it.isNotBlank() })
    return ParsedCancelPayload(parsed.requestId.nonBlank(), parsed.chatId.nonBlank())
}

internal fun parseContentBlocks(blocksElement: JsonElement): List<ContentBlock> {
    return blocksElement.jsonArray.map { blockEl ->
        val blockObj = blockEl.jsonObject
        when (val type = blockObj["type"]?.jsonPrimitive?.content) {
            "image" -> {
                val data = blockObj["data"]?.jsonPrimitive?.content ?: ""
                val mimeType = blockObj["mimeType"]?.jsonPrimitive?.content ?: "image/png"
                ContentBlock.Image(data, mimeType)
            }
            "audio" -> {
                val data = blockObj["data"]?.jsonPrimitive?.content ?: ""
                val mimeType = blockObj["mimeType"]?.jsonPrimitive?.content ?: "audio/wav"
                ContentBlock.Audio(data, mimeType)
            }
            "video", "file" -> {
                val data = blockObj["data"]?.jsonPrimitive?.content
                val path = blockObj["path"]?.jsonPrimitive?.content
                val defaultMime = if (type == "video") "video/mp4" else "application/octet-stream"
                val mimeType = blockObj["mimeType"]?.jsonPrimitive?.content ?: defaultMime
                val fallbackName = if (type == "video") "video" else "file"
                val name = blockObj["name"]?.jsonPrimitive?.content ?: fallbackName
                fileOrVideoBlock(name, mimeType, data, path)
            }
            "code_ref" -> codeRefBlockToText(blockObj)
            else -> {
                val text = blockObj["text"]?.jsonPrimitive?.content ?: ""
                ContentBlock.Text(text)
            }
        }
    }
}

internal fun fileOrVideoBlock(name: String, mimeType: String, data: String?, path: String?): ContentBlock {
    if (data != null) {
        val uri = if (path != null) "file:///${path.replace("\\", "/").trimStart('/')}" else "file:///$name"
        return ContentBlock.Resource(
            resource = EmbeddedResourceResource.BlobResourceContents(blob = data, uri = uri, mimeType = mimeType)
        )
    }
    if (path != null) {
        return ContentBlock.ResourceLink(
            name = name, uri = "file:///${path.replace("\\", "/").trimStart('/')}", mimeType = mimeType
        )
    }
    return ContentBlock.Text("[File: $name]")
}

internal fun codeRefBlockToText(blockObj: JsonObject): ContentBlock.Text {
    val path = blockObj["path"]?.jsonPrimitive?.content ?: ""
    val startLine = blockObj["startLine"]?.jsonPrimitive?.intOrNull
    val endLine = blockObj["endLine"]?.jsonPrimitive?.intOrNull ?: startLine
    val text = if (path.isNotBlank() && startLine != null && startLine > 0) {
        if (startLine == endLine) "@${path}#L${startLine}" else "@${path}#L${startLine}-${endLine}"
    } else if (path.isNotBlank()) {
        "@${path}"
    } else {
        blockObj["text"]?.jsonPrimitive?.content ?: ""
    }
    return ContentBlock.Text(text)
}

internal data class SerializedContentBlock(
    val type: String,
    val text: String? = null,
    val data: String? = null,
    val mimeType: String? = null
)

internal fun contentBlockHasVisibleOutput(content: ContentBlock, textType: String = "text"): Boolean {
    val serialized = serializeContentBlock(content, textType) ?: return false
    return when (serialized.type) {
        "text", "thinking" -> !serialized.text.isNullOrBlank()
        else -> true
    }
}

internal fun serializeContentBlock(content: ContentBlock, textType: String = "text"): SerializedContentBlock? {
    return when (content) {
        is ContentBlock.Text -> SerializedContentBlock(type = textType, text = content.text)
        is ContentBlock.Image -> SerializedContentBlock(type = "image", data = content.data, mimeType = content.mimeType)
        is ContentBlock.Audio -> SerializedContentBlock(type = "audio", data = content.data, mimeType = content.mimeType)
        is ContentBlock.ResourceLink -> {
            if (content.uri.startsWith("data:")) {
                SerializedContentBlock(type = "file", data = content.uri.substringAfter("base64,"), mimeType = content.mimeType)
            } else {
                SerializedContentBlock(type = "file", text = "[File: ${content.uri}]", mimeType = content.mimeType)
            }
        }
        is ContentBlock.Resource -> {
            when (val res = content.resource) {
                is EmbeddedResourceResource.BlobResourceContents -> SerializedContentBlock(
                    type = "file",
                    data = res.blob,
                    mimeType = res.mimeType
                )
                is EmbeddedResourceResource.TextResourceContents -> SerializedContentBlock(
                    type = "file",
                    text = res.text,
                    mimeType = res.mimeType
                )
            }
        }
    }
}
