package agentdock.acp

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray

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
    data class AgentVersionConfig(
        val args: List<String>,
        val pattern: String? = null,
        val command: String = "adapter"
    )

    @Serializable
    data class PlatformBinary(
        val win: String? = null,
        val unix: String? = null,
        val macos: String? = null,
        val linux: String? = null
    )

    @Serializable
    data class CliConfig(
        val executable: PlatformBinary,
        val entryPath: String? = null,
        val args: List<String> = emptyList(),
        val resumeArgs: List<String> = emptyList(),
        val minimumVersion: String? = null
    )

    @Serializable
    enum class DistributionType {
        @SerialName("npm") NPM,
        @SerialName("archive") ARCHIVE
    }

    @Serializable
    enum class PatchRoot {
        @SerialName("package") PACKAGE,
        @SerialName("runtime") RUNTIME
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
        val minimumVersion: String? = null,
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
        val iconPathLight: String? = null,
        val iconPathDark: String? = null,
        val supportsSessionList: Boolean = true,
        val sessionListMethod: String = "acpSessionList",
        val sessionListPosixCwd: Boolean = false,
        val sessionDeleteMethod: String? = null,
        val distribution: Distribution,
        val launchPath: String = "",
        val launchBinary: PlatformBinary? = null,
        val disabledModels: List<String> = emptyList(),
        val disabledModes: List<String> = emptyList(),
        val skipUnavailablePreferredModel: Boolean = false,
        val configOptions: JsonArray = JsonArray(emptyList()),
        val args: List<String> = emptyList(),
        val platformArgs: Map<String, List<String>> = emptyMap(),
        val patchRoot: PatchRoot = PatchRoot.PACKAGE,
        val patches: List<String> = emptyList(),
        val loginMethod: String? = null,
        val logoutMethod: String? = null,
        val loginStatusMethod: String? = null,
        val loginArgs: List<String> = listOf("login"),
        val logoutArgs: List<String> = listOf("logout"),
        val agentVersionConfig: AgentVersionConfig? = null,
        val cli: CliConfig? = null
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
