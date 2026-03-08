package unified.llm.acp

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Configuration for ACP adapters.
 * Reads adapter configuration from acp-adapters.json file.
 */
@OptIn(ExperimentalSerializationApi::class)
object AcpAdapterConfig {

    @Serializable
    data class ModeInfo(val id: String, val name: String)

    @Serializable
    data class ModelInfo(val modelId: String, val name: String)

    @Serializable
    data class HistoryConfig(
        val parserStrategy: String,
        val pathTemplate: String
    )

    @Serializable
    data class AuthConfig(
        val authPath: String? = null,
        val authScript: String? = null,
        val command: List<String> = emptyList(),
        val loginArgs: List<String> = emptyList(),
        val logoutArgs: List<String> = emptyList(),
        val statusArgs: List<String> = emptyList()
    )

    @Serializable
    data class PlatformBinary(
        val win: String? = null,
        val unix: String? = null
    )

    @Serializable
    enum class DistributionType {
        @SerialName("npm") NPM,
        @SerialName("archive") ARCHIVE
    }

    @Serializable
    data class Distribution(
        val type: DistributionType,
        val version: String,
        val packageName: String? = null,
        val downloadUrl: String? = null,
        val binaryName: PlatformBinary? = null,
        val extractSubdir: String? = null
    )

    @Serializable
    data class AdapterInfo(
        val id: String = "", // Filled after parsing
        val name: String,
        val iconPath: String? = null,
        val distribution: Distribution,
        val launchPath: String = "",
        val defaultModelId: String? = null,
        val models: List<ModelInfo> = emptyList(),
        val defaultModeId: String? = null,
        val modes: List<ModeInfo> = emptyList(),
        val args: List<String> = emptyList(),
        val patches: List<String> = emptyList(),
        val historyConfig: HistoryConfig? = null,
        val authConfig: AuthConfig? = null,
        /**
         * How to handle model changes mid-session:
         * - "restart-resume": restart ACP process and resume the previous session (preserves history)
         * - "restart": restart ACP process with a new session (history reset)
         * - "in-session": call sess.setModel() without restarting (works if adapter supports it)
         * Default: "in-session"
         */
        val modelChangeStrategy: String = "in-session"
    ) {
        fun getConfiguredVersion(): String = distribution.version
    }

    @Serializable
    private data class ConfigRoot(
        val adapters: Map<String, AdapterInfo>
    )

    private const val CONFIG_FILE = "/acp-adapters.json"

    private val json = Json { 
        ignoreUnknownKeys = true 
        allowComments = true
        isLenient = true
    }

    private val loadedConfig: Map<String, AdapterInfo> by lazy { parseConfig() }

    fun getAdapterInfo(name: String): AdapterInfo {
        return loadedConfig[name] ?: throw IllegalStateException(
            "Adapter '$name' not found. Available: ${loadedConfig.keys.joinToString(", ")}"
        )
    }

    fun getAllAdapters(): Map<String, AdapterInfo> = loadedConfig

    private fun parseConfig(): Map<String, AdapterInfo> {
        val content = readResource(CONFIG_FILE)
        val root = json.decodeFromString<ConfigRoot>(content)
        
        val processedAdapters = root.adapters.mapValues { (key, info) ->
            // Resolve external patch files
            val strings = info.patches.map { p -> resolveContent(p) }

            // Ensure name is set
            info.copy(id = key, patches = strings)
        }
        
        return processedAdapters
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
