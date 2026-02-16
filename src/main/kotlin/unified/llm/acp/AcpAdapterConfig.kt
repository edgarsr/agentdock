package unified.llm.acp

import java.util.Properties

/**
 * Configuration for ACP adapters.
 * Reads adapter configuration from acp-adapters.properties file.
 *
 * Format:
 * adapter.default=<adapter-name>
 * adapter.<name>.resource=<resource-directory-name>
 * adapter.<name>.displayName=<display-name>
 * adapter.<name>.npmPackage=<npm-package-name>
 * adapter.<name>.npmVersion=<npm-package-version>
 * adapter.<name>.launchPath=<relative-path-to-node-entrypoint>
 * adapter.<name>.defaultModelId=<model-id> (optional)
 * adapter.<name>.patch.<n>.file=<relative-path>
 * adapter.<name>.patch.<n>.find=<text-to-find>
 * adapter.<name>.patch.<n>.replace=<replacement-text>
 */
object AcpAdapterConfig {
    private const val CONFIG_FILE = "/acp-adapters.properties"

    data class Patch(val file: String, val find: String, val replace: String)

    data class AdapterInfo(
        val name: String,
        val resourceName: String,
        val displayName: String,
        val npmPackage: String? = null,
        val npmVersion: String? = null,
        val launchPath: String,
        val defaultModelId: String? = null,
        val args: String? = null,
        val patches: List<Patch> = emptyList()
    )

    private val config: Map<String, AdapterInfo> by lazy { parseConfig() }

    fun getDefaultAdapterName(): String {
        return config["default"]?.name
            ?: throw IllegalStateException(
                "No default adapter configured in $CONFIG_FILE. Set 'adapter.default' property."
            )
    }

    fun getAdapterInfo(name: String): AdapterInfo {
        return config[name] ?: throw IllegalStateException(
            "Adapter '$name' not found in configuration. " +
            "Available adapters: ${config.keys.joinToString(", ")}"
        )
    }

    fun getAllAdapters(): Map<String, AdapterInfo> = config

    fun getDefaultAdapterResourceName(): String {
        return getAdapterInfo(getDefaultAdapterName()).resourceName
    }

    fun getDefaultModelId(): String? {
        return getAdapterInfo(getDefaultAdapterName()).defaultModelId
    }

    private fun parseConfig(): Map<String, AdapterInfo> {
        val props = Properties()
        val configStream = AcpAdapterConfig::class.java.getResourceAsStream(CONFIG_FILE)
            ?: throw IllegalStateException(
                "Configuration file $CONFIG_FILE not found in plugin resources. " +
                "Ensure the file exists in src/main/resources/"
            )

        configStream.use { props.load(it) }

        val defaultName = props.getProperty("adapter.default")
            ?: throw IllegalStateException("No 'adapter.default' property found in $CONFIG_FILE")

        val adapters = mutableMapOf<String, AdapterInfo>()

        // Register default adapter under "default" key
        adapters["default"] = buildAdapterInfo(props, defaultName)

        // Load all adapter definitions by scanning for adapter.<name>.resource keys
        props.stringPropertyNames().forEach { key ->
            if (key.startsWith("adapter.") && key.endsWith(".resource")) {
                val adapterName = key.removePrefix("adapter.").removeSuffix(".resource")
                if (adapterName != "default") {
                    adapters[adapterName] = buildAdapterInfo(props, adapterName)
                }
            }
        }

        check(adapters.isNotEmpty()) {
            "No adapters configured in $CONFIG_FILE. Add at least one adapter definition."
        }

        return adapters
    }

    private fun buildAdapterInfo(props: Properties, name: String): AdapterInfo {
        val patches = mutableListOf<Patch>()
        var i = 1
        while (true) {
            val file = props.getProperty("adapter.$name.patch.$i.file") ?: break
            val find = props.getProperty("adapter.$name.patch.$i.find") ?: break
            val replace = props.getProperty("adapter.$name.patch.$i.replace") ?: break
            patches.add(Patch(file, find, replace))
            i++
        }
        return AdapterInfo(
            name = name,
            resourceName = props.getProperty("adapter.$name.resource", name),
            displayName = props.getProperty("adapter.$name.displayName", name),
            npmPackage = props.getProperty("adapter.$name.npmPackage"),
            npmVersion = props.getProperty("adapter.$name.npmVersion"),
            launchPath = props.getProperty("adapter.$name.launchPath"),
            defaultModelId = props.getProperty("adapter.$name.defaultModelId"),
            args = props.getProperty("adapter.$name.args"),
            patches = patches
        )
    }
}
