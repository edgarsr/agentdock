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
    context: AcpClientService.AgentContext,
    applyCurrentValues: Boolean = true
): AcpClientService.AdapterRuntimeMetadata {
    val cachedCatalog = AcpConfigOptionsCache.updateFromSnapshot(adapterInfo, freshMetadata)
        .toRuntimeMetadata(adapterInfo)
    val optionsByModel = cachedCatalog.configOptionsByModel.toMutableMap()
    freshMetadata.currentModelId?.let { modelId ->
        optionsByModel[modelId] = freshMetadata.configOptions
    }
    val metadata = freshMetadata.copy(configOptionsByModel = optionsByModel)
    context.runtimeMetadataRef.set(metadata)
    context.activeModelIdRef.set(metadata.currentModelId)
    context.activeModeIdRef.set(metadata.currentModeId)
    context.activeReasoningEffortIdRef.set(metadata.currentReasoningEffortId)
    context.activeConfigValues.clear()
    context.activeConfigValues.putAll(metadata.configOptions.associate { it.id to it.currentValue })
    if (!context.configOptionsUpdateInProgress) {
        publishSessionConfigOptions(context, applyCurrentValues)
    }
    return metadata
}

internal fun AcpClientService.publishSessionConfigOptions(
    context: AcpClientService.AgentContext,
    applyCurrentValues: Boolean = true
) {
    context.runtimeMetadataRef.get()?.let { metadata ->
        runCatching { sessionConfigOptionsHandler?.invoke(context.chatId, metadata, applyCurrentValues) }
    }
}
