package unified.llm.history

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import unified.llm.acp.AcpAdapterConfig
import unified.llm.acp.AcpExecutionMode
import java.io.File
import java.time.Instant

interface HistoryParser {
    fun parseSessions(
        file: File,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        historyConfig: AcpAdapterConfig.HistoryConfig,
        projectPath: String
    ): List<SessionMeta>
}

object HistoryParserRegistry {
    private val parsers: Map<String, HistoryParser> = mapOf(
        "json_array" to JsonArrayParser(),
        "jsonl_stream" to JsonlStreamParser(),
        "json_object" to JsonObjectParser(),
        "jsonl_event_stream" to JsonlEventStreamParser(),
        "root_user_jsonl" to RootUserJsonlParser(),
        "session_index" to SessionIndexParser(),
        "session_dir_mtime" to SessionDirMtimeParser()
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

private fun fallbackTitle(raw: String?): String {
    val normalized = raw?.trim().orEmpty().ifBlank { "Untitled Session" }
    if (normalized.length <= 64) return normalized
    return normalized.take(64) + "..."
}

// Maximum lines to scan when parsing JSONL files to extract title and metadata
private const val MAX_LINES_TO_SCAN = 40
private val historyJson = Json { ignoreUnknownKeys = true }

private fun canonicalizePath(path: String?): String {
    val value = path?.trim().orEmpty()
    if (value.isEmpty()) return ""
    val mountMatch = Regex("^/mnt/([A-Za-z])/(.*)$").matchEntire(value.replace("\\", "/"))
    val comparable = if (mountMatch != null) {
        val drive = mountMatch.groupValues[1].uppercase()
        val rest = mountMatch.groupValues[2].replace("/", "\\")
        "$drive:\\$rest"
    } else {
        value
    }
    val normalized = comparable.replace("/", File.separator).replace("\\", File.separator)
    val canonical = runCatching { File(normalized).canonicalPath }.getOrDefault(normalized)
    return if (File.separatorChar == '\\') canonical.lowercase() else canonical
}

private fun readableSourcePath(path: String?): String {
    val value = path?.trim().orEmpty()
    if (value.isEmpty()) return ""
    return AcpExecutionMode.wslPathToWindowsUnc(value) ?: value
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
    override fun parseSessions(
        file: File,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        historyConfig: AcpAdapterConfig.HistoryConfig,
        projectPath: String
    ): List<SessionMeta> {
        val root = runCatching { historyJson.parseToJsonElement(file.readText()).jsonObject }.getOrNull() ?: return emptyList()
        val sessionId = root.stringOrNull("sessionId") ?: root.stringOrNull("id") ?: file.nameWithoutExtension
        val firstMessage = root["messages"]?.jsonArray?.firstOrNull()?.jsonObject
        val title = fallbackTitle(
            root.stringOrNull("title")
                ?: firstMessage?.stringOrNull("content")
                ?: firstMessage?.get("content")?.jsonArray?.firstOrNull()?.jsonObject?.stringOrNull("text")
        )
        val updatedAt = file.lastModified()
        val createdAt = parseTimestamp(root.stringOrNull("createdAt"))
            ?: parseTimestamp(root.stringOrNull("startTime"))
            ?: updatedAt

        return listOf(SessionMeta(
            sessionId = sessionId,
            adapterName = adapterInfo.id,
            modelId = null,
            modeId = null,
            projectPath = projectPath,
            title = title,
            filePath = file.absolutePath,
            createdAt = createdAt,
            updatedAt = updatedAt
        ))
    }
}

private class JsonlStreamParser : HistoryParser {
    override fun parseSessions(
        file: File,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        historyConfig: AcpAdapterConfig.HistoryConfig,
        projectPath: String
    ): List<SessionMeta> {
        var title: String? = null
        runCatching {
            file.useLines { lines ->
                for ((index, line) in lines.withIndex().take(MAX_LINES_TO_SCAN)) {
                    if (!line.trimStart().startsWith("{")) continue
                    val obj = historyJson.parseToJsonElement(line).jsonObject

                    val role = obj.stringOrNull("role")?.lowercase()
                    val text = obj.stringOrNull("content") ?: obj.stringOrNull("text")
                    if (role == "user" && !text.isNullOrBlank()) {
                        title = text
                        break
                    }
                }
            }
        }

        return listOf(SessionMeta(
            sessionId = file.nameWithoutExtension,
            adapterName = adapterInfo.id,
            modelId = null,
            modeId = null,
            projectPath = projectPath,
            title = fallbackTitle(title),
            filePath = file.absolutePath,
            createdAt = file.lastModified(),
            updatedAt = file.lastModified()
        ))
    }
}

private class JsonObjectParser : HistoryParser {
    override fun parseSessions(
        file: File,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        historyConfig: AcpAdapterConfig.HistoryConfig,
        projectPath: String
    ): List<SessionMeta> {
        val root = runCatching { historyJson.parseToJsonElement(file.readText()).jsonObject }.getOrNull() ?: return emptyList()
        val sessionId = root.stringOrNull("sessionId") ?: root.stringOrNull("id") ?: file.nameWithoutExtension
        val title = fallbackTitle(root.stringOrNull("title") ?: root["metadata"]?.jsonObject?.stringOrNull("name"))
        val updatedAt = file.lastModified()

        return listOf(SessionMeta(
            sessionId = sessionId,
            adapterName = adapterInfo.id,
            modelId = null,
            modeId = null,
            projectPath = projectPath,
            title = title,
            filePath = file.absolutePath,
            createdAt = updatedAt,
            updatedAt = updatedAt
        ))
    }
}

private class JsonlEventStreamParser : HistoryParser {
    override fun parseSessions(
        file: File,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        historyConfig: AcpAdapterConfig.HistoryConfig,
        projectPath: String
    ): List<SessionMeta> {
        val expectedProjectPath = canonicalizePath(projectPath)
        var sessionId: String? = null
        var createdAt: Long? = null
        var title: String? = null
        var sessionProjectPath: String? = null

        runCatching {
            file.useLines { lines ->
                for (line in lines.take(200)) {
                    if (!line.trimStart().startsWith("{")) continue
                    val element = historyJson.parseToJsonElement(line)
                    val type = element.stringAtPath("type")

                    if (type == "session_meta") {
                        sessionId = element.stringAtPath("payload.id") ?: sessionId
                        createdAt = parseTimestamp(element.stringAtPath("payload.timestamp"))
                            ?: createdAt
                        sessionProjectPath = canonicalizePath(element.stringAtPath("payload.cwd"))
                    }

                    if (title.isNullOrBlank()
                        && type == "event_msg"
                        && element.stringAtPath("payload.type") == "user_message"
                    ) {
                        title = element.stringAtPath("payload.message")
                    }
                }
            }
        }

        if (sessionProjectPath.isNullOrBlank()) return emptyList()
        if (expectedProjectPath.isNotBlank() && sessionProjectPath != expectedProjectPath) return emptyList()

        return listOf(SessionMeta(
            sessionId = sessionId ?: file.nameWithoutExtension,
            adapterName = adapterInfo.id,
            modelId = null,
            modeId = null,
            projectPath = projectPath,
            title = fallbackTitle(title),
            filePath = file.absolutePath,
            createdAt = createdAt ?: file.lastModified(),
            updatedAt = file.lastModified()
        ))
    }
}

private class RootUserJsonlParser : HistoryParser {
    override fun parseSessions(
        file: File,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        historyConfig: AcpAdapterConfig.HistoryConfig,
        projectPath: String
    ): List<SessionMeta> {
        val expectedProjectPath = canonicalizePath(projectPath)
        var sessionId: String? = null
        var createdAt: Long? = null
        var title: String? = null
        var projectMatched = false

        runCatching {
            file.useLines { lines ->
                for (line in lines) {
                    if (!line.trimStart().startsWith("{")) continue
                    val root = historyJson.parseToJsonElement(line).jsonObject
                    val type = root.stringOrNull("type")?.lowercase()
                    if (type != "user") continue
                    if ((root["isSidechain"] as? JsonPrimitive)?.content == "true") continue

                    if (!projectMatched) {
                        val cwd = canonicalizePath(root.stringOrNull("cwd"))
                        if (expectedProjectPath.isNotBlank() && cwd != expectedProjectPath) continue
                        sessionId = root.stringOrNull("sessionId") ?: file.nameWithoutExtension
                        createdAt = parseTimestamp(root.stringOrNull("timestamp"))
                        projectMatched = true
                    }

                    if ((root["isMeta"] as? JsonPrimitive)?.content == "true") continue
                    val message = root["message"]?.jsonObject ?: continue
                    if (message.stringOrNull("role")?.lowercase() != "user") continue
                    val contentArray = message["content"] as? JsonArray ?: continue
                    val text = contentArray
                        .firstOrNull { it is JsonObject && it.stringOrNull("type") == "text" }
                        ?.jsonObject?.stringOrNull("text")?.trim()
                    if (text.isNullOrBlank()) continue

                    title = text
                    break
                }
            }
        }

        if (!projectMatched) return emptyList()

        return listOf(
            SessionMeta(
                sessionId = sessionId ?: file.nameWithoutExtension,
                adapterName = adapterInfo.id,
                modelId = null,
                modeId = null,
                projectPath = projectPath,
                title = fallbackTitle(title),
                filePath = file.absolutePath,
                createdAt = createdAt ?: file.lastModified(),
                updatedAt = file.lastModified()
            )
        )
    }
}

private class SessionIndexParser : HistoryParser {
    override fun parseSessions(
        file: File,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        historyConfig: AcpAdapterConfig.HistoryConfig,
        projectPath: String
    ): List<SessionMeta> {
        val root = runCatching { historyJson.parseToJsonElement(file.readText()).jsonObject }.getOrNull() ?: return emptyList()
        val expectedProjectPath = canonicalizePath(projectPath)
        val entries = root["entries"]?.jsonArray.orEmpty()

        return entries.mapNotNull { element ->
            val entry = element as? JsonObject ?: return@mapNotNull null
            val sessionProjectPath = canonicalizePath(entry.stringOrNull("projectPath"))
            if (sessionProjectPath.isBlank()) return@mapNotNull null
            if (expectedProjectPath.isNotBlank() && sessionProjectPath != expectedProjectPath) return@mapNotNull null

            val sessionId = entry.stringOrNull("sessionId")?.trim().orEmpty()
            val fullPath = readableSourcePath(entry.stringOrNull("fullPath"))
            if (sessionId.isBlank() || fullPath.isBlank()) return@mapNotNull null
            val sourceFile = File(fullPath)
            if (!sourceFile.isFile) return@mapNotNull null

            val updatedAt = sourceFile.lastModified()
            val createdAt = parseTimestamp(entry.stringOrNull("created")) ?: updatedAt
            val title = fallbackTitle(entry.stringOrNull("firstPrompt"))

            SessionMeta(
                sessionId = sessionId,
                adapterName = adapterInfo.id,
                modelId = null,
                modeId = null,
                projectPath = projectPath,
                title = title,
                filePath = fullPath,
                createdAt = createdAt,
                updatedAt = updatedAt
            )
        }
    }
}

private class SessionDirMtimeParser : HistoryParser {
    override fun parseSessions(
        file: File,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        historyConfig: AcpAdapterConfig.HistoryConfig,
        projectPath: String
    ): List<SessionMeta> {
        val sessionDir = file.parentFile ?: return emptyList()
        val sessionId = sessionDir.name.takeIf { it.isNotBlank() } ?: return emptyList()

        val timestamps = mutableListOf(
            file.lastModified(),
            File(sessionDir, "store.db-shm").takeIf { it.isFile }?.lastModified() ?: 0L,
            File(sessionDir, "store.db-wal").takeIf { it.isFile }?.lastModified() ?: 0L,
            sessionDir.lastModified()
        )
        val updatedAt = timestamps.maxOrNull() ?: file.lastModified()

        return listOf(SessionMeta(
            sessionId = sessionId,
            adapterName = adapterInfo.id,
            modelId = null,
            modeId = null,
            projectPath = projectPath,
            title = "Untitled Session",
            filePath = file.absolutePath,
            createdAt = updatedAt,
            updatedAt = updatedAt
        ))
    }
}
