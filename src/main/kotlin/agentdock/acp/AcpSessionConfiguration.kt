package agentdock.acp

import kotlinx.serialization.json.JsonObject

internal fun AcpClientService.updateMetadataFromConfigOptionResponse(
    adapterName: String,
    response: JsonObject,
    context: AcpClientService.AgentContext
): Unit {
    val adapterInfo = AcpAdapterPaths.getAdapterInfo(adapterName)
    updateSessionRuntimeMetadata(
        adapterInfo,
        runtimeMetadataFromSetConfigOptionResponseJson(response, adapterInfo),
        context
    )
}

internal fun AcpClientService.updateSessionRuntimeMetadata(
    adapterInfo: AcpAdapterConfig.AdapterInfo,
    freshMetadata: AcpClientService.AdapterRuntimeMetadata,
    context: AcpClientService.AgentContext
): AcpClientService.AdapterRuntimeMetadata {
    val metadata = AcpConfigOptionsCache.updateFromSnapshot(adapterInfo, freshMetadata)
        .toRuntimeMetadata(adapterInfo)
    context.runtimeMetadataRef.set(metadata)
    context.activeModelIdRef.set(metadata.currentModelId)
    context.activeModeIdRef.set(metadata.currentModeId)
    context.activeReasoningEffortIdRef.set(metadata.currentReasoningEffortId)
    context.activeConfigValues.clear()
    context.activeConfigValues.putAll(metadata.configOptions.associate { it.id to it.currentValue })
    runCatching { sessionConfigOptionsHandler?.invoke(context.chatId, metadata) }
    return metadata
}
