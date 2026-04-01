package unified.llm.history

import java.io.File

internal object CodexHistory : AdapterHistory {
    override val adapterId: String = "codex"

    private const val SESSIONS_TEMPLATE = "~/.codex/sessions/*/*/*/*.jsonl"

    override fun collectSessions(projectPath: String): List<SessionMeta> {
        val expectedProjectPath = historyComparablePath(projectPath)
        val files = findMatchingHistoryFiles(resolveHistoryPathTemplate(SESSIONS_TEMPLATE, projectPath))
        return files.mapNotNull { file ->
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
                            createdAt = parseHistoryTimestamp(element.stringAtPath("payload.timestamp")) ?: createdAt
                            sessionProjectPath = historyComparablePath(element.stringAtPath("payload.cwd"))
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

            if (sessionProjectPath.isNullOrBlank()) return@mapNotNull null
            if (expectedProjectPath.isNotBlank() && sessionProjectPath != expectedProjectPath) return@mapNotNull null

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
        return deleteHistoryFileIfExists(File(sourcePath))
    }
}
