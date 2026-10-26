package agentdock.acp

import agentdock.history.GrokSessionHistory
import agentdock.history.SessionMeta
import agentdock.history.fallbackHistoryTitle
import agentdock.history.historyComparablePath
import agentdock.history.parseHistoryTimestamp
import com.agentclientprotocol.annotations.UnstableApi
import com.agentclientprotocol.protocol.Protocol
import com.agentclientprotocol.rpc.MethodName
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

internal suspend fun AcpClientService.listHistorySessions(
    adapterInfo: AcpAdapterConfig.AdapterInfo,
    projectPath: String,
    allowInitializingProcess: Boolean = false,
    preserveNativeCwd: Boolean = false
): List<SessionMeta> {
    check(AcpAdapterPaths.isDownloaded(adapterInfo.id)) {
        "Adapter '${adapterInfo.id}' is not installed"
    }
    check(canListHistorySessions(adapterInfo)) {
        "Adapter '${adapterInfo.id}' did not advertise session/list support"
    }

    return when (adapterInfo.sessionListMethod) {
        "acpSessionList" -> acpSessionList(
            adapterInfo,
            projectPath,
            allowInitializingProcess,
            preserveNativeCwd
        )
        "grokCliSessions" -> GrokSessionHistory.grokCliSessions(adapterInfo.id, projectPath)
        else -> throw IllegalStateException(
            "Unknown session list method '${adapterInfo.sessionListMethod}' for adapter '${adapterInfo.id}'"
        )
    }
}

internal fun AcpClientService.canListHistorySessions(adapterInfo: AcpAdapterConfig.AdapterInfo): Boolean =
    when (adapterInfo.sessionListMethod) {
        "acpSessionList" -> activeProcesses[adapterInfo.id]?.sessionListAvailable == true
        else -> true
    }

internal fun AcpClientService.canDeleteHistorySession(adapterName: String): Boolean =
    activeProcesses[adapterName]?.sessionDeleteAvailable == true

internal fun AcpClientService.canCloseHistorySession(adapterName: String): Boolean =
    activeProcesses[adapterName]?.sessionCloseAvailable == true

@OptIn(UnstableApi::class)
private suspend fun AcpClientService.acpSessionList(
    adapterInfo: AcpAdapterConfig.AdapterInfo,
    projectPath: String,
    allowInitializingProcess: Boolean,
    preserveNativeCwd: Boolean
): List<SessionMeta> {
    val sharedProc = activeProcesses[adapterInfo.id]?.takeIf {
        it.isHealthy() || (allowInitializingProcess && it.client != null)
    }
        ?: throw IllegalStateException("Adapter '${adapterInfo.id}' is not ready for session/list")
    val client = sharedProc.client
        ?: throw IllegalStateException("Adapter '${adapterInfo.id}' does not have an initialized ACP client")
    check(sharedProc.sessionListAvailable) {
        "Adapter '${adapterInfo.id}' did not advertise session/list support"
    }
    val expectedProjectPath = historyComparablePath(projectPath)
    val sessionListCwd = if (adapterInfo.sessionListPosixCwd && !preserveNativeCwd) {
        projectPath.replace('\\', '/')
    } else {
        projectPath
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

internal suspend fun AcpClientService.deleteHistorySession(adapterName: String, sessionId: String): Boolean {
    val sharedProc = activeProcesses[adapterName]?.takeIf { it.isHealthy() } ?: return false
    if (!sharedProc.sessionDeleteAvailable) return false
    val protocol = sharedProc.protocol ?: return false
    return protocol.deleteAcpSession(sessionId)
}

internal suspend fun Protocol.deleteAcpSession(sessionId: String): Boolean =
    sendSessionLifecycleRequest("session/delete", sessionId)

internal suspend fun Protocol.closeAcpSession(sessionId: String): Boolean =
    sendSessionLifecycleRequest("session/close", sessionId)

private suspend fun Protocol.sendSessionLifecycleRequest(method: String, sessionId: String): Boolean = try {
    sendRequestRaw(
        MethodName(method),
        buildJsonObject { put("sessionId", sessionId) }
    )
    true
} catch (error: CancellationException) {
    throw error
} catch (_: Exception) {
    false
}
