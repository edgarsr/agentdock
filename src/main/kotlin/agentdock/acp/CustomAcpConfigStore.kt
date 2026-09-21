package agentdock.acp

import agentdock.utils.atomicWriteText
import java.io.File
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

@Serializable
data class CustomAcpEnvironmentVariable(
    val name: String,
    val value: String
)

@Serializable
data class CustomAcpConfig(
    val id: String,
    val name: String,
    val command: String,
    val args: List<String> = emptyList(),
    val env: List<CustomAcpEnvironmentVariable> = emptyList(),
    val cliCommand: String? = null,
    val cliArgs: List<String> = emptyList(),
    val cliResumeArgs: List<String> = emptyList()
)

object CustomAcpConfigStore {
    private val lock = Any()
    private val json = Json {
        ignoreUnknownKeys = true
        prettyPrint = true
        encodeDefaults = false
    }

    private val configFile: File
        get() = File(AcpAdapterPaths.getBaseRuntimeDir(), "custom-acp.json")

    fun load(): List<CustomAcpConfig> = synchronized(lock) {
        val file = configFile
        if (!file.isFile) return@synchronized emptyList()
        runCatching {
            normalize(json.decodeFromString<List<CustomAcpConfig>>(file.readText()))
        }.getOrDefault(emptyList())
    }

    fun getAdapter(id: String): AcpAdapterConfig.AdapterInfo? =
        load().firstOrNull { it.id == id }?.toAdapterInfo()

    fun loadAdapters(): Map<String, AcpAdapterConfig.AdapterInfo> =
        load().associate { it.id to it.toAdapterInfo() }

    fun save(configs: List<CustomAcpConfig>): List<CustomAcpConfig> = synchronized(lock) {
        saveLocked(normalize(configs))
    }

    private fun saveLocked(configs: List<CustomAcpConfig>): List<CustomAcpConfig> {
        val file = configFile
        file.parentFile?.mkdirs()
        file.atomicWriteText(json.encodeToString(ListSerializer(CustomAcpConfig.serializer()), configs))
        return configs
    }

    private fun normalize(configs: List<CustomAcpConfig>): List<CustomAcpConfig> {
        val seenIds = hashSetOf<String>()
        return configs.mapNotNull { config ->
            val id = config.id.trim()
            val name = config.name.trim()
            val command = config.command.trim()
            if (!id.matches(Regex("custom-acp-[A-Za-z0-9-]+")) ||
                AcpAdapterConfig.isBuiltIn(id) || name.isEmpty() || command.isEmpty() || !seenIds.add(id)) {
                return@mapNotNull null
            }
            config.copy(
                id = id,
                name = name,
                command = command,
                args = config.args.map(String::trim).filter(String::isNotEmpty),
                env = config.env.mapNotNull { variable ->
                    variable.name.trim().takeIf(String::isNotEmpty)?.let { cleanName ->
                        CustomAcpEnvironmentVariable(cleanName, variable.value)
                    }
                }.distinctBy { it.name },
                cliCommand = config.cliCommand?.trim()?.takeIf(String::isNotEmpty),
                cliArgs = config.cliArgs.map(String::trim).filter(String::isNotEmpty),
                cliResumeArgs = config.cliResumeArgs.map(String::trim).filter(String::isNotEmpty)
            )
        }
    }

    private fun CustomAcpConfig.toAdapterInfo(): AcpAdapterConfig.AdapterInfo {
        val cliConfig = cliCommand?.let { executable ->
            AcpAdapterConfig.CliConfig(
                executable = AcpAdapterConfig.PlatformBinary(win = executable, unix = executable),
                args = cliArgs,
                resumeArgs = cliResumeArgs
            )
        }
        val signature = listOf(
            command,
            args.joinToString("\u0000"),
            env.joinToString("\u0000") { "${it.name}=${it.value}" }
        ).joinToString("\u0001").hashCode().toUInt().toString(16)
        return AcpAdapterConfig.AdapterInfo(
            id = id,
            name = name,
            supportsSessionList = true,
            sessionListMethod = "acpSessionList",
            distribution = AcpAdapterConfig.Distribution(
                type = AcpAdapterConfig.DistributionType.ARCHIVE,
                version = "external-$signature"
            ),
            loginMethod = "acp",
            cli = cliConfig,
            customCommand = command,
            environment = env.associate { it.name to it.value },
            args = args
        )
    }
}
