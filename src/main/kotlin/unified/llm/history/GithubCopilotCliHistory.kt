package unified.llm.history

import kotlinx.serialization.json.jsonObject
import java.io.File

internal object GithubCopilotCliHistory : AdapterHistory {
    override val adapterId: String = "github-copilot-cli"

    private const val SESSIONS_TEMPLATE = "~/.copilot/session-state/*/events.jsonl"

    override fun collectSessions(projectPath: String): List<SessionMeta> {
        val expectedProjectPath = historyComparablePath(projectPath)
        val files = findMatchingHistoryFiles(resolveHistoryPathTemplate(SESSIONS_TEMPLATE, projectPath))
        return files.mapNotNull { file ->
            val sessionDir = file.parentFile ?: return@mapNotNull null
            val workspaceFile = File(sessionDir, "workspace.yaml")
            val workspace = parseSimpleYamlMap(workspaceFile)

            var sessionId = workspace["id"]?.trim().orEmpty().ifBlank { sessionDir.name }
            var createdAt = parseHistoryTimestamp(workspace["created_at"])
            var updatedAt = parseHistoryTimestamp(workspace["updated_at"])
            var title = workspace["summary"]?.takeIf { it.isNotBlank() }
            val workspaceCwd = historyComparablePath(workspace["cwd"])
            var eventCwd = ""
            var gitRoot = ""

            runCatching {
                file.useLines { lines ->
                    for (line in lines.take(200)) {
                        if (!line.trimStart().startsWith("{")) continue
                        val root = historyJson.parseToJsonElement(line).jsonObject
                        val type = root.stringOrNull("type")?.lowercase()
                        val data = root["data"]?.jsonObject

                        if (type == "session.start" && data != null) {
                            sessionId = data.stringOrNull("sessionId")?.trim().orEmpty().ifBlank { sessionId }
                            createdAt = parseHistoryTimestamp(data.stringOrNull("startTime")) ?: createdAt
                            val context = data["context"]?.jsonObject
                            eventCwd = historyComparablePath(context?.stringOrNull("cwd"))
                            gitRoot = historyComparablePath(context?.stringOrNull("gitRoot"))
                        }

                        if (title.isNullOrBlank() && type == "user.message" && data != null) {
                            title = data.stringOrNull("content")?.trim()
                        }
                    }
                }
            }

            val matchesProject = expectedProjectPath.isBlank() || listOf(workspaceCwd, eventCwd, gitRoot)
                .filter { it.isNotBlank() }
                .any { it == expectedProjectPath }
            if (!matchesProject) return@mapNotNull null

            val resolvedUpdatedAt = listOf(
                updatedAt ?: 0L,
                file.lastModified(),
                workspaceFile.lastModified(),
                sessionDir.lastModified()
            ).maxOrNull() ?: file.lastModified()
            val resolvedCreatedAt = createdAt ?: resolvedUpdatedAt

            SessionMeta(
                sessionId = sessionId,
                adapterName = adapterId,
                projectPath = projectPath,
                title = fallbackHistoryTitle(title),
                filePath = file.absolutePath,
                createdAt = resolvedCreatedAt,
                updatedAt = resolvedUpdatedAt
            )
        }
    }

    override fun deleteSession(projectPath: String, sessionId: String, sourceFilePath: String?): Boolean {
        val sessionDir = sourceFilePath?.takeIf { it.isNotBlank() }?.let { File(it).parentFile } ?: return false
        return deleteHistoryDirectoryIfExists(sessionDir)
    }
}
