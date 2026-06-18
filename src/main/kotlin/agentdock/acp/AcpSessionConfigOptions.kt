package agentdock.acp

import com.agentclientprotocol.protocol.Protocol
import com.agentclientprotocol.rpc.MethodName
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

internal fun runtimeMetadataFromConfigOptionsJson(
    configOptions: JsonElement?,
    adapterInfo: AcpAdapterConfig.AdapterInfo
): AcpClientService.AdapterRuntimeMetadata {
    val options = configOptions as? JsonArray ?: return emptyRuntimeMetadata()
    val modelConfig = selectConfigOption(options, "model")
    val modeConfig = selectConfigOption(options, "mode")
    val reasoningConfig = selectConfigOption(options, "thought_level")
        ?: selectConfigOption(options, "reasoning_effort")

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
    val reasoningEfforts = (reasoningConfig?.options ?: emptyList())
        .map { effort ->
            AcpAdapterConfig.ModeInfo(
                id = effort.value,
                name = effort.name,
                description = effort.description
            )
        }

    return AcpClientService.AdapterRuntimeMetadata(
        currentModelId = modelConfig?.currentValue?.takeIf { current ->
            filteredModels.isEmpty() || filteredModels.any { it.modelId == current }
        },
        availableModels = filteredModels,
        modelConfigId = modelConfig?.configId,
        currentModeId = modeConfig?.currentValue?.takeIf { current ->
            filteredModes.isEmpty() || filteredModes.any { it.id == current }
        },
        availableModes = filteredModes,
        modeConfigId = modeConfig?.configId,
        currentReasoningEffortId = reasoningConfig?.currentValue?.takeIf { current ->
            reasoningEfforts.isEmpty() || reasoningEfforts.any { it.id == current }
        },
        availableReasoningEfforts = reasoningEfforts,
        reasoningEffortConfigId = reasoningConfig?.configId
    )
}

internal fun runtimeMetadataFromSessionResponseJson(
    response: JsonObject,
    adapterInfo: AcpAdapterConfig.AdapterInfo
): AcpClientService.AdapterRuntimeMetadata {
    val configMetadata = runtimeMetadataFromConfigOptionsJson(response["configOptions"], adapterInfo)
    if (
        configMetadata.availableModels.isNotEmpty() ||
        configMetadata.availableModes.isNotEmpty() ||
        configMetadata.availableReasoningEfforts.isNotEmpty() ||
        configMetadata.modelConfigId != null ||
        configMetadata.modeConfigId != null ||
        configMetadata.reasoningEffortConfigId != null
    ) {
        return configMetadata
    }

    val modelState = response["models"] as? JsonObject
    val modeState = response["modes"] as? JsonObject
    val models = ((modelState?.get("availableModels") as? JsonArray) ?: JsonArray(emptyList()))
        .mapNotNull { modelElement ->
            val model = modelElement as? JsonObject ?: return@mapNotNull null
            val modelId = model["modelId"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
            if (modelId.isEmpty()) return@mapNotNull null
            AcpAdapterConfig.ModelInfo(
                modelId = modelId,
                name = model["name"]?.jsonPrimitive?.contentOrNull?.trim()?.takeIf { it.isNotEmpty() } ?: modelId,
                description = model["description"]?.jsonPrimitive?.contentOrNull?.trim()?.takeIf { it.isNotEmpty() }
            )
        }
        .filterNot { model ->
            adapterInfo.disabledModels.any { disabled -> disabled.isNotBlank() && model.modelId.contains(disabled) }
        }
    val modes = ((modeState?.get("availableModes") as? JsonArray) ?: JsonArray(emptyList()))
        .mapNotNull { modeElement ->
            val mode = modeElement as? JsonObject ?: return@mapNotNull null
            val modeId = mode["id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
            if (modeId.isEmpty()) return@mapNotNull null
            AcpAdapterConfig.ModeInfo(
                id = modeId,
                name = mode["name"]?.jsonPrimitive?.contentOrNull?.trim()?.takeIf { it.isNotEmpty() } ?: modeId,
                description = mode["description"]?.jsonPrimitive?.contentOrNull?.trim()?.takeIf { it.isNotEmpty() }
            )
        }
        .filterNot { mode ->
            adapterInfo.disabledModes.any { disabled -> disabled == mode.id }
        }

    return AcpClientService.AdapterRuntimeMetadata(
        currentModelId = modelState?.get("currentModelId")?.jsonPrimitive?.contentOrNull?.trim()?.takeIf { current ->
            current.isNotEmpty() && (models.isEmpty() || models.any { it.modelId == current })
        },
        availableModels = models,
        modelConfigId = null,
        currentModeId = modeState?.get("currentModeId")?.jsonPrimitive?.contentOrNull?.trim()?.takeIf { current ->
            current.isNotEmpty() && (modes.isEmpty() || modes.any { it.id == current })
        },
        availableModes = modes,
        modeConfigId = null,
        currentReasoningEffortId = null,
        availableReasoningEfforts = emptyList(),
        reasoningEffortConfigId = null
    )
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

internal fun extractConfigOptionsUpdate(params: JsonElement?): Pair<String, JsonElement>? {
    val sessionId = extractSessionUpdateSessionId(params) ?: return null
    if (sessionId.isEmpty()) return null
    val paramsObject = params as? JsonObject ?: return null
    val updateObject = paramsObject["update"] as? JsonObject ?: return null
    val updateType = updateObject["sessionUpdate"]?.jsonPrimitive?.contentOrNull ?: return null
    if (updateType != "config_option_update") return null
    val configOptions = updateObject["configOptions"] ?: return null
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
            if (id != category && optionCategory != category) return@firstNotNullOfOrNull null
            val type = option["type"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
            if (type.isNotEmpty() && type != "select") return@firstNotNullOfOrNull null
            val choices = flattenSelectOptions(option["options"])
            if (choices.isEmpty()) return@firstNotNullOfOrNull null
            ConfigSelection(
                configId = id.ifEmpty { category },
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

private fun emptyRuntimeMetadata(): AcpClientService.AdapterRuntimeMetadata {
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
