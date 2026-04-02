package unified.llm.history

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject

internal object OpenCodeHistory : AdapterHistory {
    override val adapterId: String = "opencode"

    override fun collectSessions(projectPath: String): List<SessionMeta> {
        return runAgentHistoryCliCommand(
            adapterId = adapterId,
            projectPath = projectPath,
            args = listOf("session", "list", "--format", "json")
        )?.let { output ->
            if (output.isBlank()) return emptyList()
            val root = runCatching { historyJson.parseToJsonElement(output) }.getOrNull() as? JsonArray
                ?: return emptyList()
            val expectedProjectPath = historyComparablePath(projectPath)

            root.mapNotNull { element ->
                val obj = element as? JsonObject ?: return@mapNotNull null
                val sessionId = obj.stringAtPath("id")?.trim().orEmpty()
                if (sessionId.isBlank()) return@mapNotNull null

                val sessionProjectPath = historyComparablePath(obj.stringAtPath("directory"))
                if (expectedProjectPath.isNotBlank() && sessionProjectPath != expectedProjectPath) return@mapNotNull null

                val createdAt = parseHistoryTimestamp(obj.stringAtPath("created")) ?: 0L
                val updatedAt = parseHistoryTimestamp(obj.stringAtPath("updated")) ?: createdAt

                SessionMeta(
                    sessionId = sessionId,
                    adapterName = adapterId,
                    projectPath = projectPath,
                    title = fallbackHistoryTitle(obj.stringAtPath("title")),
                    filePath = "",
                    createdAt = if (createdAt > 0L) createdAt else updatedAt,
                    updatedAt = updatedAt
                )
            }
        } ?: emptyList()
    }

    override fun deleteSession(projectPath: String, sessionId: String, sourceFilePath: String?): Boolean {
        return runAgentHistoryCliCommand(
            adapterId = adapterId,
            projectPath = projectPath,
            args = listOf("session", "delete", sessionId)
        ) != null
    }
}
