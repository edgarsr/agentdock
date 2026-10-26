package agentdock.acp

import agentdock.history.AgentDockHistoryService
import agentdock.history.GrokSessionHistory
import agentdock.history.SessionListDeleteSupport
import com.agentclientprotocol.protocol.Protocol
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds

private val PROBE_SESSION_OPERATION_TIMEOUT = 3.seconds

internal suspend fun AcpClientService.fetchAdapterRuntimeMetadata(
    protocol: Protocol,
    adapterInfo: AcpAdapterConfig.AdapterInfo,
    onConfigMutated: (() -> Unit)? = null
): AcpClientService.AdapterRuntimeMetadata {
    val probeProjectPath = AcpAdapterPaths.getProbeSessionDir().absolutePath
    val result = protocol.newSessionRaw(probeProjectPath)
    val sessionId = result["sessionId"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
    if (sessionId.isEmpty()) {
        throw IllegalStateException("ACP session/new response did not include sessionId")
    }
    val probeSessionKey = configProbeSessionKey(adapterInfo.id, sessionId)
    configProbeSessionKeys.add(probeSessionKey)

    try {
        val configMetadata = runtimeMetadataFromSessionResponseJson(result, adapterInfo)
        val cached = protocol.collectConfigOptionsCatalog(
            sessionId = sessionId,
            adapterInfo = adapterInfo,
            adapterVersion = AcpConfigOptionsCache.adapterVersion(adapterInfo),
            initialMetadata = configMetadata,
            existingCache = AcpConfigOptionsCache.readValid(adapterInfo),
            onConfigMutated = onConfigMutated
        )
        AcpConfigOptionsCache.write(cached)
        return cached.toRuntimeMetadata(adapterInfo)
    } finally {
        try {
            withContext(NonCancellable) {
                cleanupProbeSessions(protocol, adapterInfo, sessionId)
            }
        } finally {
            configProbeSessionKeys.remove(probeSessionKey)
        }
    }
}

private suspend fun AcpClientService.cleanupProbeSessions(
    protocol: Protocol,
    adapterInfo: AcpAdapterConfig.AdapterInfo,
    currentSessionId: String
) {
    val probeProjectPath = AcpAdapterPaths.getProbeSessionDir().absolutePath
    val sessionIds = linkedSetOf<String>()
    try {
        withTimeoutOrNull(PROBE_SESSION_OPERATION_TIMEOUT) {
            listHistorySessions(
                adapterInfo = adapterInfo,
                projectPath = probeProjectPath,
                allowInitializingProcess = true,
                preserveNativeCwd = true
            )
        }.orEmpty()
            .mapTo(sessionIds) { it.sessionId }
    } catch (error: CancellationException) {
        throw error
    } catch (_: Exception) {
        // The current session can still be deleted when session/list is unavailable.
    }
    sessionIds.remove(currentSessionId)
    sessionIds.add(currentSessionId)
    val sessionDeleteAvailable = canDeleteHistorySession(adapterInfo.id)
    val sessionCloseAvailable = canCloseHistorySession(adapterInfo.id)
    val useAcpCleanup = SessionListDeleteSupport.usesAcpProbeSessionCleanup(
        adapterName = adapterInfo.id,
        sessionDeleteAvailable = sessionDeleteAvailable,
        sessionCloseAvailable = sessionCloseAvailable
    )

    sessionIds.forEach { sessionId ->
        try {
            withTimeoutOrNull(PROBE_SESSION_OPERATION_TIMEOUT) {
                when {
                    adapterInfo.sessionDeleteMethod == "grokCliSessionDelete" ->
                        GrokSessionHistory.grokCliSessionDelete(adapterInfo.id, probeProjectPath, sessionId)
                    useAcpCleanup -> {
                        val deleted = sessionDeleteAvailable && protocol.deleteAcpSession(sessionId)
                        deleted || (sessionCloseAvailable && protocol.closeAcpSession(sessionId))
                    }
                    else -> AgentDockHistoryService.deleteSessionImmediately(
                        projectPath = probeProjectPath,
                        sessionId = sessionId,
                        adapterName = adapterInfo.id,
                        waitTimeout = if (sessionId == currentSessionId) 1.seconds else Duration.ZERO,
                        pollInterval = 100.milliseconds
                    )
                }
            }
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            // Continue so one failed deletion does not prevent the remaining probes from being removed.
        }
    }
}
