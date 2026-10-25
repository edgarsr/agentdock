package agentdock.promptlibrary

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import agentdock.acp.AcpAdapterPaths
import agentdock.utils.atomicWriteText
import java.io.File

@Serializable
data class PromptLibraryItem(
    val id: String,
    val name: String,
    val prompt: String,
    val attachments: List<PromptAttachment> = emptyList()
)

@Serializable
data class PromptAttachment(
    val id: String,
    val name: String,
    val mimeType: String,
    val data: String? = null,
    val path: String? = null,
    val isInline: Boolean? = null,
    val attachmentType: String? = null,
    val startLine: Int? = null,
    val endLine: Int? = null,
    val quote: String? = null
)

private val json = Json {
    ignoreUnknownKeys = true
    prettyPrint = true
}

object PromptLibraryStore {
    private val configFile: File
        get() = File(AcpAdapterPaths.getBaseRuntimeDir(), "prompt-library.json")

    fun load(): List<PromptLibraryItem> {
        val file = configFile
        if (!file.exists()) return emptyList()
        return runCatching {
            json.decodeFromString(ListSerializer(PromptLibraryItem.serializer()), file.readText())
        }.getOrDefault(emptyList())
    }

    fun save(prompts: List<PromptLibraryItem>) {
        configFile.parentFile?.mkdirs()
        configFile.atomicWriteText(json.encodeToString(ListSerializer(PromptLibraryItem.serializer()), prompts))
    }
}
