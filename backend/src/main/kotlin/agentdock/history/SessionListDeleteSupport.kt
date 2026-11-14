package agentdock.history

import kotlinx.serialization.json.jsonObject
import agentdock.acp.AcpAdapterConfig
import agentdock.acp.AcpClientService
import agentdock.acp.deleteHistorySession
import agentdock.acp.canDeleteHistorySession
import com.intellij.openapi.project.ProjectManager
import java.io.File

internal object SessionListDeleteSupport {
    private const val ACP_METHOD = "acp"
    private const val GROK_CLI_METHOD = "grokCliSessionDelete"
    private const val COPILOT_SESSION_STATE_METHOD = "copilotSessionStateDelete"
    private const val CURSOR_SESSION_DIR_METHOD = "cursorSessionDirDelete"
    private const val KILO_CLI_METHOD = "kiloCliSessionDelete"

    private fun sessionDeleteMethod(adapterName: String): String? =
        runCatching { AcpAdapterConfig.getAdapterInfo(adapterName).sessionDeleteMethod }.getOrNull()

    fun canDeleteSession(adapterName: String): Boolean = when (sessionDeleteMethod(adapterName)) {
        ACP_METHOD -> isAcpSessionDeleteAvailable(adapterName)
        GROK_CLI_METHOD, COPILOT_SESSION_STATE_METHOD, CURSOR_SESSION_DIR_METHOD, KILO_CLI_METHOD -> true
        else -> false
    }

    fun resolveSourceFilePath(projectPath: String, adapterName: String, sessionId: String): String {
        return when (adapterName) {
            "claude-code" -> resolveClaudeSourceFilePath(projectPath, sessionId)
            "codex" -> resolveCodexSourceFilePath(projectPath, sessionId)
            "github-copilot-cli" -> resolveGithubCopilotSourceFilePath(projectPath, sessionId)
            "cursor-cli" -> resolveCursorSourceFilePath(projectPath, sessionId)
            else -> ""
        }
    }

    suspend fun deleteSession(projectPath: String, adapterName: String, sessionId: String, sourceFilePath: String?): Boolean =
        when (sessionDeleteMethod(adapterName)) {
            ACP_METHOD -> deleteAcpSession(adapterName, sessionId)
            GROK_CLI_METHOD -> GrokSessionHistory.grokCliSessionDelete(adapterName, projectPath, sessionId)
            // These sessions are only files, so they are deleted without the agent, and finding none means nothing is left to delete.
            COPILOT_SESSION_STATE_METHOD, CURSOR_SESSION_DIR_METHOD -> {
                val path = sourceFilePath?.takeIf { it.isNotBlank() }
                    ?: resolveSourceFilePath(projectPath, adapterName, sessionId)
                path.isBlank() || deleteFileSessionDirectory(File(path).parentFile)
            }
            KILO_CLI_METHOD -> runCatching {
                runAgentHistoryCliCommand(adapterName, projectPath, listOf("session", "delete", sessionId))
            }.isSuccess
            else -> false
        }

    /** Deletes [dir] only where Copilot and Cursor keep one session, so a wrong path never removes anything else. */
    private fun deleteFileSessionDirectory(dir: File?): Boolean {
        val sessionDir = dir?.let { runCatching { it.canonicalFile }.getOrNull() } ?: return false
        val parent = sessionDir.parentFile ?: return false
        val home = System.getProperty("user.home")
        val isSessionDir = parent == File(home, ".copilot/session-state").canonicalFile ||
            parent == File(home, ".cursor/acp-sessions").canonicalFile ||
            parent.parentFile == File(home, ".cursor/chats").canonicalFile
        return isSessionDir && deleteHistoryDirectoryIfExists(sessionDir)
    }

    private suspend fun deleteAcpSession(adapterName: String, sessionId: String): Boolean {
        val service = ProjectManager.getInstance().openProjects
            .asSequence()
            .map(AcpClientService::getInstance)
            .firstOrNull { it.isAdapterReady(adapterName) && it.canDeleteHistorySession(adapterName) }
            ?: return false
        return service.deleteHistorySession(adapterName, sessionId)
    }

    private fun isAcpSessionDeleteAvailable(adapterName: String): Boolean =
        ProjectManager.getInstance().openProjects
            .asSequence()
            .map(AcpClientService::getInstance)
            .any { service -> service.isAdapterReady(adapterName) && service.canDeleteHistorySession(adapterName) }

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

    private fun resolveCursorSourceFilePath(projectPath: String, sessionId: String): String {
        val files = findMatchingHistoryFiles(resolveHistoryPathTemplate("~/.cursor/chats/{projectHashMd5}/*/store.db", projectPath))
        val chatFile = files.firstOrNull { file ->
            val sessionDir = file.parentFile ?: return@firstOrNull false
            sessionDir.name == sessionId
        }
        if (chatFile != null) return chatFile.absolutePath

        val acpSessionDb = File(System.getProperty("user.home"), ".cursor/acp-sessions/$sessionId/store.db")
        return if (acpSessionDb.exists()) acpSessionDb.absolutePath else ""
    }
}
