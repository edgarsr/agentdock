package agentdock.acp

import com.agentclientprotocol.protocol.Protocol
import com.agentclientprotocol.rpc.MethodName
import java.time.Instant
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

@kotlinx.serialization.Serializable
internal data class AcpConfigOption(
    val id: String,
    val name: String,
    val description: String? = null,
    val category: String? = null,
    val type: String,
    val currentValue: String = "",
    val options: List<AcpConfigOptionValue> = emptyList()
) {
    fun matchesCategory(value: String): Boolean = id == value || category == value

    fun accepts(value: String): Boolean = when (type) {
        "select" -> options.any { it.value == value }
        "boolean" -> value == "true" || value == "false"
        else -> false
    }
}

@kotlinx.serialization.Serializable
internal data class AcpConfigOptionValue(
    val value: String,
    val name: String,
    val description: String? = null
)

internal fun configProbeSessionKey(adapterName: String, sessionId: String): String {
    return "$adapterName\u0000$sessionId"
}

internal fun runtimeMetadataFromConfigOptionsJson(
    configOptions: JsonElement?,
    adapterInfo: AcpAdapterConfig.AdapterInfo
): AcpClientService.AdapterRuntimeMetadata {
    val options = configOptions as? JsonArray ?: return adapterInfo.fallbackRuntimeMetadata()
    val parsed = options.mapNotNull(::parseConfigOption).map { option ->
        val filteredValues = when {
            option.matchesCategory("model") -> option.options.filterNot { model ->
                adapterInfo.disabledModels.any { disabled ->
                    disabled.isNotBlank() && model.value.contains(disabled)
                }
            }
            option.matchesCategory("mode") -> option.options.filterNot { mode ->
                adapterInfo.disabledModes.any { it == mode.value }
            }
            else -> option.options
        }
        option.copy(
            currentValue = option.currentValue.takeIf { current ->
                option.type != "select" || filteredValues.any { it.value == current }
            }.orEmpty(),
            options = filteredValues
        )
    }
    return if (parsed.isEmpty()) adapterInfo.fallbackRuntimeMetadata()
    else AcpClientService.AdapterRuntimeMetadata(parsed)
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
    value: String,
    type: String = "select"
): JsonObject {
    return sendRequestRaw(
        MethodName("session/set_config_option"),
        buildJsonObject {
            put("sessionId", sessionId)
            put("configId", configId)
            put("value", if (type == "boolean") JsonPrimitive(value.toBoolean()) else JsonPrimitive(value))
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
    val optionsByModel = existingCache?.configOptionsByModel.orEmpty().toMutableMap()
    val modelOption = initialMetadata.configOptions.firstOrNull { it.matchesCategory("model") }
    initialMetadata.currentModelId?.let { optionsByModel[it] = initialMetadata.configOptions }

    if (initialMetadata.usesAdapterConfigOptions) {
        return CachedAdapterConfigOptions(
            adapterId = adapterInfo.id,
            adapterVersion = adapterVersion,
            refreshedAtMillis = existingCache?.refreshedAtMillis ?: Instant.now().toEpochMilli(),
            configOptions = emptyList(),
            configOptionsByModel = emptyMap()
        )
    }

    modelOption?.options.orEmpty().forEach { model ->
        if (optionsByModel.containsKey(model.value)) return@forEach
        val metadata = if (model.value == initialMetadata.currentModelId) {
            initialMetadata
        } else {
            val response = setSessionConfigOptionRaw(sessionId, modelOption!!.id, model.value)
            runtimeMetadataFromSetConfigOptionResponseJson(response, adapterInfo)
        }
        optionsByModel[model.value] = metadata.configOptions
    }

    return CachedAdapterConfigOptions(
        adapterId = adapterInfo.id,
        adapterVersion = adapterVersion,
        refreshedAtMillis = existingCache?.refreshedAtMillis ?: Instant.now().toEpochMilli(),
        configOptions = initialMetadata.configOptions,
        configOptionsByModel = optionsByModel
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

private fun parseConfigOption(element: JsonElement, fallback: Boolean = false): AcpConfigOption? {
    val option = element as? JsonObject ?: return null
    val id = option["id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
    val type = option["type"]?.jsonPrimitive?.contentOrNull?.trim()
        ?: "select".takeIf { fallback }.orEmpty()
    if (id.isEmpty() || type !in setOf("select", "boolean")) return null
    val values = if (type == "select") flattenSelectOptions(option["options"]) else emptyList()
    if (type == "select" && values.isEmpty()) return null
    val currentValue = option["currentValue"]?.jsonPrimitive?.let { current ->
        if (type == "boolean") current.booleanOrNull?.toString() else current.contentOrNull?.trim()
    } ?: "".takeIf { fallback } ?: return null
    return AcpConfigOption(
        id = id,
        name = option["name"]?.jsonPrimitive?.contentOrNull?.trim()?.takeIf(String::isNotEmpty) ?: id,
        description = option["description"]?.jsonPrimitive?.contentOrNull?.trim()?.takeIf(String::isNotEmpty),
        category = option["category"]?.jsonPrimitive?.contentOrNull?.trim()?.takeIf(String::isNotEmpty),
        type = type,
        currentValue = currentValue,
        options = values
    )
}

private fun flattenSelectOptions(options: JsonElement?): List<AcpConfigOptionValue> {
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
                    AcpConfigOptionValue(
                        value = value,
                        name = obj["name"]?.jsonPrimitive?.contentOrNull?.trim()?.takeIf { it.isNotEmpty() } ?: value,
                        description = obj["description"]?.jsonPrimitive?.contentOrNull?.trim()?.takeIf { it.isNotEmpty() }
                    )
                )
            }
        }
    }
}

internal fun AcpAdapterConfig.AdapterInfo.fallbackConfigOptions(): List<AcpConfigOption> {
    return configOptions.mapNotNull { parseConfigOption(it, fallback = true) }
}

internal fun AcpAdapterConfig.AdapterInfo.fallbackRuntimeMetadata() = fallbackConfigOptions().let {
    AcpClientService.AdapterRuntimeMetadata(it, usesAdapterConfigOptions = it.isNotEmpty())
}

internal fun AcpAdapterConfig.AdapterInfo.configOptionMetaKey(id: String): String? = configOptions
    .firstOrNull { it.jsonObject["id"]?.jsonPrimitive?.contentOrNull?.trim() == id }
    ?.jsonObject?.get("metaKey")?.jsonPrimitive?.contentOrNull?.trim()?.takeIf(String::isNotEmpty)
