package agentdock.history

import agentdock.utils.atomicWriteBytes
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.io.File
import java.security.MessageDigest
import java.util.Base64

/**
 * The images of the conversations' tool calls, kept out of the data files so that these stay small
 * enough to read, rewrite after every prompt and send to the UI, which loads an image only when it
 * shows it.
 *
 * Each image is an image file in its conversation's images directory, named by the SHA-256 of its
 * bytes. In the tool call's content the image keeps its `mimeType`, and [STORED_IMAGE_KEY],
 * `<conversation id>/<file name>`, replaces its `data`. An image of another type, or whose data is
 * not base64, stays in the content.
 */
internal object HistoryImageStore {
    const val STORED_IMAGE_KEY = "storedImage"
    private val imageExtensions = mapOf("image/png" to "png", "image/jpeg" to "jpg", "image/gif" to "gif", "image/webp" to "webp")
    private val fileNamePattern = Regex("[0-9a-f]{64}\\.(${imageExtensions.values.joinToString("|")})")

    /**
     * Moves the images of [data]'s tool calls into the conversation's images directory, also those
     * of another conversation, which a fork's or a merged conversation's data refers to. Returns the
     * data referring to them and the names of the image files it uses.
     */
    fun storeImages(
        projectPath: String,
        conversationId: String,
        data: ConversationReplayData
    ): Pair<ConversationReplayData, Set<String>> {
        val dir = HistoryStorage.conversationImagesDir(projectPath, conversationId)
        val used = hashSetOf<String>()

        fun storeImage(image: JsonObject): JsonObject {
            val inline = (image["data"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotEmpty() }
            val name = if (inline != null) {
                val extension = imageExtensions[(image["mimeType"] as? JsonPrimitive)?.contentOrNull] ?: return image
                // The data may also be a data URL.
                val bytes = runCatching { Base64.getDecoder().decode(inline.substringAfter("base64,")) }.getOrNull()
                    ?: return image
                "${sha256(bytes)}.$extension".also { name -> writeIfMissing(File(dir, name)) { bytes } }
            } else {
                val (sourceConversationId, storedName) = parseRef(image[STORED_IMAGE_KEY]) ?: return image
                if (sourceConversationId != conversationId) writeIfMissing(File(dir, storedName)) {
                    File(HistoryStorage.conversationImagesDir(projectPath, sourceConversationId), storedName)
                        .takeIf { it.isFile }?.readBytes()
                }
                storedName
            }
            used += name
            return JsonObject(image - "data" + (STORED_IMAGE_KEY to JsonPrimitive("$conversationId/$name")))
        }

        val stored = data.copy(sessions = data.sessions.map { session ->
            session.copy(prompts = session.prompts.map { prompt ->
                prompt.copy(events = prompt.events.map { event -> storeToolCallImages(event, ::storeImage) })
            })
        })
        return stored to used
    }

    /** Deletes the conversation's image files that its data does not use, and the directory once none is left. */
    fun deleteUnusedImages(projectPath: String, conversationId: String, used: Set<String>) {
        val dir = HistoryStorage.conversationImagesDir(projectPath, conversationId)
        dir.listFiles()?.forEach { file -> if (file.name !in used) file.delete() }
        if (used.isEmpty()) dir.delete()
    }

    /** The base64 data of the image [ref] names, or `null` when it is gone. */
    fun readImage(projectPath: String, ref: String): String? {
        val (conversationId, name) = parseRef(JsonPrimitive(ref)) ?: return null
        val file = File(HistoryStorage.conversationImagesDir(projectPath, conversationId), name)
        return if (file.isFile) Base64.getEncoder().encodeToString(file.readBytes()) else null
    }

    private fun storeToolCallImages(event: JsonObject, storeImage: (JsonObject) -> JsonObject): JsonObject {
        val rawJson = (event["toolRawJson"] as? JsonPrimitive)?.contentOrNull ?: return event
        if (!rawJson.contains("\"image\"")) return event
        val raw = runCatching { Json.parseToJsonElement(rawJson) as? JsonObject }.getOrNull() ?: return event
        val content = raw["content"] as? JsonArray ?: return event
        val stored = JsonArray(content.map { item ->
            val block = item as? JsonObject ?: return@map item
            val inner = block["content"] as? JsonObject
            when {
                type(block) == "content" && inner != null && type(inner) == "image" ->
                    JsonObject(block + ("content" to storeImage(inner)))
                type(block) == "image" -> storeImage(block)
                else -> item
            }
        })
        if (stored == content) return event
        return JsonObject(event + ("toolRawJson" to JsonPrimitive(JsonObject(raw + ("content" to stored)).toString())))
    }

    private fun type(block: JsonObject): String? = (block["type"] as? JsonPrimitive)?.contentOrNull

    private fun parseRef(value: JsonElement?): Pair<String, String>? {
        val ref = (value as? JsonPrimitive)?.contentOrNull ?: return null
        val name = ref.substringAfter('/', "").takeIf(fileNamePattern::matches) ?: return null
        val conversationId = runCatching {
            HistoryStorage.requireSafeConversationId(ref.substringBefore('/'))
        }.getOrNull() ?: return null
        return conversationId to name
    }

    private fun writeIfMissing(file: File, bytes: () -> ByteArray?) {
        if (file.isFile) return
        file.atomicWriteBytes(bytes() ?: return)
    }

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
}
