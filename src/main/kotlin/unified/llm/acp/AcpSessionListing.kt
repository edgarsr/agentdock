package unified.llm.acp

import com.agentclientprotocol.annotations.UnstableApi
import kotlinx.coroutines.flow.toList
import unified.llm.history.SessionMeta
import unified.llm.history.fallbackHistoryTitle
import unified.llm.history.historyComparablePath
import unified.llm.history.parseHistoryTimestamp

@OptIn(UnstableApi::class)
internal suspend fun AcpClientService.listHistorySessions(
    adapterInfo: AcpAdapterConfig.AdapterInfo,
    projectPath: String
): List<SessionMeta> {
    ensureExecutionTargetCurrent()
    if (!AcpAdapterPaths.isDownloaded(adapterInfo.id)) return emptyList()

    val sharedProc = activeProcesses[processKey(adapterInfo.id)]?.takeIf { it.isHealthy() } ?: return emptyList()
    val client = sharedProc.client ?: return emptyList()
    val expectedProjectPath = historyComparablePath(projectPath)
    val requestedCwd = if (adapterInfo.id == "codex" || adapterInfo.id == "github-copilot-cli") null else resolveSessionCwd(projectPath)

    return client.listSessions(cwd = requestedCwd).toList().mapNotNull { session ->
        val sessionProjectPath = historyComparablePath(session.cwd)
        if (expectedProjectPath.isNotBlank() && sessionProjectPath != expectedProjectPath) {
            return@mapNotNull null
        }

        val updatedAt = parseHistoryTimestamp(session.updatedAt) ?: 0L
        SessionMeta(
            sessionId = session.sessionId.value,
            adapterName = adapterInfo.id,
            projectPath = projectPath,
            title = fallbackHistoryTitle(session.title),
            filePath = "",
            createdAt = updatedAt,
            updatedAt = updatedAt
        )
    }
}
