package unified.llm.acp

import com.agentclientprotocol.model.*
import kotlinx.serialization.json.*

internal data class ParsedBlocksPayload(
    val chatId: String?,
    val blocks: List<ContentBlock>,
    val rawBlocks: List<JsonObject>
)

internal fun parseIdOnlyPayload(payload: String?): String? {
    return payload?.trim()?.takeIf { it.isNotEmpty() }
}

internal fun parseStartPayload(payload: String?): Triple<String?, String?, String?> {
    val raw = payload?.trim().orEmpty()
    if (raw.isEmpty()) return Triple(null, null, null)
    return try {
        val obj = Json.parseToJsonElement(raw).jsonObject
        val chatId = obj["chatId"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }
        val adapterId = obj["adapterId"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }
        val modelId = obj["modelId"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }
        Triple(chatId, adapterId, modelId)
    } catch (_: Exception) { Triple(null, null, null) }
}

internal fun parseScopedIdPayload(payload: String?, idKey: String): Triple<String?, String?, String?> {
    val raw = payload?.trim().orEmpty()
    if (raw.isEmpty()) return Triple(null, null, null)
    return try {
        val obj = Json.parseToJsonElement(raw).jsonObject
        val chatId = obj["chatId"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }
        val adapterId = obj["adapterId"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }
        val idVal = obj[idKey]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }
        Triple(chatId, adapterId, idVal)
    } catch (_: Exception) { Triple(null, null, null) }
}

internal fun parseConversationLoadPayload(payload: String?): Triple<String?, String?, String?> {
    val raw = payload?.trim().orEmpty()
    if (raw.isEmpty()) return Triple(null, null, null)
    return try {
        val obj = Json.parseToJsonElement(raw).jsonObject
        val chatId = obj["chatId"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }
        val projectPath = obj["projectPath"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }
        val conversationId = obj["conversationId"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }
        Triple(chatId, projectPath, conversationId)
    } catch (_: Exception) { Triple(null, null, null) }
}

internal fun parseHistoryConversationCliPayload(payload: String?): Pair<String?, String?> {
    val raw = payload?.trim().orEmpty()
    if (raw.isEmpty()) return null to null
    return try {
        val obj = Json.parseToJsonElement(raw).jsonObject
        val projectPath = obj["projectPath"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }
        val conversationId = obj["conversationId"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }
        projectPath to conversationId
    } catch (_: Exception) {
        null to null
    }
}

internal fun parseBlocksPayload(payload: String?): ParsedBlocksPayload {
    val raw = payload?.trim().orEmpty()
    if (raw.isEmpty()) return ParsedBlocksPayload(null, emptyList(), emptyList())
    return try {
        val obj = Json.parseToJsonElement(raw).jsonObject
        val chatId = obj["chatId"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }

        // 1. Try to get blocks directly if present
        val blocksElement = obj["blocks"]
        if (blocksElement != null) {
            return ParsedBlocksPayload(
                chatId = chatId,
                blocks = parseContentBlocks(blocksElement),
                rawBlocks = blocksElement.jsonArray.mapNotNull { it as? JsonObject }
            )
        }

        // 2. Fallback to text field
        val textValue = obj["text"]?.jsonPrimitive?.content ?: ""

        // 3. If textValue looks like a JSON array of blocks, try to parse it (compatibility with current UI)
        if (textValue.startsWith("[") && textValue.endsWith("]")) {
            try {
                val rawBlocks = Json.parseToJsonElement(textValue).jsonArray.mapNotNull { it as? JsonObject }
                val blocks = parseContentBlocks(JsonArray(rawBlocks))
                if (blocks.isNotEmpty()) {
                    return ParsedBlocksPayload(chatId = chatId, blocks = blocks, rawBlocks = rawBlocks)
                }
            } catch (_: Exception) {}
        }

        // 4. Final fallback: treat as plain text
        ParsedBlocksPayload(
            chatId = chatId,
            blocks = listOf(ContentBlock.Text(textValue)),
            rawBlocks = listOf(
                buildJsonObject {
                    put("type", "text")
                    put("text", textValue)
                }
            )
        )
    } catch (_: Exception) { ParsedBlocksPayload(null, emptyList(), emptyList()) }
}

internal fun parseContentBlocks(blocksElement: JsonElement): List<ContentBlock> {
    return blocksElement.jsonArray.map { blockEl ->
        val blockObj = blockEl.jsonObject
        val type = blockObj["type"]?.jsonPrimitive?.content
        when (type) {
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
                val name = blockObj["name"]?.jsonPrimitive?.content ?: type!!
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
