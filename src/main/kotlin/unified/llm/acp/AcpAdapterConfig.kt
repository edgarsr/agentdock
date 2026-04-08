package unified.llm.acp

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Configuration for ACP adapters.
 * Reads adapter configuration from per-adapter JSON files.
 */
@OptIn(ExperimentalSerializationApi::class)
object AcpAdapterConfig {

    @Serializable
    data class ModeInfo(
        val id: String,
        val name: String,
        val description: String? = null
    )

    @Serializable
    data class ModelInfo(
        val modelId: String,
        val name: String,
        val description: String? = null
    )

    @Serializable
    data class AuthConfig(
        val authScript: String? = null,
        val uiMode: String = "login_logout",
        val loginMode: String = "background",
        val command: List<String> = emptyList(),
        val statusArgs: List<String> = emptyList(),
        val loginArgs: List<String> = emptyList(),
        val logoutArgs: List<String> = emptyList()
    )

    @Serializable
    data class PlatformBinary(
        val win: String? = null,
        val unix: String? = null
    )

    @Serializable
    data class CliConfig(
        val executable: PlatformBinary,
        val entryPath: String? = null,
        val args: List<String> = emptyList(),
        val resumeArgs: List<String> = emptyList()
    )

    @Serializable
    enum class DistributionType {
        @SerialName("npm") NPM,
        @SerialName("archive") ARCHIVE
    }

    @Serializable
    enum class UpdateSourceType {
        @SerialName("github_release") GITHUB_RELEASE
    }

    @Serializable
    data class UpdateSource(
        val type: UpdateSourceType,
        val owner: String? = null,
        val repo: String? = null,
        val tagPrefix: String = "v"
    )

    @Serializable
    data class Distribution(
        val type: DistributionType,
        val version: String,
        val packageName: String? = null,
        val downloadUrl: String? = null,
        val binaryName: PlatformBinary? = null,
        val extractSubdir: String? = null,
        val updateSource: UpdateSource? = null
    )

    @Serializable
    data class AdapterInfo(
        val id: String = "", // Filled after parsing
        val name: String,
        val iconPath: String? = null,
        val supportsSessionList: Boolean = true,
        val distribution: Distribution,
        val launchPath: String = "",
        val launchBinary: PlatformBinary? = null,
        val disabledModels: List<String> = emptyList(),
        val disabledModes: List<String> = emptyList(),
        val args: List<String> = emptyList(),
        val patches: List<String> = emptyList(),
        val authConfig: AuthConfig? = null,
        val cli: CliConfig? = null,
        /**
         * How to handle model changes mid-session:
         * - "restart-resume": restart ACP process and resume the previous session (preserves history)
         * - "in-session": call sess.setModel() without restarting (works if adapter supports it)
         * Default: "in-session"
         */
        val modelChangeStrategy: String = "in-session"
    ) {
        fun getConfiguredVersion(): String = distribution.version

        fun withDistributionVersion(version: String): AdapterInfo {
            return copy(distribution = distribution.copy(version = version))
        }
    }

    @Serializable
    private data class ConfigIndex(
        val files: List<String>
    )

    private const val CONFIG_INDEX_FILE = "/acp-adapters/index.json"

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
        val content = readResource(CONFIG_INDEX_FILE)
        val index = json.decodeFromString<ConfigIndex>(content)

        return index.files.associate { file ->
            val resourcePath = if (file.startsWith("/")) file else "/$file"
            val info = json.decodeFromString<AdapterInfo>(readResource(resourcePath))
            val adapterId = info.id.ifBlank {
                throw IllegalStateException("Adapter config '$resourcePath' is missing a non-blank id")
            }

            val strings = info.patches.map { p -> resolveContent(p) }
            adapterId to info.copy(id = adapterId, patches = strings)
        }
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
