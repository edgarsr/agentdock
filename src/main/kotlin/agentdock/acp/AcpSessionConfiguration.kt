package agentdock.acp

import kotlinx.serialization.json.JsonObject

internal fun AcpClientService.updateMetadataFromConfigOptionResponse(
    adapterName: String,
    response: JsonObject,
    context: AcpClientService.AgentContext
) {
    val configOptions = response["configOptions"] ?: return
    val adapterInfo = AcpAdapterPaths.getAdapterInfo(adapterName)
    val rawMetadata = runtimeMetadataFromConfigOptionsJson(configOptions, adapterInfo)
    val metadata = applyAdapterRuntimePreferences(
        adapterInfo = adapterInfo,
        currentModelId = rawMetadata.currentModelId,
        availableModels = rawMetadata.availableModels,
        modelConfigId = rawMetadata.modelConfigId,
        currentModeId = rawMetadata.currentModeId,
        availableModes = rawMetadata.availableModes,
        modeConfigId = rawMetadata.modeConfigId,
        currentReasoningEffortId = rawMetadata.currentReasoningEffortId,
        availableReasoningEfforts = rawMetadata.availableReasoningEfforts,
        reasoningEffortConfigId = rawMetadata.reasoningEffortConfigId
    )
    adapterRuntimeMetadataMap[adapterName] = metadata
    context.activeModelIdRef.set(metadata.currentModelId)
    context.activeModeIdRef.set(metadata.currentModeId)
    context.activeReasoningEffortIdRef.set(metadata.currentReasoningEffortId)
}
