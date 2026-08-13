package agentdock.acp

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals

class AcpBridgeStoredEventsTest {

    @Test
    fun `incremental edit update preserves diffs for earlier files`() {
        val firstFile = diff("first.txt", "before one", "after one")
        val secondFile = diff("second.txt", "before two", "")
        val existing = editRaw(firstFile)
        val incoming = editRaw(secondFile)

        val merged = mergeEditDiffContent(existing, incoming, incoming)
        val paths = (merged["content"] as JsonArray).map { item ->
            (item as JsonObject)["path"]?.jsonPrimitive?.contentOrNull
        }

        assertEquals(listOf("first.txt", "second.txt"), paths)
    }

    @Test
    fun `new snapshot replaces earlier diff for the same file`() {
        val existing = editRaw(
            diff("first.txt", "before one", "after one"),
            diff("second.txt", "before two", "after two")
        )
        val incoming = editRaw(diff("first.txt", "before one", "latest one"))

        val merged = mergeEditDiffContent(existing, incoming, incoming)
        val content = merged["content"] as JsonArray

        val paths = content.map { item ->
            (item as JsonObject)["path"]?.jsonPrimitive?.contentOrNull
        }
        assertEquals(listOf("first.txt", "second.txt"), paths)
        assertEquals("latest one", (content.first() as JsonObject)["newText"]?.jsonPrimitive?.contentOrNull)
    }

    private fun editRaw(vararg diffs: JsonObject): JsonObject = buildJsonObject {
        put("kind", "edit")
        put("content", buildJsonArray { diffs.forEach { diff -> add(diff) } })
    }

    private fun diff(path: String, oldText: String, newText: String): JsonObject = buildJsonObject {
        put("type", "diff")
        put("path", path)
        put("oldText", oldText)
        put("newText", newText)
    }
}
