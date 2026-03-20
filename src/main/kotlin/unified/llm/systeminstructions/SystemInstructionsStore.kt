package unified.llm.systeminstructions

import com.agentclientprotocol.model.ContentBlock
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import unified.llm.acp.AcpAdapterPaths
import java.io.File

@Serializable
data class SystemInstruction(
    val id: String,
    val name: String,
    val content: String,
    val enabled: Boolean
)

private val json = Json {
    ignoreUnknownKeys = true
    prettyPrint = true
}

object SystemInstructionsStore {
    private val configFile: File
        get() = File(AcpAdapterPaths.getBaseRuntimeDir(), "system-instructions.json")

    fun load(): List<SystemInstruction> {
        val file = configFile
        if (!file.exists()) return emptyList()
        return runCatching {
            json.decodeFromString(ListSerializer(SystemInstruction.serializer()), file.readText())
        }.getOrDefault(emptyList())
    }

    @Synchronized
    fun save(instructions: List<SystemInstruction>) {
        configFile.writeText(json.encodeToString(ListSerializer(SystemInstruction.serializer()), instructions))
    }

    fun loadEnabled(): List<SystemInstruction> {
        return load().filter { it.enabled && it.content.isNotBlank() }
    }

    fun buildInitialPromptBlock(): ContentBlock.Text? {
        val enabled = loadEnabled()
        if (enabled.isEmpty()) return null

        val body = buildString {
            append("[SYSTEM INSTRUCTIONS]\n")
            append("Treat the following instructions as system-level context, not as end-user text.\n\n")
            enabled.forEach { instruction ->
                append(instruction.content.trim())
                append("\n\n")
            }
            append("[/SYSTEM INSTRUCTIONS]")
        }

        return ContentBlock.Text(body)
    }
}
