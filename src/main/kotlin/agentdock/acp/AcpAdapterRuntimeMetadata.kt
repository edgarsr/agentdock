package agentdock.acp

import agentdock.history.AgentDockHistoryService
import agentdock.history.GrokSessionHistory
import com.agentclientprotocol.protocol.Protocol
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

private const val PROBE_SESSION_OPERATION_TIMEOUT_MS = 3_000L

@OptIn(com.agentclientprotocol.annotations.UnstableApi::class)
internal suspend fun AcpClientService.fetchAdapterRuntimeMetadata(
    protocol: Protocol,
    adapterInfo: AcpAdapterConfig.AdapterInfo
): AcpClientService.AdapterRuntimeMetadata {
    val probeProjectPath = AcpAdapterPaths.getProbeSessionDir().absolutePath
    val result = protocol.newSessionRaw(resolveSessionCwd(probeProjectPath))
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
            existingCache = AcpConfigOptionsCache.readValid(adapterInfo)
        )
        AcpConfigOptionsCache.write(cached)
        return cached.toRuntimeMetadata(adapterInfo)
    } finally {
        try {
            withContext(NonCancellable) {
                cleanupProbeSessions(adapterInfo, sessionId)
            }
        } finally {
            configProbeSessionKeys.remove(probeSessionKey)
        }
    }
}

private suspend fun AcpClientService.cleanupProbeSessions(
    adapterInfo: AcpAdapterConfig.AdapterInfo,
    currentSessionId: String
) {
    val probeProjectPath = AcpAdapterPaths.getProbeSessionDir().absolutePath
    val sessionIds = linkedSetOf<String>()
    try {
        withTimeoutOrNull(PROBE_SESSION_OPERATION_TIMEOUT_MS) {
            listHistorySessions(
                adapterInfo = adapterInfo,
                projectPath = probeProjectPath,
                allowInitializingProcess = true
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

    sessionIds.forEach { sessionId ->
        try {
            withTimeoutOrNull(PROBE_SESSION_OPERATION_TIMEOUT_MS) {
                if (adapterInfo.sessionDeleteMethod == "grokCliSessionDelete") {
                    GrokSessionHistory.grokCliSessionDelete(adapterInfo.id, probeProjectPath, sessionId)
                } else {
                    AgentDockHistoryService.deleteSessionImmediately(
                        projectPath = resolveSessionCwd(probeProjectPath),
                        sessionId = sessionId,
                        adapterName = adapterInfo.id,
                        waitTimeoutMillis = if (sessionId == currentSessionId) 1_000L else 0L,
                        pollIntervalMillis = 100L
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

internal fun AcpClientService.storeFreshAdapterRuntimeMetadata(
    adapterInfo: AcpAdapterConfig.AdapterInfo,
    metadata: AcpClientService.AdapterRuntimeMetadata
): AcpClientService.AdapterRuntimeMetadata {
    val updatedMetadata = AcpConfigOptionsCache.updateFromSnapshot(adapterInfo, metadata)
        .toRuntimeMetadata(adapterInfo)
    adapterRuntimeMetadataMap[adapterInfo.id] = updatedMetadata
    return updatedMetadata
}
