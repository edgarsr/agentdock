package unified.llm.history

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import java.io.File

internal object SessionListDeleteSupport {
    fun resolveSourceFilePath(projectPath: String, adapterName: String, sessionId: String): String {
        return when (adapterName) {
            "claude-code" -> resolveClaudeSourceFilePath(projectPath, sessionId)
            "codex" -> resolveCodexSourceFilePath(projectPath, sessionId)
            "github-copilot-cli" -> resolveGithubCopilotSourceFilePath(projectPath, sessionId)
            "cursor-cli" -> resolveCursorSourceFilePath(projectPath, sessionId)
            "qoder" -> QoderCliHistory.resolveSourceFilePath(projectPath, sessionId)
            else -> ""
        }
    }

    fun deleteSession(projectPath: String, adapterName: String, sessionId: String, sourceFilePath: String?): Boolean {
        return when (adapterName) {
            "claude-code" -> deleteClaudeSession(projectPath, sessionId, sourceFilePath)
            "codex" -> deleteCodexSession(sourceFilePath)
            "cursor-cli" -> deleteCursorSession(sourceFilePath)
            "gemini-cli" -> runAgentHistoryCliCommand("gemini-cli", projectPath, listOf("--delete-session", sessionId)) != null
            "github-copilot-cli" -> deleteGithubCopilotSession(sourceFilePath)
            "kilo" -> runAgentHistoryCliCommand("kilo", projectPath, listOf("session", "delete", sessionId)) != null
            "opencode" -> runAgentHistoryCliCommand("opencode", projectPath, listOf("session", "delete", sessionId)) != null
            "qoder" -> QoderCliHistory.deleteQoderSession(sourceFilePath)
            else -> false
        }
    }

    private fun resolveClaudeSourceFilePath(projectPath: String, sessionId: String): String {
        val files = findMatchingHistoryFiles(resolveHistoryPathTemplate("~/.claude/projects/{projectPathSlug}/*.jsonl", projectPath))
        return files.firstOrNull { file ->
            var matchedSessionId: String? = null
            runCatching {
                file.useLines { lines ->
                    for (line in lines) {
                        if (!line.trimStart().startsWith("{")) continue
                        val root = historyJson.parseToJsonElement(line).jsonObject
                        val type = root.stringOrNull("type")?.lowercase()
                        if (type != "user") continue
                        matchedSessionId = root.stringOrNull("sessionId") ?: file.nameWithoutExtension
                        break
                    }
                }
            }
            matchedSessionId == sessionId
        }?.absolutePath.orEmpty()
    }

    private fun deleteClaudeSession(projectPath: String, sessionId: String, sourceFilePath: String?): Boolean {
        val sourcePath = sourceFilePath?.takeIf { it.isNotBlank() } ?: return false
        val deletedFile = deleteHistoryFileIfExists(File(sourcePath))
        if (!deletedFile) return false

        val indexFile = File(resolveHistoryPathTemplate("~/.claude/projects/{projectPathSlug}/sessions-index.json", projectPath))
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

    private fun resolveCodexSourceFilePath(projectPath: String, sessionId: String): String {
        val expectedProjectPath = historyComparablePath(projectPath)
        val files = findMatchingHistoryFiles(resolveHistoryPathTemplate("~/.codex/sessions/*/*/*/*.jsonl", projectPath))
        return files.firstOrNull { file ->
            var matchedSessionId: String? = null
            var sessionProjectPath: String? = null
            runCatching {
                file.useLines { lines ->
                    for (line in lines.take(200)) {
                        if (!line.trimStart().startsWith("{")) continue
                        val element = historyJson.parseToJsonElement(line)
                        if (element.stringAtPath("type") != "session_meta") continue
                        matchedSessionId = element.stringAtPath("payload.id") ?: file.nameWithoutExtension
                        sessionProjectPath = historyComparablePath(element.stringAtPath("payload.cwd"))
                        break
                    }
                }
            }
            matchedSessionId == sessionId &&
                !sessionProjectPath.isNullOrBlank() &&
                (expectedProjectPath.isBlank() || sessionProjectPath == expectedProjectPath)
        }?.absolutePath.orEmpty()
    }

    private fun deleteCodexSession(sourceFilePath: String?): Boolean {
        val sourcePath = sourceFilePath?.takeIf { it.isNotBlank() } ?: return false
        return deleteHistoryFileIfExists(File(sourcePath))
    }

    private fun resolveGithubCopilotSourceFilePath(projectPath: String, sessionId: String): String {
        val expectedProjectPath = historyComparablePath(projectPath)
        val files = findMatchingHistoryFiles(resolveHistoryPathTemplate("~/.copilot/session-state/*/events.jsonl", projectPath))
        return files.firstOrNull { file ->
            val sessionDir = file.parentFile ?: return@firstOrNull false
            val workspaceFile = File(sessionDir, "workspace.yaml")
            val workspace = parseSimpleYamlMap(workspaceFile)
            var matchedSessionId = workspace["id"]?.trim().orEmpty().ifBlank { sessionDir.name }
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
                            matchedSessionId = data.stringOrNull("sessionId")?.trim().orEmpty().ifBlank { matchedSessionId }
                            val context = data["context"]?.jsonObject
                            eventCwd = historyComparablePath(context?.stringOrNull("cwd"))
                            gitRoot = historyComparablePath(context?.stringOrNull("gitRoot"))
                            break
                        }
                    }
                }
            }

            val matchesProject = expectedProjectPath.isBlank() || listOf(workspaceCwd, eventCwd, gitRoot)
                .filter { it.isNotBlank() }
                .any { it == expectedProjectPath }
            matchedSessionId == sessionId && matchesProject
        }?.absolutePath.orEmpty()
    }

    private fun deleteGithubCopilotSession(sourceFilePath: String?): Boolean {
        val sessionDir = sourceFilePath?.takeIf { it.isNotBlank() }?.let { File(it).parentFile } ?: return false
        return deleteHistoryDirectoryIfExists(sessionDir)
    }

    private fun resolveCursorSourceFilePath(projectPath: String, sessionId: String): String {
        val files = findMatchingHistoryFiles(resolveHistoryPathTemplate("~/.cursor/chats/{projectHashMd5}/*/store.db", projectPath))
        return files.firstOrNull { file ->
            val sessionDir = file.parentFile ?: return@firstOrNull false
            sessionDir.name == sessionId
        }?.absolutePath.orEmpty()
    }

    private fun deleteCursorSession(sourceFilePath: String?): Boolean {
        val sessionDir = sourceFilePath?.takeIf { it.isNotBlank() }?.let { File(it).parentFile } ?: return false
        return deleteHistoryDirectoryIfExists(sessionDir)
    }
}
