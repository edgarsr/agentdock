package agentdock.acp

import agentdock.history.AgentDockHistoryService
import agentdock.history.GrokSessionHistory
import com.intellij.openapi.diagnostic.Logger
import com.agentclientprotocol.protocol.Protocol
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

private const val PROBE_SESSION_CLEANUP_TIMEOUT_MS = 3_000L
private val LOG = Logger.getInstance("agentdock.acp.AcpAdapterRuntimeMetadata")

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
                val cleaned = withTimeoutOrNull(PROBE_SESSION_CLEANUP_TIMEOUT_MS) {
                    cleanupProbeSession(adapterInfo, sessionId)
                } ?: false
                if (!cleaned) {
                    LOG.debug("Unable to clean up ACP config-options probe session '$sessionId'")
                }
            }
        } finally {
            configProbeSessionKeys.remove(probeSessionKey)
        }
    }
}

private suspend fun AcpClientService.cleanupProbeSession(
    adapterInfo: AcpAdapterConfig.AdapterInfo,
    sessionId: String
): Boolean {
    val probeProjectPath = AcpAdapterPaths.getProbeSessionDir().absolutePath
    return try {
        if (adapterInfo.sessionDeleteMethod == "grokCliSessionDelete") {
            GrokSessionHistory.grokCliSessionDelete(adapterInfo.id, probeProjectPath, sessionId)
        } else {
            AgentDockHistoryService.deleteSessionImmediately(
                projectPath = resolveSessionCwd(probeProjectPath),
                sessionId = sessionId,
                adapterName = adapterInfo.id,
                waitTimeoutMillis = 1_000L,
                pollIntervalMillis = 100L
            )
        }
    } catch (error: CancellationException) {
        throw error
    } catch (error: Exception) {
        LOG.debug("Failed to clean up ACP config-options probe session '$sessionId'", error)
        false
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
