package unified.llm.history

import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject

internal object GeminiCliHistory : AdapterHistory {
    override val adapterId: String = "gemini-cli"

    private const val SESSIONS_TEMPLATE = "~/.gemini/tmp/*/chats/*.json"

    override fun collectSessions(projectPath: String): List<SessionMeta> {
        val files = findMatchingHistoryFiles(resolveHistoryPathTemplate(SESSIONS_TEMPLATE, projectPath))
        return files.mapNotNull { file ->
            val root = runCatching { historyJson.parseToJsonElement(file.readText()).jsonObject }.getOrNull() ?: return@mapNotNull null
            val sessionId = root.stringOrNull("sessionId") ?: root.stringOrNull("id") ?: file.nameWithoutExtension
            val firstMessage = root["messages"]?.jsonArray?.firstOrNull()?.jsonObject
            val title = fallbackHistoryTitle(
                root.stringOrNull("title")
                    ?: firstMessage?.stringOrNull("content")
                    ?: firstMessage?.get("content")?.jsonArray?.firstOrNull()?.jsonObject?.stringOrNull("text")
            )
            val updatedAt = file.lastModified()
            val createdAt = parseHistoryTimestamp(root.stringOrNull("createdAt"))
                ?: parseHistoryTimestamp(root.stringOrNull("startTime"))
                ?: updatedAt

            SessionMeta(
                sessionId = sessionId,
                adapterName = adapterId,
                projectPath = projectPath,
                title = title,
                filePath = file.absolutePath,
                createdAt = createdAt,
                updatedAt = updatedAt
            )
        }
    }

    override fun deleteSession(projectPath: String, sessionId: String, sourceFilePath: String?): Boolean {
        val sourcePath = sourceFilePath?.takeIf { it.isNotBlank() } ?: return false
        return deleteHistoryFileIfExists(java.io.File(sourcePath))
    }
}
