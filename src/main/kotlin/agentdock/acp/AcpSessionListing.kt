package agentdock.acp

import agentdock.history.GrokSessionHistory
import agentdock.history.SessionMeta
import agentdock.history.fallbackHistoryTitle
import agentdock.history.historyComparablePath
import agentdock.history.parseHistoryTimestamp
import com.agentclientprotocol.annotations.UnstableApi
import com.agentclientprotocol.rpc.MethodName
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@OptIn(UnstableApi::class)
internal suspend fun AcpClientService.listHistorySessions(
    adapterInfo: AcpAdapterConfig.AdapterInfo,
    projectPath: String
): List<SessionMeta> {
    ensureExecutionTargetCurrent()
    check(AcpAdapterPaths.isDownloaded(adapterInfo.id)) {
        "Adapter '${adapterInfo.id}' is not installed"
    }

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
    val sharedProc = activeProcesses[processKey(adapterInfo.id)]?.takeIf { it.isHealthy() }
        ?: throw IllegalStateException("Adapter '${adapterInfo.id}' is not ready for session/list")
    val client = sharedProc.client
        ?: throw IllegalStateException("Adapter '${adapterInfo.id}' does not have an initialized ACP client")
    val expectedProjectPath = historyComparablePath(projectPath)
    val sessionListCwd = resolveSessionCwd(projectPath).let { cwd ->
        if (adapterInfo.id == "github-copilot-cli") cwd.replace('\\', '/') else cwd
    }

    return client.listSessions(cwd = sessionListCwd).toList().mapNotNull { session ->
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
