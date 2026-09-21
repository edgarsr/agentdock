package agentdock.history

import kotlinx.serialization.json.jsonObject
import agentdock.acp.AcpAdapterConfig
import agentdock.acp.AcpClientService
import agentdock.acp.deleteHistorySession
import agentdock.acp.canDeleteHistorySession
import com.intellij.openapi.project.ProjectManager
import kotlinx.coroutines.runBlocking
import java.io.File
import java.util.UUID

internal object SessionListDeleteSupport {
    fun canDeleteSession(adapterName: String): Boolean {
        val method = runCatching { AcpAdapterConfig.getAdapterInfo(adapterName).sessionDeleteMethod }.getOrNull()
        return when (method) {
            "acp" -> isAcpSessionDeleteAvailable(adapterName)
            "antigravitySessionDelete", "grokCliSessionDelete" -> true
            null -> hasDefaultDeleteMethod(adapterName) || isAcpSessionDeleteAvailable(adapterName)
            else -> false
        }
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

    fun deleteSession(projectPath: String, adapterName: String, sessionId: String, sourceFilePath: String?): Boolean {
        when (runCatching { AcpAdapterConfig.getAdapterInfo(adapterName).sessionDeleteMethod }.getOrNull()) {
            "acp" -> return deleteAcpSession(adapterName, sessionId)
            "antigravitySessionDelete" -> return deleteAntigravitySession(sessionId)
            "grokCliSessionDelete" -> return GrokSessionHistory.grokCliSessionDelete(adapterName, projectPath, sessionId)
            null -> Unit
            else -> return false
        }

        return when (adapterName) {
            "cursor-cli" -> deleteCursorSession(sourceFilePath)
            "github-copilot-cli" -> deleteGithubCopilotSession(sourceFilePath)
            "kilo" -> runCatching {
                runAgentHistoryCliCommand("kilo", projectPath, listOf("session", "delete", sessionId))
            }.isSuccess
            else -> if (isAcpSessionDeleteAvailable(adapterName)) deleteAcpSession(adapterName, sessionId) else false
        }
    }

    private fun hasDefaultDeleteMethod(adapterName: String): Boolean = when (adapterName) {
        "cursor-cli", "github-copilot-cli", "kilo" -> true
        else -> false
    }

    private fun deleteAntigravitySession(sessionId: String): Boolean {
        val cleanSessionId = runCatching { UUID.fromString(sessionId.trim()).toString() }.getOrNull() ?: return false
        val dataDir = File(System.getProperty("user.home"), ".gemini/antigravity-acp")
        val conversationsDir = File(dataDir, "conversations")
        val sessionFiles = listOf(
            File(conversationsDir, "$cleanSessionId.db-wal"),
            File(conversationsDir, "$cleanSessionId.db-shm"),
            File(conversationsDir, "$cleanSessionId.db"),
            File(dataDir, "brain/$cleanSessionId"),
            File(conversationsDir, "$cleanSessionId.meta")
        )

        return sessionFiles.all { file ->
            if (file.isDirectory) deleteHistoryDirectoryIfExists(file) else deleteHistoryFileIfExists(file)
        }
    }

    private fun deleteAcpSession(adapterName: String, sessionId: String): Boolean {
        val service = ProjectManager.getInstance().openProjects
            .asSequence()
            .map(AcpClientService::getInstance)
            .firstOrNull { it.isAdapterReady(adapterName) && it.canDeleteHistorySession(adapterName) }
            ?: return false
        return runBlocking { service.deleteHistorySession(adapterName, sessionId) }
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

    private fun deleteGithubCopilotSession(sourceFilePath: String?): Boolean {
        val sessionDir = sourceFilePath?.takeIf { it.isNotBlank() }?.let { File(it).parentFile } ?: return false
        return deleteHistoryDirectoryIfExists(sessionDir)
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

    private fun deleteCursorSession(sourceFilePath: String?): Boolean {
        val sessionDir = sourceFilePath?.takeIf { it.isNotBlank() }?.let { File(it).parentFile } ?: return false
        return deleteHistoryDirectoryIfExists(sessionDir)
    }
}
