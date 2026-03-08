package unified.llm.history

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import unified.llm.acp.AcpAdapterConfig
import java.io.File
import java.time.Instant

interface HistoryParser {
    fun parseMeta(
        file: File,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        historyConfig: AcpAdapterConfig.HistoryConfig,
        projectPath: String
    ): SessionMeta?
}

object HistoryParserRegistry {
    private val parsers: Map<String, HistoryParser> = mapOf(
        "json_array" to JsonArrayParser(),
        "jsonl_stream" to JsonlStreamParser(),
        "json_object" to JsonObjectParser(),
        "jsonl_event_stream" to JsonlEventStreamParser()
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

private fun canonicalizePath(path: String?): String {
    val value = path?.trim().orEmpty()
    if (value.isEmpty()) return ""
    val normalized = value.replace("/", File.separator).replace("\\", File.separator)
    val canonical = runCatching { File(normalized).canonicalPath }.getOrDefault(normalized)
    return if (File.separatorChar == '\\') canonical.lowercase() else canonical
}

private fun JsonElement.stringAtPath(path: String?): String? {
    if (path.isNullOrBlank()) return null
    var current: JsonElement = this
    for (segment in path.split('.')) {
        current = (current as? JsonObject)?.get(segment) ?: return null
    }
    return (current as? JsonPrimitive)?.content
}

private class JsonArrayParser : HistoryParser {
    private val json = Json { ignoreUnknownKeys = true }

    override fun parseMeta(
        file: File,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        historyConfig: AcpAdapterConfig.HistoryConfig,
        projectPath: String
    ): SessionMeta? {
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
            adapterName = adapterInfo.id,
            modelId = adapterInfo.defaultModelId,
            modeId = adapterInfo.defaultModeId,
            projectPath = projectPath,
            title = title,
            filePath = file.absolutePath,
            createdAt = createdAt,
            updatedAt = updatedAt
        )
    }
}

private class JsonlStreamParser : HistoryParser {
    private val json = Json { ignoreUnknownKeys = true }

    override fun parseMeta(
        file: File,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        historyConfig: AcpAdapterConfig.HistoryConfig,
        projectPath: String
    ): SessionMeta? {
        var title: String? = null
        runCatching {
            file.useLines { lines ->
                for ((index, line) in lines.withIndex().take(MAX_LINES_TO_SCAN)) {
                    if (!line.trimStart().startsWith("{")) continue
                    val obj = json.parseToJsonElement(line).jsonObject

                    val role = obj.stringOrNull("role")?.lowercase()
                    val text = obj.stringOrNull("content") ?: obj.stringOrNull("text")
                    if (role == "user" && !text.isNullOrBlank()) {
                        title = text
                        break
                    }
                }
            }
        }

        return SessionMeta(
            sessionId = file.nameWithoutExtension,
            adapterName = adapterInfo.id,
            modelId = adapterInfo.defaultModelId,
            modeId = adapterInfo.defaultModeId,
            projectPath = projectPath,
            title = fallbackTitle(title),
            filePath = file.absolutePath,
            createdAt = file.lastModified(),
            updatedAt = file.lastModified()
        )
    }
}

private class JsonObjectParser : HistoryParser {
    private val json = Json { ignoreUnknownKeys = true }

    override fun parseMeta(
        file: File,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        historyConfig: AcpAdapterConfig.HistoryConfig,
        projectPath: String
    ): SessionMeta? {
        val root = runCatching { json.parseToJsonElement(file.readText()).jsonObject }.getOrNull() ?: return null
        val sessionId = root.stringOrNull("sessionId") ?: root.stringOrNull("id") ?: file.nameWithoutExtension
        val title = fallbackTitle(root.stringOrNull("title") ?: root["metadata"]?.jsonObject?.stringOrNull("name"))
        val updatedAt = root.stringOrNull("updatedAt")?.toLongOrNull() ?: file.lastModified()

        return SessionMeta(
            sessionId = sessionId,
            adapterName = adapterInfo.id,
            modelId = adapterInfo.defaultModelId,
            modeId = adapterInfo.defaultModeId,
            projectPath = projectPath,
            title = title,
            filePath = file.absolutePath,
            createdAt = updatedAt,
            updatedAt = updatedAt
        )
    }
}

private class JsonlEventStreamParser : HistoryParser {
    private val json = Json { ignoreUnknownKeys = true }

    override fun parseMeta(
        file: File,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        historyConfig: AcpAdapterConfig.HistoryConfig,
        projectPath: String
    ): SessionMeta? {
        val expectedProjectPath = canonicalizePath(projectPath)
        var sessionId: String? = null
        var createdAt: Long? = null
        var updatedAt: Long? = null
        var title: String? = null
        var sessionProjectPath: String? = null

        runCatching {
            file.useLines { lines ->
                for (line in lines.take(200)) {
                    if (!line.trimStart().startsWith("{")) continue
                    val element = json.parseToJsonElement(line)
                    val type = element.stringAtPath("type")

                    if (type == "session_meta") {
                        sessionId = element.stringAtPath("payload.id") ?: sessionId
                        createdAt = parseTimestamp(element.stringAtPath("payload.timestamp"))
                            ?: createdAt
                        sessionProjectPath = canonicalizePath(element.stringAtPath("payload.cwd"))
                    }

                    updatedAt = parseTimestamp(element.stringAtPath("timestamp")) ?: updatedAt

                    if (title.isNullOrBlank()
                        && type == "event_msg"
                        && element.stringAtPath("payload.type") == "user_message"
                    ) {
                        title = element.stringAtPath("payload.message")
                    }
                }
            }
        }

        if (sessionProjectPath.isNullOrBlank()) return null
        if (expectedProjectPath.isNotBlank() && sessionProjectPath != expectedProjectPath) return null

        return SessionMeta(
            sessionId = sessionId ?: file.nameWithoutExtension,
            adapterName = adapterInfo.id,
            modelId = adapterInfo.defaultModelId,
            modeId = adapterInfo.defaultModeId,
            projectPath = projectPath,
            title = fallbackTitle(title),
            filePath = file.absolutePath,
            createdAt = createdAt ?: file.lastModified(),
            updatedAt = updatedAt ?: file.lastModified()
        )
    }
}
