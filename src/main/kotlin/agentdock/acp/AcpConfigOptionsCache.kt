package agentdock.acp

import agentdock.utils.atomicWriteText
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.time.Instant

private const val CONFIG_OPTIONS_CACHE_SCHEMA_VERSION = 2
private const val CONFIG_OPTIONS_CACHE_MAX_AGE_MILLIS = 7L * 24L * 60L * 60L * 1000L

@Serializable
internal data class CachedModelConfigOptions(
    val modelId: String,
    val name: String,
    val description: String? = null,
    val modes: List<AcpAdapterConfig.ModeInfo> = emptyList(),
    val efforts: List<AcpAdapterConfig.ModeInfo> = emptyList()
) {
    fun toModelInfo(): AcpAdapterConfig.ModelInfo {
        return AcpAdapterConfig.ModelInfo(
            modelId = modelId,
            name = name,
            description = description
        )
    }
}

@Serializable
internal data class CachedAdapterConfigOptions(
    val adapterId: String,
    val adapterVersion: String,
    val refreshedAtMillis: Long,
    val currentModelId: String? = null,
    val currentModeId: String? = null,
    val currentReasoningEffortId: String? = null,
    val modelConfigId: String? = null,
    val modeConfigId: String? = null,
    val reasoningEffortConfigId: String? = null,
    val models: List<CachedModelConfigOptions> = emptyList()
)

@Serializable
private data class ConfigOptionsCacheFile(
    val schemaVersion: Int = CONFIG_OPTIONS_CACHE_SCHEMA_VERSION,
    val adapters: Map<String, CachedAdapterConfigOptions> = emptyMap()
)

internal object AcpConfigOptionsCache {
    @Volatile
    private var memoryCache: ConfigOptionsCacheFile? = null

    private val json = Json {
        ignoreUnknownKeys = true
        prettyPrint = true
        encodeDefaults = false
        explicitNulls = false
    }

    private fun cacheFile(): File {
        val dir = AcpAdapterPaths.getBaseRuntimeDir()
        if (!dir.exists()) dir.mkdirs()
        return File(dir, "config-options-cache.json")
    }

    fun adapterVersion(adapterInfo: AcpAdapterConfig.AdapterInfo): String {
        return AcpAdapterPaths.installedVersion(adapterInfo.id, AcpAdapterPaths.getExecutionTarget())
            ?: adapterInfo.getConfiguredVersion()
    }

    fun readValid(adapterInfo: AcpAdapterConfig.AdapterInfo): CachedAdapterConfigOptions? {
        val adapterVersion = adapterVersion(adapterInfo)
        val cached = readAll().adapters[adapterInfo.id] ?: return null
        if (cached.adapterVersion != adapterVersion) return null
        val age = Instant.now().toEpochMilli() - cached.refreshedAtMillis
        if (age < 0L || age > CONFIG_OPTIONS_CACHE_MAX_AGE_MILLIS) return null
        return cached
    }

    fun write(adapterOptions: CachedAdapterConfigOptions) {
        val current = readAll()
        writeAll(current.copy(adapters = current.adapters + (adapterOptions.adapterId to adapterOptions)))
    }

    fun remove(adapterId: String) {
        val current = readAll()
        if (!current.adapters.containsKey(adapterId)) return
        writeAll(current.copy(adapters = current.adapters - adapterId))
    }

    private fun readAll(): ConfigOptionsCacheFile {
        memoryCache?.let { return it }
        val file = cacheFile()
        if (!file.exists() || !file.isFile) return ConfigOptionsCacheFile().also { memoryCache = it }
        return runCatching {
            json.decodeFromString<ConfigOptionsCacheFile>(file.readText())
                .takeIf { it.schemaVersion == CONFIG_OPTIONS_CACHE_SCHEMA_VERSION }
        }.getOrNull()
            ?.also { memoryCache = it }
            ?: ConfigOptionsCacheFile().also { memoryCache = it }
    }

    private fun writeAll(content: ConfigOptionsCacheFile) {
        memoryCache = content
        val file = cacheFile()
        val parent = file.parentFile
        if (!parent.exists()) parent.mkdirs()
        file.atomicWriteText(json.encodeToString(content))
    }
}

internal fun CachedAdapterConfigOptions.toRuntimeMetadata(
    adapterInfo: AcpAdapterConfig.AdapterInfo
): AcpClientService.AdapterRuntimeMetadata {
    val filteredModels = models.filterNot { model ->
        adapterInfo.disabledModels.any { disabled -> disabled.isNotBlank() && model.modelId.contains(disabled) }
    }
    val savedPreference = AcpAgentPreferencesStore.preferenceFor(adapterInfo.id)
    val selectedModelId = savedPreference?.modelId
        ?.takeIf { preferred -> filteredModels.any { it.modelId == preferred } }
        ?: currentModelId?.takeIf { current -> filteredModels.any { it.modelId == current } }
        ?: filteredModels.firstOrNull()?.modelId

    val selectedModel = selectedModelId?.let { id -> filteredModels.firstOrNull { it.modelId == id } }
    val modes = selectedModel?.modes.orEmpty()
        .filterNot { mode -> adapterInfo.disabledModes.any { disabled -> disabled == mode.id } }
    val selectedModeId = savedPreference?.modeId
        ?.takeIf { preferred -> modes.any { it.id == preferred } }
        ?: currentModeId?.takeIf { current -> modes.any { it.id == current } }
        ?: modes.firstOrNull()?.id

    val reasoningEfforts = selectedModel?.efforts.orEmpty()
    val selectedReasoningEffortId = savedPreference?.reasoningEffortId
        ?.takeIf { preferred -> reasoningEfforts.any { it.id == preferred } }
        ?: currentReasoningEffortId?.takeIf { current -> reasoningEfforts.any { it.id == current } }
        ?: reasoningEfforts.firstOrNull()?.id

    return AcpClientService.AdapterRuntimeMetadata(
        currentModelId = selectedModelId,
        availableModels = filteredModels.map { it.toModelInfo() },
        modelConfigId = modelConfigId,
        currentModeId = selectedModeId,
        availableModes = modes,
        modeConfigId = modeConfigId,
        currentReasoningEffortId = selectedReasoningEffortId,
        availableReasoningEfforts = reasoningEfforts,
        reasoningEffortConfigId = reasoningEffortConfigId?.takeIf { reasoningEfforts.isNotEmpty() },
        availableModesByModel = filteredModels.associate { model ->
            model.modelId to model.modes.filterNot { mode ->
                adapterInfo.disabledModes.any { disabled -> disabled == mode.id }
            }
        },
        availableReasoningEffortsByModel = filteredModels.associate { model ->
            model.modelId to model.efforts
        }
    )
}
