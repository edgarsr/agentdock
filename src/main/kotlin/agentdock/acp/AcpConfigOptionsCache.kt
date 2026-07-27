package agentdock.acp

import agentdock.utils.atomicWriteText
import com.intellij.openapi.diagnostic.Logger
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.time.Instant

private const val CONFIG_OPTIONS_CACHE_SCHEMA_VERSION = 5
private const val CONFIG_OPTIONS_CACHE_MAX_AGE_MILLIS = 7L * 24L * 60L * 60L * 1000L

@Serializable
internal data class CachedAdapterConfigOptions(
    val adapterId: String,
    val adapterVersion: String,
    val refreshedAtMillis: Long,
    val configOptions: List<AcpConfigOption> = emptyList(),
    val reasoningEffortsByModel: Map<String, List<AcpConfigOptionValue>> = emptyMap()
)

@Serializable
private data class ConfigOptionsCacheFile(
    // Defaults to 0 so a file written before versioning (or with the field stripped) fails the schema check.
    val schemaVersion: Int = 0,
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
            val versioned = content.copy(schemaVersion = CONFIG_OPTIONS_CACHE_SCHEMA_VERSION)
            file.atomicWriteText(json.encodeToString(versioned))
            memoryCache = versioned
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
    val effortsByModel = this?.reasoningEffortsByModel.orEmpty().toMutableMap()
    metadata.currentModelId?.let { modelId ->
        effortsByModel[modelId] = metadata.configOptions.firstOrNull { it.isReasoning() }
            ?.options
            .orEmpty()
    }
    val cachedReasoning = this?.configOptions?.firstOrNull { it.isReasoning() }
    val configOptions = if (
        cachedReasoning != null && metadata.configOptions.none { it.isReasoning() }
    ) {
        metadata.configOptions + cachedReasoning.copy(currentValue = "", options = emptyList())
    } else {
        metadata.configOptions
    }
    return CachedAdapterConfigOptions(
        adapterId = adapterInfo.id,
        adapterVersion = adapterVersion,
        refreshedAtMillis = refreshedAtMillis,
        configOptions = configOptions,
        reasoningEffortsByModel = effortsByModel
    )
}

internal fun CachedAdapterConfigOptions.toRuntimeMetadata(
    adapterInfo: AcpAdapterConfig.AdapterInfo
): AcpClientService.AdapterRuntimeMetadata {
    val filteredOptions = configOptions.map { option ->
        val values = when {
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
                option.type != "select" || values.any { it.value == current }
            }.orEmpty(),
            options = values
        )
    }
    val modelIds = filteredOptions
        .firstOrNull { it.matchesCategory("model") }
        ?.options
        .orEmpty()
        .mapTo(mutableSetOf()) { it.value }
    return AcpClientService.AdapterRuntimeMetadata(
        configOptions = filteredOptions,
        reasoningEffortsByModel = reasoningEffortsByModel.filterKeys(modelIds::contains)
    )
}
