package agentdock.acp

import com.agentclientprotocol.annotations.UnstableApi
import com.agentclientprotocol.rpc.MethodName
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import agentdock.history.GrokSessionHistory
import agentdock.history.SessionMeta
import agentdock.history.fallbackHistoryTitle
import agentdock.history.historyComparablePath
import agentdock.history.parseHistoryTimestamp

@OptIn(UnstableApi::class)
internal suspend fun AcpClientService.listHistorySessions(
    adapterInfo: AcpAdapterConfig.AdapterInfo,
    projectPath: String
): List<SessionMeta> {
    ensureExecutionTargetCurrent()
    if (!AcpAdapterPaths.isDownloaded(adapterInfo.id)) return emptyList()

    return when (adapterInfo.sessionListMethod) {
        "acpSessionList" -> acpSessionList(adapterInfo, projectPath)
        "grokCliSessions" -> GrokSessionHistory.grokCliSessions(adapterInfo.id, projectPath)
        else -> throw IllegalStateException(
            "Unknown session list method '${adapterInfo.sessionListMethod}' for adapter '${adapterInfo.id}'"
        )
    }
}

@OptIn(UnstableApi::class)
private suspend fun AcpClientService.acpSessionList(
    adapterInfo: AcpAdapterConfig.AdapterInfo,
    projectPath: String
): List<SessionMeta> {
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

@OptIn(UnstableApi::class)
internal suspend fun AcpClientService.deleteHistorySession(adapterName: String, sessionId: String): Boolean {
    val sharedProc = activeProcesses[processKey(adapterName)]?.takeIf { it.isHealthy() } ?: return false
    val protocol = sharedProc.protocol ?: return false
    return runCatching {
        protocol.sendRequestRaw(
            MethodName("session/delete"),
            buildJsonObject { put("sessionId", sessionId) }
        )
        true
    }.getOrDefault(false)
}
