package unified.llm.history

internal object KiloHistory : AdapterHistory {
    override val adapterId: String = "kilo"

    override fun collectSessions(projectPath: String): List<SessionMeta> {
        return runAgentHistoryCliCommand(
            adapterId = adapterId,
            projectPath = projectPath,
            args = listOf("session", "list", "--format", "json")
        )?.let { output ->
            if (output.isBlank()) return emptyList()
            val root = runCatching { historyJson.parseToJsonElement(output) }.getOrNull() as? kotlinx.serialization.json.JsonArray
                ?: return emptyList()
            val expectedProjectPath = historyComparablePath(projectPath)

            root.mapNotNull { element ->
                val obj = element as? kotlinx.serialization.json.JsonObject ?: return@mapNotNull null
                val sessionId = obj.stringAtPath("id")?.trim().orEmpty()
                if (sessionId.isBlank()) return@mapNotNull null

                val sessionProjectPath = historyComparablePath(obj.stringAtPath("directory"))
                if (expectedProjectPath.isNotBlank() && sessionProjectPath != expectedProjectPath) return@mapNotNull null

                val fallbackTimestamp = java.time.Instant.now().toEpochMilli()
                val createdAt = parseHistoryTimestamp(obj.stringAtPath("created")) ?: fallbackTimestamp
                val updatedAt = parseHistoryTimestamp(obj.stringAtPath("updated")) ?: createdAt

                SessionMeta(
                    sessionId = sessionId,
                    adapterName = adapterId,
                    projectPath = projectPath,
                    title = fallbackHistoryTitle(obj.stringAtPath("title")),
                    filePath = "",
                    createdAt = createdAt,
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
