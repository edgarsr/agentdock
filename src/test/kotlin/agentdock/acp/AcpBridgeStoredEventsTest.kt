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

    @Test
    fun `incremental execute update preserves earlier output`() {
        val existing = executeRaw("compiling...")
        val incoming = executeRaw("tests...")

        val merged = mergeStoredToolOutput(existing, incoming, incoming)

        assertEquals("compiling...\n\ntests...", executeOutput(merged))
    }

    @Test
    fun `execute snapshot is not appended to its own prefix`() {
        val existing = executeRaw("compiling...")
        val incoming = executeRaw("compiling...\ndone")

        val merged = mergeStoredToolOutput(existing, incoming, incoming)

        assertEquals("compiling...\ndone", executeOutput(merged))
    }

    @Test
    fun `output is preserved across updates before execute kind is known`() {
        val first = executeRaw("A", includeKind = false)
        val second = executeRaw("B", includeKind = false)
        val third = executeRaw("C")

        val afterSecond = mergeStoredToolOutput(first, second, second)
        val afterThird = mergeStoredToolOutput(afterSecond, third, third)

        assertEquals("A\n\nB\n\nC", executeOutput(afterThird))
    }

    @Test
    fun `incremental output preserves structured tool content`() {
        val resource = buildJsonObject {
            put("type", "resource")
            put("uri", "file:///report.json")
        }
        val existing = buildJsonObject {
            put("kind", "execute")
            put("content", buildJsonArray {
                add(resource)
                add(textContent("compiling..."))
            })
        }
        val incoming = buildJsonObject {
            put("kind", "execute")
            put("content", buildJsonArray {
                add(textContent("done"))
                add(buildJsonObject {
                    put("type", "image")
                    put("data", "image-data")
                })
            })
        }

        val merged = mergeStoredToolOutput(existing, incoming, incoming)
        val content = merged["content"] as JsonArray

        assertEquals("resource", (content[0] as JsonObject)["type"]?.jsonPrimitive?.contentOrNull)
        assertEquals("compiling...\n\ndone", executeOutput(merged))
        assertEquals("image", (content[3] as JsonObject)["type"]?.jsonPrimitive?.contentOrNull)
    }

    @Test
    fun `structured update without text preserves existing content order`() {
        val existing = buildJsonObject {
            put("kind", "execute")
            put("content", buildJsonArray {
                add(textContent("done"))
                add(buildJsonObject {
                    put("type", "resource")
                    put("uri", "file:///report.json")
                })
            })
        }
        val incoming = buildJsonObject {
            put("kind", "execute")
            put("content", buildJsonArray {
                add(buildJsonObject {
                    put("type", "image")
                    put("data", "image-data")
                })
            })
        }

        val merged = mergeStoredToolOutput(existing, incoming, incoming)
        val content = merged["content"] as JsonArray

        assertEquals(listOf("content", "resource", "image"), content.map { item ->
            (item as JsonObject)["type"]?.jsonPrimitive?.contentOrNull
        })
        assertEquals("done", executeOutput(merged))
    }

    @Test
    fun `text stays before structured content when output grows`() {
        val existing = buildJsonObject {
            put("kind", "execute")
            put("content", buildJsonArray {
                add(textContent("first"))
                add(buildJsonObject {
                    put("type", "image")
                    put("data", "first-image")
                })
            })
        }
        val incoming = executeRaw("second")

        val merged = mergeStoredToolOutput(existing, incoming, incoming)
        val content = merged["content"] as JsonArray

        assertEquals(listOf("content", "image", "content"), content.map { item ->
            (item as JsonObject)["type"]?.jsonPrimitive?.contentOrNull
        })
        assertEquals("first\n\nsecond", executeOutput(merged))
    }

    @Test
    fun `raw output deltas are accumulated without content blocks`() {
        val existing = rawOutput("first")
        val incoming = rawOutput("second")

        val merged = mergeStoredToolOutput(existing, incoming, incoming)

        assertEquals("first\n\nsecond", executeOutput(merged))
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

    private fun executeRaw(text: String, includeKind: Boolean = true): JsonObject = buildJsonObject {
        if (includeKind) put("kind", "execute")
        put(
            "content",
            buildJsonArray {
                add(textContent(text))
            }
        )
    }

    private fun textContent(text: String): JsonObject = buildJsonObject {
        put("type", "content")
        put("content", buildJsonObject {
            put("type", "text")
            put("text", text)
        })
    }

    private fun rawOutput(text: String): JsonObject = buildJsonObject {
        put("kind", "execute")
        put("rawOutput", buildJsonObject {
            put("message", text)
        })
    }

    private fun executeOutput(raw: JsonObject): String? {
        val content = raw["content"] as? JsonArray ?: return null
        val texts = content.mapNotNull { item ->
            val obj = item as? JsonObject ?: return@mapNotNull null
            val nested = obj["content"] as? JsonObject
            nested?.get("text")?.jsonPrimitive?.contentOrNull
                ?: obj["text"]?.jsonPrimitive?.contentOrNull
        }
        return texts.takeIf { it.isNotEmpty() }?.joinToString("\n\n")
    }

}
