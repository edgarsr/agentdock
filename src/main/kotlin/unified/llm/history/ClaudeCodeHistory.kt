package unified.llm.history

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import java.io.File

internal object ClaudeCodeHistory : AdapterHistory {
    override val adapterId: String = "claude-code"

    private const val SESSIONS_TEMPLATE = "~/.claude/projects/{projectPathSlug}/*.jsonl"
    private const val INDEX_TEMPLATE = "~/.claude/projects/{projectPathSlug}/sessions-index.json"

    override fun collectSessions(projectPath: String): List<SessionMeta> {
        val expectedProjectPath = historyComparablePath(projectPath)
        val files = findMatchingHistoryFiles(resolveHistoryPathTemplate(SESSIONS_TEMPLATE, projectPath))
        return files.mapNotNull { file ->
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
                            val cwd = historyComparablePath(root.stringOrNull("cwd"))
                            if (expectedProjectPath.isNotBlank() && cwd != expectedProjectPath) continue
                            sessionId = root.stringOrNull("sessionId") ?: file.nameWithoutExtension
                            createdAt = parseHistoryTimestamp(root.stringOrNull("timestamp"))
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

            if (!projectMatched) return@mapNotNull null
            SessionMeta(
                sessionId = sessionId ?: file.nameWithoutExtension,
                adapterName = adapterId,
                projectPath = projectPath,
                title = fallbackHistoryTitle(title),
                filePath = file.absolutePath,
                createdAt = createdAt ?: file.lastModified(),
                updatedAt = file.lastModified()
            )
        }
    }

    override fun deleteSession(projectPath: String, sessionId: String, sourceFilePath: String?): Boolean {
        val sourcePath = sourceFilePath?.takeIf { it.isNotBlank() } ?: return false
        val deletedFile = deleteHistoryFileIfExists(File(sourcePath))
        if (deletedFile) {
            removeSessionIndexEntry(projectPath, sessionId)
        }
        return deletedFile
    }

    private fun removeSessionIndexEntry(projectPath: String, sessionId: String): Boolean {
        val indexFile = File(resolveHistoryPathTemplate(INDEX_TEMPLATE, projectPath))
        if (!indexFile.exists()) return true

        return runCatching {
            val root = historyJson.parseToJsonElement(indexFile.readText()).jsonObject
            val entries = root["entries"] as? JsonArray ?: JsonArray(emptyList())
            val filtered = buildJsonArray {
                entries.forEach { entry ->
                    val entrySessionId = entry.jsonObject["sessionId"]?.toString()?.trim('"')
                    if (entrySessionId != sessionId) add(entry)
                }
            }
            val updatedRoot = buildJsonObject {
                root.forEach { (key, value) ->
                    if (key == "entries") put(key, filtered) else put(key, value)
                }
                if (!root.containsKey("entries")) put("entries", filtered)
            }
            indexFile.writeText(historyJson.encodeToString(JsonObject.serializer(), updatedRoot))
            true
        }.getOrDefault(true)
    }
}
