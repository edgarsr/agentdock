package unified.llm.history

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import java.io.File

internal object QoderCliHistory : AdapterHistory {
    override val adapterId: String = "qoder"

    private const val SESSIONS_TEMPLATE = "~/.qoder/projects/{projectPathSlug}/*.jsonl"
    private const val DEFAULT_TITLE = "New Session"

    override fun collectSessions(projectPath: String): List<SessionMeta> {
        val expectedProjectPath = historyComparablePath(projectPath)
        return findMatchingHistoryFiles(resolveHistoryPathTemplate(SESSIONS_TEMPLATE, projectPath))
            .mapNotNull { file -> parseSessionFile(file, projectPath, expectedProjectPath) }
    }

    override fun deleteSession(projectPath: String, sessionId: String, sourceFilePath: String?): Boolean {
        return deleteQoderSession(sourceFilePath ?: resolveSourceFilePath(projectPath, sessionId))
    }

    fun resolveSourceFilePath(projectPath: String, sessionId: String): String {
        val expectedProjectPath = historyComparablePath(projectPath)
        return findMatchingHistoryFiles(resolveHistoryPathTemplate(SESSIONS_TEMPLATE, projectPath))
            .firstOrNull { file ->
                val parsed = parseSessionFile(file, projectPath, expectedProjectPath)
                parsed?.sessionId == sessionId
            }
            ?.absolutePath
            .orEmpty()
    }

    fun deleteQoderSession(sourceFilePath: String?): Boolean {
        val sourceFile = sourceFilePath
            ?.takeIf { it.isNotBlank() }
            ?.let(::File)
            ?: return false

        val sessionId = sourceFile.name.removeSuffix(".jsonl")
        val metaFile = File(sourceFile.parentFile, "$sessionId-session.json")
        return deleteHistoryFileIfExists(sourceFile) && deleteHistoryFileIfExists(metaFile)
    }

    private fun parseSessionFile(
        file: File,
        projectPath: String,
        expectedProjectPath: String
    ): SessionMeta? {
        val sessionId = file.name.removeSuffix(".jsonl").takeIf { it.isNotBlank() } ?: return null
        val meta = readMeta(file, sessionId)
        val jsonl = readJsonlSummary(file, sessionId)
        val sessionProjectPath = historyComparablePath(meta.workingDir ?: jsonl.cwd)
        if (expectedProjectPath.isNotBlank() && sessionProjectPath.isNotBlank() && sessionProjectPath != expectedProjectPath) {
            return null
        }

        val createdAt = listOfNotNull(meta.createdAt, jsonl.createdAt).minOrNull()
            ?: file.lastModified()
        val updatedAt = listOfNotNull(meta.updatedAt, jsonl.updatedAt, file.lastModified()).maxOrNull()
            ?: createdAt
        val title = meta.title
            ?.takeUnless { it.equals(DEFAULT_TITLE, ignoreCase = true) }
            ?: jsonl.firstUserText
            ?: meta.title

        return SessionMeta(
            sessionId = meta.id ?: jsonl.sessionId ?: sessionId,
            adapterName = adapterId,
            projectPath = projectPath,
            title = fallbackHistoryTitle(title),
            filePath = file.absolutePath,
            createdAt = createdAt,
            updatedAt = updatedAt
        )
    }

    private fun readMeta(file: File, sessionId: String): QoderMeta {
        val metaFile = File(file.parentFile, "$sessionId-session.json")
        if (!metaFile.isFile) return QoderMeta()
        return runCatching {
            val root = historyJson.parseToJsonElement(metaFile.readText()).jsonObject
            QoderMeta(
                id = root.stringOrNull("id"),
                title = root.stringOrNull("title"),
                workingDir = root.stringOrNull("working_dir"),
                createdAt = primitiveLong(root["created_at"]),
                updatedAt = primitiveLong(root["updated_at"])
            )
        }.getOrDefault(QoderMeta())
    }

    private fun readJsonlSummary(file: File, expectedSessionId: String): QoderJsonlSummary {
        var sessionId: String? = null
        var cwd: String? = null
        var firstUserText: String? = null
        var createdAt: Long? = null
        var updatedAt: Long? = null

        runCatching {
            file.useLines { lines ->
                for (line in lines.take(MAX_HISTORY_LINES_TO_SCAN)) {
                    if (!line.trimStart().startsWith("{")) continue
                    val root = historyJson.parseToJsonElement(line).jsonObject
                    val lineSessionId = root.stringOrNull("sessionId")
                    if (!lineSessionId.isNullOrBlank() && lineSessionId != expectedSessionId) continue

                    sessionId = sessionId ?: lineSessionId
                    cwd = cwd ?: root.stringOrNull("cwd")
                    val timestamp = parseHistoryTimestamp(root.stringOrNull("timestamp"))
                    if (timestamp != null) {
                        createdAt = minOf(createdAt ?: timestamp, timestamp)
                        updatedAt = maxOf(updatedAt ?: timestamp, timestamp)
                    }

                    if (firstUserText == null && root.stringOrNull("type") == "user" && root.booleanOrFalse("isMeta").not()) {
                        firstUserText = extractMessageText(root)?.takeIf { it.isNotBlank() }
                    }
                }
            }
        }

        return QoderJsonlSummary(
            sessionId = sessionId,
            cwd = cwd,
            firstUserText = firstUserText,
            createdAt = createdAt,
            updatedAt = updatedAt
        )
    }

    private fun extractMessageText(root: JsonObject): String? {
        val content = root["message"]?.jsonObject?.get("content") as? JsonArray ?: return null
        return content.firstNotNullOfOrNull { item ->
            val obj = item as? JsonObject ?: return@firstNotNullOfOrNull null
            if (obj.stringOrNull("type") != "text") return@firstNotNullOfOrNull null
            obj.stringOrNull("text")?.trim()?.takeIf { it.isNotBlank() }
        }
    }

    private fun primitiveLong(value: kotlinx.serialization.json.JsonElement?): Long? {
        return (value as? JsonPrimitive)?.contentOrNull?.toLongOrNull()
    }

    private fun JsonObject.booleanOrFalse(key: String): Boolean {
        return (this[key] as? JsonPrimitive)?.booleanOrNull ?: false
    }

    private data class QoderMeta(
        val id: String? = null,
        val title: String? = null,
        val workingDir: String? = null,
        val createdAt: Long? = null,
        val updatedAt: Long? = null
    )

    private data class QoderJsonlSummary(
        val sessionId: String?,
        val cwd: String?,
        val firstUserText: String?,
        val createdAt: Long?,
        val updatedAt: Long?
    )
}
