package unified.llm.acp

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.InputStreamReader

/**
 * Configuration for ACP adapters.
 * Reads adapter configuration from acp-adapters.json file.
 */
@OptIn(ExperimentalSerializationApi::class)
object AcpAdapterConfig {

    @Serializable
    data class ModeInfo(val id: String, val displayName: String)

    @Serializable
    data class ModelInfo(val id: String, val displayName: String)

    @Serializable
    data class HistoryConfig(
        val parserStrategy: String,
        val pathTemplate: String,
        val resumeArgName: String? = null,
        val cleanupTemplates: List<String> = emptyList(),
        val metadataExtraction: Map<String, String> = emptyMap()
    )

    @Serializable
    data class AdapterInfo(
        val name: String = "", // Filled after parsing
        val resourceName: String? = null,
        val displayName: String,
        val npmPackage: String? = null,
        val npmVersion: String? = null,
        val launchPath: String,
        val defaultModelId: String? = null,
        val models: List<ModelInfo> = emptyList(),
        val defaultModeId: String? = null,
        val modes: List<ModeInfo> = emptyList(),
        val args: List<String> = emptyList(),
        val patches: List<String> = emptyList(),
        val historyConfig: HistoryConfig? = null,
        /**
         * How to handle model changes mid-session:
         * - "restart-resume": restart ACP process and resume the previous session (preserves history)
         * - "restart": restart ACP process with a new session (history reset)
         * - "in-session": call sess.setModel() without restarting (works if adapter supports it)
         * Default: "in-session"
         */
        val modelChangeStrategy: String = "in-session"
    ) {
        // Helper to handle optional resourceName logic
        fun getEffectiveResourceName(): String = resourceName ?: name
    }

    @Serializable
    private data class ConfigRoot(
        val defaultAdapter: String,
        val adapters: Map<String, AdapterInfo>
    )

    private const val CONFIG_FILE = "/acp-adapters.json"

    private val json = Json { 
        ignoreUnknownKeys = true 
        allowComments = true
        isLenient = true
    }

    private val loadedConfig: Pair<String, Map<String, AdapterInfo>> by lazy { parseConfig() }

    fun getDefaultAdapterName(): String = loadedConfig.first

    fun getAdapterInfo(name: String): AdapterInfo {
        return loadedConfig.second[name] ?: throw IllegalStateException(
            "Adapter '$name' not found. Available: ${loadedConfig.second.keys.joinToString(", ")}"
        )
    }

    fun getAllAdapters(): Map<String, AdapterInfo> = loadedConfig.second

    fun getDefaultAdapterResourceName(): String {
        val name = getDefaultAdapterName()
        return getAdapterInfo(name).getEffectiveResourceName()
    }

    fun getDefaultModelId(): String? {
        return getAdapterInfo(getDefaultAdapterName()).defaultModelId
    }

    private fun parseConfig(): Pair<String, Map<String, AdapterInfo>> {
        val content = readResource(CONFIG_FILE)
        val root = json.decodeFromString<ConfigRoot>(content)
        
        val processedAdapters = root.adapters.mapValues { (key, info) ->
            // Resolve external patch files
            val strings = info.patches.map { p -> resolveContent(p) }

            // Ensure name is set and resourceName defaults to name if null
            info.copy(
                name = key,
                resourceName = info.resourceName ?: key,
                patches = strings
            )
        }
        
        return root.defaultAdapter to processedAdapters
    }

    private fun resolveContent(text: String): String {
        if (text.startsWith("@")) {
            val path = text.substring(1)
            // Ensure path starts with / for resource loading from root
            val resourcePath = if (path.startsWith("/")) path else "/$path"
            return readResource(resourcePath)
        }
        return text
    }

    private fun readResource(path: String): String {
        val stream = AcpAdapterConfig::class.java.getResourceAsStream(path)
            ?: throw IllegalStateException("Resource not found: $path")
        return stream.reader().use { it.readText() }
    }
}
