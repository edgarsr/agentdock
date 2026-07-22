package agentdock.acp

import com.agentclientprotocol.protocol.Protocol
import com.agentclientprotocol.rpc.MethodName
import java.time.Instant
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

private data class ConfigSelection(
    val configId: String,
    val currentValue: String?,
    val options: List<ConfigSelectOption>
)

private data class ConfigSelectOption(
    val value: String,
    val name: String,
    val description: String?
)

internal fun configProbeSessionKey(adapterName: String, sessionId: String): String {
    return "$adapterName\u0000$sessionId"
}

internal fun runtimeMetadataFromConfigOptionsJson(
    configOptions: JsonElement?,
    adapterInfo: AcpAdapterConfig.AdapterInfo
): AcpClientService.AdapterRuntimeMetadata {
    val options = configOptions as? JsonArray ?: return emptyRuntimeMetadata()
    val modelConfig = selectConfigOption(options, "model")
    val modeConfig = selectConfigOption(options, "mode")
    val reasoningConfig = selectConfigOption(options, "thought_level")
        ?: selectConfigOption(options, "reasoning_effort")

    val configCurrentModelId = modelConfig?.currentValue?.trim()?.takeIf { it.isNotEmpty() }
    val filteredModels = (modelConfig?.options ?: emptyList())
        .filterNot { model ->
            adapterInfo.disabledModels.any { disabled ->
                disabled.isNotBlank() && model.value.contains(disabled)
            }
        }
        .map { model ->
            AcpAdapterConfig.ModelInfo(
                modelId = model.value,
                name = model.name,
                description = model.description
            )
        }
    val filteredModes = (modeConfig?.options ?: emptyList())
        .filterNot { mode ->
            adapterInfo.disabledModes.any { disabled -> disabled == mode.value }
        }
        .map { mode ->
            AcpAdapterConfig.ModeInfo(
                id = mode.value,
                name = mode.name,
                description = mode.description
            )
        }
    val configReasoningEfforts = (reasoningConfig?.options ?: emptyList())
        .map { effort ->
            AcpAdapterConfig.ModeInfo(
                id = effort.value,
                name = effort.name,
                description = effort.description
            )
        }
    val reasoningEffortConfigId = reasoningConfig?.configId

    return AcpClientService.AdapterRuntimeMetadata(
        currentModelId = configCurrentModelId?.takeIf { current ->
            filteredModels.any { it.modelId == current }
        },
        availableModels = filteredModels,
        modelConfigId = modelConfig?.configId,
        currentModeId = modeConfig?.currentValue?.takeIf { current ->
            filteredModes.any { it.id == current }
        },
        availableModes = filteredModes,
        modeConfigId = modeConfig?.configId,
        currentReasoningEffortId = reasoningConfig?.currentValue?.takeIf { current ->
            configReasoningEfforts.any { it.id == current }
        },
        availableReasoningEfforts = configReasoningEfforts,
        reasoningEffortConfigId = reasoningEffortConfigId
    )
}

internal fun runtimeMetadataFromSessionResponseJson(
    response: JsonObject,
    adapterInfo: AcpAdapterConfig.AdapterInfo
): AcpClientService.AdapterRuntimeMetadata {
    return runtimeMetadataFromConfigOptionsJson(response["configOptions"], adapterInfo)
}

internal fun runtimeMetadataFromSetConfigOptionResponseJson(
    response: JsonObject,
    adapterInfo: AcpAdapterConfig.AdapterInfo
): AcpClientService.AdapterRuntimeMetadata {
    val configOptions = response["configOptions"] as? JsonArray
        ?: throw IllegalStateException("ACP session/set_config_option response did not include configOptions")
    return runtimeMetadataFromConfigOptionsJson(configOptions, adapterInfo)
}

internal suspend fun Protocol.newSessionRaw(cwd: String): JsonObject {
    return sendRequestRaw(
        MethodName("session/new"),
        buildJsonObject {
            put("cwd", cwd)
            put("mcpServers", JsonArray(emptyList()))
        }
    ).jsonObject
}

internal suspend fun Protocol.setSessionConfigOptionRaw(
    sessionId: String,
    configId: String,
    value: String
): JsonObject {
    return sendRequestRaw(
        MethodName("session/set_config_option"),
        buildJsonObject {
            put("sessionId", sessionId)
            put("configId", configId)
            put("value", JsonPrimitive(value))
        }
    ).jsonObject
}

internal suspend fun Protocol.collectConfigOptionsCatalog(
    sessionId: String,
    adapterInfo: AcpAdapterConfig.AdapterInfo,
    adapterVersion: String,
    initialMetadata: AcpClientService.AdapterRuntimeMetadata,
    existingCache: CachedAdapterConfigOptions? = null
): CachedAdapterConfigOptions {
    val cachedModels = existingCache?.models.orEmpty().associateBy { it.modelId }
    val collectedModels = mutableListOf<CachedModelConfigOptions>()
    var modeConfigId = initialMetadata.modeConfigId ?: existingCache?.modeConfigId
    var reasoningEffortConfigId = initialMetadata.reasoningEffortConfigId ?: existingCache?.reasoningEffortConfigId
    val currentModelId = initialMetadata.currentModelId
    val currentModeId = initialMetadata.currentModeId
    val currentReasoningEffortId = initialMetadata.currentReasoningEffortId

    val models = initialMetadata.availableModels
    val modelConfigId = initialMetadata.modelConfigId ?: existingCache?.modelConfigId
    if (models.isNotEmpty()) {
        models.forEach { model ->
            val cachedModel = cachedModels[model.modelId]
            val isCurrentModel = model.modelId == initialMetadata.currentModelId
            var loadedFreshMetadata = false

            val metadata = if (isCurrentModel) {
                initialMetadata
            } else if (cachedModel?.configOptionsLoaded == true) {
                emptyRuntimeMetadata()
            } else if (!modelConfigId.isNullOrBlank()) {
                loadedFreshMetadata = true
                val response = setSessionConfigOptionRaw(sessionId, modelConfigId, model.modelId)
                runtimeMetadataFromSetConfigOptionResponseJson(response, adapterInfo)
            } else {
                emptyRuntimeMetadata()
            }

            collectedModels += CachedModelConfigOptions(
                modelId = model.modelId,
                name = model.name,
                description = model.description,
                modes = if (isCurrentModel || loadedFreshMetadata) metadata.availableModes else cachedModel?.modes.orEmpty(),
                efforts = if (isCurrentModel || loadedFreshMetadata) {
                    metadata.availableReasoningEfforts
                } else {
                    cachedModel?.efforts.orEmpty()
                },
                configOptionsLoaded = isCurrentModel || loadedFreshMetadata || cachedModel?.configOptionsLoaded == true
            )
            modeConfigId = modeConfigId ?: metadata.modeConfigId
            reasoningEffortConfigId = reasoningEffortConfigId ?: metadata.reasoningEffortConfigId
        }
    }

    return CachedAdapterConfigOptions(
        adapterId = adapterInfo.id,
        adapterVersion = adapterVersion,
        refreshedAtMillis = existingCache?.refreshedAtMillis ?: Instant.now().toEpochMilli(),
        currentModelId = currentModelId,
        currentModeId = currentModeId,
        currentReasoningEffortId = currentReasoningEffortId,
        modelConfigId = modelConfigId,
        modeConfigId = modeConfigId,
        reasoningEffortConfigId = reasoningEffortConfigId,
        modes = initialMetadata.availableModes,
        efforts = initialMetadata.availableReasoningEfforts,
        models = collectedModels
    )
}

internal fun extractConfigOptionsUpdate(params: JsonElement?): Pair<String, JsonElement>? {
    val sessionId = extractSessionUpdateSessionId(params) ?: return null
    if (sessionId.isEmpty()) return null
    val paramsObject = params as? JsonObject ?: return null
    val updateObject = paramsObject["update"] as? JsonObject ?: return null
    val updateType = updateObject["sessionUpdate"]?.jsonPrimitive?.contentOrNull ?: return null
    if (updateType != "config_option_update") return null
    val configOptions = updateObject["configOptions"] as? JsonArray ?: return null
    return sessionId to configOptions
}

internal fun extractSessionUpdateSessionId(params: JsonElement?): String? {
    val paramsObject = params as? JsonObject ?: return null
    return paramsObject["sessionId"]?.jsonPrimitive?.contentOrNull?.trim()?.takeIf { it.isNotEmpty() }
}

private fun selectConfigOption(options: JsonArray, category: String): ConfigSelection? {
    return options.asSequence()
        .mapNotNull { it as? JsonObject }
        .firstNotNullOfOrNull { option ->
            val id = option["id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
            val optionCategory = option["category"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
            if (id.isEmpty()) return@firstNotNullOfOrNull null
            if (id != category && optionCategory != category) return@firstNotNullOfOrNull null
            val type = option["type"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
            if (type != "select") return@firstNotNullOfOrNull null
            val choices = flattenSelectOptions(option["options"])
            if (choices.isEmpty()) return@firstNotNullOfOrNull null
            ConfigSelection(
                configId = id,
                currentValue = option["currentValue"]?.jsonPrimitive?.contentOrNull?.trim()?.takeIf { it.isNotEmpty() },
                options = choices
            )
        }
}

private fun flattenSelectOptions(options: JsonElement?): List<ConfigSelectOption> {
    val array = options as? JsonArray ?: return emptyList()
    return array.flatMap { element ->
        val obj = element as? JsonObject ?: return@flatMap emptyList()
        val nestedOptions = obj["options"] as? JsonArray
        if (nestedOptions != null) {
            flattenSelectOptions(nestedOptions)
        } else {
            val value = obj["value"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
            if (value.isEmpty()) {
                emptyList()
            } else {
                listOf(
                    ConfigSelectOption(
                        value = value,
                        name = obj["name"]?.jsonPrimitive?.contentOrNull?.trim()?.takeIf { it.isNotEmpty() } ?: value,
                        description = obj["description"]?.jsonPrimitive?.contentOrNull?.trim()?.takeIf { it.isNotEmpty() }
                    )
                )
            }
        }
    }
}

internal fun emptyRuntimeMetadata(): AcpClientService.AdapterRuntimeMetadata {
    return AcpClientService.AdapterRuntimeMetadata(
        currentModelId = null,
        availableModels = emptyList(),
        modelConfigId = null,
        currentModeId = null,
        availableModes = emptyList(),
        modeConfigId = null,
        currentReasoningEffortId = null,
        availableReasoningEfforts = emptyList(),
        reasoningEffortConfigId = null
    )
}
