package unified.llm.history

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import unified.llm.acp.AcpAdapterConfig
import java.io.File
import java.time.Instant

interface HistoryParser {
    fun parseMeta(file: File, adapterInfo: AcpAdapterConfig.AdapterInfo, projectPath: String): SessionMeta?
}

object HistoryParserRegistry {
    private val parsers: Map<String, HistoryParser> = mapOf(
        "json_array" to JsonArrayParser(),
        "jsonl_stream" to JsonlStreamParser(),
        "json_object" to JsonObjectParser()
    )

    fun getParser(strategy: String): HistoryParser? = parsers[strategy]
}

private fun JsonObject.stringOrNull(key: String): String? {
    val value = this[key] ?: return null
    return (value as? JsonPrimitive)?.content
}

private fun parseTimestamp(value: String?): Long? {
    if (value.isNullOrBlank()) return null
    return value.toLongOrNull() ?: runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()
}

private fun fallbackTitle(raw: String?): String = raw?.trim().orEmpty().ifBlank { "Untitled Session" }.take(80)

// Maximum lines to scan when parsing JSONL files to extract title and metadata
private const val MAX_LINES_TO_SCAN = 40

private fun extractValue(obj: JsonObject, path: String): String? {
    val segments = path.split(".")
    var current: JsonObject? = obj
    for (i in 0 until segments.size - 1) {
        current = current?.get(segments[i])?.jsonObject ?: return null
    }
    val leaf = current?.get(segments.last())
    return (leaf as? JsonPrimitive)?.content
}

private fun extractCustomVars(obj: JsonObject, adapterInfo: AcpAdapterConfig.AdapterInfo): Map<String, String>? {
    val extraction = adapterInfo.historyConfig?.metadataExtraction ?: return null
    if (extraction.isEmpty()) return null
    
    val result = mutableMapOf<String, String>()
    extraction.forEach { (varName, jsonPath) ->
        val value = extractValue(obj, jsonPath)
        if (value != null) {
            result[varName] = value
        }
    }
    return result.takeIf { it.isNotEmpty() }
}

private class JsonArrayParser : HistoryParser {
    private val json = Json { ignoreUnknownKeys = true }

    override fun parseMeta(file: File, adapterInfo: AcpAdapterConfig.AdapterInfo, projectPath: String): SessionMeta? {
        val root = runCatching { json.parseToJsonElement(file.readText()).jsonObject }.getOrNull() ?: return null
        val sessionId = root.stringOrNull("sessionId") ?: root.stringOrNull("id") ?: file.nameWithoutExtension
        val firstMessage = root["messages"]?.jsonArray?.firstOrNull()?.jsonObject
        val title = fallbackTitle(
            root.stringOrNull("title")
                ?: firstMessage?.stringOrNull("content")
                ?: firstMessage?.get("content")?.jsonArray?.firstOrNull()?.jsonObject?.stringOrNull("text")
        )
        val updatedAt = parseTimestamp(root.stringOrNull("updatedAt"))
            ?: parseTimestamp(root.stringOrNull("lastUpdated"))
            ?: file.lastModified()
        val createdAt = parseTimestamp(root.stringOrNull("createdAt"))
            ?: parseTimestamp(root.stringOrNull("startTime"))
            ?: updatedAt

        return SessionMeta(
            sessionId = sessionId,
            adapterName = adapterInfo.name,
            modelId = adapterInfo.defaultModelId,
            modeId = adapterInfo.defaultModeId,
            projectPath = projectPath,
            title = title,
            filePath = file.absolutePath,
            customVariables = extractCustomVars(root, adapterInfo),
            createdAt = createdAt,
            updatedAt = updatedAt
        )
    }
}

private class JsonlStreamParser : HistoryParser {
    private val json = Json { ignoreUnknownKeys = true }

    override fun parseMeta(file: File, adapterInfo: AcpAdapterConfig.AdapterInfo, projectPath: String): SessionMeta? {
        var title: String? = null
        var customVars: Map<String, String>? = null
        runCatching {
            file.useLines { lines ->
                for ((index, line) in lines.withIndex().take(MAX_LINES_TO_SCAN)) {
                    if (!line.trimStart().startsWith("{")) continue
                    val obj = json.parseToJsonElement(line).jsonObject
                    
                    // Extract custom vars (usually on the first line metadata)
                    if (index == 0) {
                        customVars = extractCustomVars(obj, adapterInfo)
                    }

                    val role = obj.stringOrNull("role")?.lowercase()
                    val text = obj.stringOrNull("content") ?: obj.stringOrNull("text")
                    if (role == "user" && !text.isNullOrBlank()) {
                        title = text
                        if (customVars != null) break 
                    }
                }
            }
        }

        return SessionMeta(
            sessionId = file.nameWithoutExtension,
            adapterName = adapterInfo.name,
            modelId = adapterInfo.defaultModelId,
            modeId = adapterInfo.defaultModeId,
            projectPath = projectPath,
            title = fallbackTitle(title),
            filePath = file.absolutePath,
            customVariables = customVars,
            createdAt = file.lastModified(),
            updatedAt = file.lastModified()
        )
    }
}

private class JsonObjectParser : HistoryParser {
    private val json = Json { ignoreUnknownKeys = true }

    override fun parseMeta(file: File, adapterInfo: AcpAdapterConfig.AdapterInfo, projectPath: String): SessionMeta? {
        val root = runCatching { json.parseToJsonElement(file.readText()).jsonObject }.getOrNull() ?: return null
        val sessionId = root.stringOrNull("sessionId") ?: root.stringOrNull("id") ?: file.nameWithoutExtension
        val title = fallbackTitle(root.stringOrNull("title") ?: root["metadata"]?.jsonObject?.stringOrNull("name"))
        val updatedAt = root.stringOrNull("updatedAt")?.toLongOrNull() ?: file.lastModified()

        return SessionMeta(
            sessionId = sessionId,
            adapterName = adapterInfo.name,
            modelId = adapterInfo.defaultModelId,
            modeId = adapterInfo.defaultModeId,
            projectPath = projectPath,
            title = title,
            filePath = file.absolutePath,
            customVariables = extractCustomVars(root, adapterInfo),
            createdAt = updatedAt,
            updatedAt = updatedAt
        )
    }
}
