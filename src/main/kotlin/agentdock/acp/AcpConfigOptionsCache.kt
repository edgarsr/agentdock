package agentdock.acp

import agentdock.utils.atomicWriteText
import com.intellij.openapi.diagnostic.Logger
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.time.Instant

private const val CONFIG_OPTIONS_CACHE_SCHEMA_VERSION = 3
private const val CONFIG_OPTIONS_CACHE_MAX_AGE_MILLIS = 7L * 24L * 60L * 60L * 1000L

@Serializable
internal data class CachedModelConfigOptions(
    val modelId: String,
    val name: String,
    val description: String? = null,
    val modes: List<AcpAdapterConfig.ModeInfo> = emptyList(),
    val efforts: List<AcpAdapterConfig.ModeInfo> = emptyList(),
    val configOptionsLoaded: Boolean = false
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
    val modes: List<AcpAdapterConfig.ModeInfo> = emptyList(),
    val efforts: List<AcpAdapterConfig.ModeInfo> = emptyList(),
    val models: List<CachedModelConfigOptions> = emptyList()
)

@Serializable
private data class ConfigOptionsCacheFile(
    val schemaVersion: Int = CONFIG_OPTIONS_CACHE_SCHEMA_VERSION,
    val adapters: Map<String, CachedAdapterConfigOptions> = emptyMap()
)

internal object AcpConfigOptionsCache {
    private val lock = Any()
    private val log = Logger.getInstance(AcpConfigOptionsCache::class.java)

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
        return synchronized(lock) { readValidLocked(adapterInfo) }
    }

    fun write(adapterOptions: CachedAdapterConfigOptions): Boolean {
        return synchronized(lock) {
            val current = readAllLocked()
            writeAllLocked(current.copy(adapters = current.adapters + (adapterOptions.adapterId to adapterOptions)))
        }
    }

    fun updateFromSnapshot(
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        metadata: AcpClientService.AdapterRuntimeMetadata
    ): CachedAdapterConfigOptions {
        return synchronized(lock) {
            val current = readAllLocked()
            val updated = readValidLocked(adapterInfo, current).updatedWithSnapshot(
                adapterInfo = adapterInfo,
                adapterVersion = adapterVersion(adapterInfo),
                metadata = metadata
            )
            writeAllLocked(current.copy(adapters = current.adapters + (adapterInfo.id to updated)))
            updated
        }
    }

    fun remove(adapterId: String): Boolean {
        return synchronized(lock) {
            val current = readAllLocked()
            if (!current.adapters.containsKey(adapterId)) return@synchronized true
            writeAllLocked(current.copy(adapters = current.adapters - adapterId))
        }
    }

    private fun readValidLocked(
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        cache: ConfigOptionsCacheFile = readAllLocked()
    ): CachedAdapterConfigOptions? {
        val adapterVersion = adapterVersion(adapterInfo)
        val cached = cache.adapters[adapterInfo.id] ?: return null
        if (cached.adapterVersion != adapterVersion) return null
        val age = Instant.now().toEpochMilli() - cached.refreshedAtMillis
        if (age < 0L || age > CONFIG_OPTIONS_CACHE_MAX_AGE_MILLIS) return null
        return cached
    }

    private fun readAllLocked(): ConfigOptionsCacheFile {
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

    private fun writeAllLocked(content: ConfigOptionsCacheFile): Boolean {
        return try {
            val file = cacheFile()
            val parent = file.parentFile
            if (!parent.exists()) parent.mkdirs()
            file.atomicWriteText(json.encodeToString(content))
            memoryCache = content
            true
        } catch (error: Exception) {
            log.warn("Unable to persist ACP config options cache", error)
            false
        }
    }
}

internal fun CachedAdapterConfigOptions?.updatedWithSnapshot(
    adapterInfo: AcpAdapterConfig.AdapterInfo,
    adapterVersion: String,
    metadata: AcpClientService.AdapterRuntimeMetadata,
    refreshedAtMillis: Long = this?.refreshedAtMillis ?: Instant.now().toEpochMilli()
): CachedAdapterConfigOptions {
    val cachedModels = this?.models.orEmpty().associateBy { it.modelId }
    val currentModelId = metadata.currentModelId
    val models = metadata.availableModels.map { model ->
        val cached = cachedModels[model.modelId]
        val isCurrentModel = model.modelId == currentModelId
        CachedModelConfigOptions(
            modelId = model.modelId,
            name = model.name,
            description = model.description,
            modes = if (isCurrentModel) metadata.availableModes else cached?.modes.orEmpty(),
            efforts = if (isCurrentModel) metadata.availableReasoningEfforts else cached?.efforts.orEmpty(),
            configOptionsLoaded = isCurrentModel || cached?.configOptionsLoaded == true
        )
    }
    return CachedAdapterConfigOptions(
        adapterId = adapterInfo.id,
        adapterVersion = adapterVersion,
        refreshedAtMillis = refreshedAtMillis,
        currentModelId = currentModelId,
        currentModeId = metadata.currentModeId,
        currentReasoningEffortId = metadata.currentReasoningEffortId,
        modelConfigId = metadata.modelConfigId,
        modeConfigId = metadata.modeConfigId,
        reasoningEffortConfigId = metadata.reasoningEffortConfigId,
        modes = metadata.availableModes,
        efforts = metadata.availableReasoningEfforts,
        models = models
    )
}

internal fun CachedAdapterConfigOptions.toRuntimeMetadata(
    adapterInfo: AcpAdapterConfig.AdapterInfo
): AcpClientService.AdapterRuntimeMetadata {
    val filteredModels = models.filterNot { model ->
        adapterInfo.disabledModels.any { disabled -> disabled.isNotBlank() && model.modelId.contains(disabled) }
    }
    val selectedModelId = currentModelId?.takeIf { current ->
        filteredModels.any { it.modelId == current }
    }

    val selectedModel = selectedModelId?.let { id -> filteredModels.firstOrNull { it.modelId == id } }
    val effectiveModes = (selectedModel?.modes ?: modes)
        .filterNot { mode -> adapterInfo.disabledModes.any { disabled -> disabled == mode.id } }
    val selectedModeId = currentModeId?.takeIf { current ->
        effectiveModes.isEmpty() || effectiveModes.any { it.id == current }
    }

    val reasoningEfforts = selectedModel?.efforts ?: efforts
    val selectedReasoningEffortId = currentReasoningEffortId?.takeIf { current ->
        reasoningEfforts.isEmpty() || reasoningEfforts.any { it.id == current }
    }

    return AcpClientService.AdapterRuntimeMetadata(
        currentModelId = selectedModelId,
        availableModels = filteredModels.map { it.toModelInfo() },
        modelConfigId = modelConfigId,
        currentModeId = selectedModeId,
        availableModes = effectiveModes,
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
