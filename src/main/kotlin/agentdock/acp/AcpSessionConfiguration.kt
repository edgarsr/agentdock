package agentdock.acp

import kotlinx.serialization.json.JsonObject

internal fun AcpClientService.updateMetadataFromConfigOptionResponse(
    adapterName: String,
    response: JsonObject,
    context: AcpClientService.AgentContext
) {
    val adapterInfo = AcpAdapterPaths.getAdapterInfo(adapterName)
    val metadata = storeFreshAdapterRuntimeMetadata(
        adapterInfo,
        runtimeMetadataFromSetConfigOptionResponseJson(response, adapterInfo)
    )
    context.activeModelIdRef.set(metadata.currentModelId)
    context.activeModeIdRef.set(metadata.currentModeId)
    context.activeReasoningEffortIdRef.set(metadata.currentReasoningEffortId)
}
