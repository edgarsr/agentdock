package unified.llm.history

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

internal object HistoryDiffCompactor {
    private const val COMPACT_DIFF_LINE_THRESHOLD = 100
    private const val COMPACT_DIFF_CONTEXT_LINES = 3

    fun compactStoredToolRawJson(rawJson: String, json: Json): String {
        val parsed = runCatching { json.parseToJsonElement(rawJson).jsonObject }.getOrNull() ?: return rawJson
        val content = when {
            parsed["kind"]?.jsonPrimitive?.contentOrNull == "edit" -> parsed["content"]?.jsonArray
            else -> parsed["content"]?.jsonArray?.takeIf { items -> items.any(::isDiffLikePayload) }
        } ?: return rawJson

        var changed = false
        val updatedContent = buildJsonArray {
            content.forEach { item ->
                val diff = item as? JsonObject
                if (diff == null || diff["type"]?.jsonPrimitive?.contentOrNull != "diff") {
                    add(item)
                    return@forEach
                }
                val compacted = compactStoredDiff(diff)
                if (compacted != diff) changed = true
                add(compacted)
            }
        }

        if (!changed) return rawJson

        return buildJsonObject {
            parsed.forEach { entry ->
                if (entry.key == "content") {
                    put(entry.key, updatedContent)
                } else {
                    put(entry.key, entry.value)
                }
            }
        }.toString()
    }

    private fun isDiffLikePayload(element: kotlinx.serialization.json.JsonElement): Boolean {
        val diff = element as? JsonObject ?: return false
        val type = diff["type"]?.jsonPrimitive?.contentOrNull
        if (type == "diff") return true
        return diff["path"] != null && diff["newText"] != null
    }

    private fun compactStoredDiff(diff: JsonObject): JsonObject {
        val oldTextPrimitive = diff["oldText"] as? JsonPrimitive
        val newTextPrimitive = diff["newText"] as? JsonPrimitive ?: return diff
        val oldText = oldTextPrimitive?.contentOrNull
        val newText = newTextPrimitive.contentOrNull ?: return diff
        val maxLines = maxOf(countLines(oldText), countLines(newText))
        if (maxLines <= COMPACT_DIFF_LINE_THRESHOLD) return diff

        val compacted = compactLargeTexts(oldText, newText) ?: return diff
        return buildJsonObject {
            diff.forEach { (key, value) ->
                when (key) {
                    "oldText" -> put(key, compacted.first?.let(::JsonPrimitive) ?: value)
                    "newText" -> put(key, JsonPrimitive(compacted.second))
                    else -> put(key, value)
                }
            }
        }
    }

    private fun compactLargeTexts(oldText: String?, newText: String): Pair<String?, String>? {
        val oldLines = oldText?.split("\n") ?: emptyList()
        val newLines = newText.split("\n")

        if (oldText == null || oldLines.isEmpty() || newLines.isEmpty()) return null

        var prefix = 0
        while (prefix < oldLines.size && prefix < newLines.size && oldLines[prefix] == newLines[prefix]) {
            prefix += 1
        }

        var oldSuffix = oldLines.size - 1
        var newSuffix = newLines.size - 1
        while (oldSuffix >= prefix && newSuffix >= prefix && oldLines[oldSuffix] == newLines[newSuffix]) {
            oldSuffix -= 1
            newSuffix -= 1
        }

        if (prefix > 0 || oldSuffix < oldLines.lastIndex || newSuffix < newLines.lastIndex) {
            val compactOld = compactChangedRegion(oldLines, prefix, oldSuffix)
            val compactNew = compactChangedRegion(newLines, prefix, newSuffix)
            if (compactOld != null || compactNew != null) {
                return (compactOld ?: oldText) to (compactNew ?: newText)
            }
        }

        return null
    }

    private fun compactChangedRegion(lines: List<String>, prefix: Int, changedEndInclusive: Int): String? {
        if (lines.size <= COMPACT_DIFF_LINE_THRESHOLD) return null
        val start = (prefix - COMPACT_DIFF_CONTEXT_LINES).coerceAtLeast(0)
        val endExclusive = (changedEndInclusive + COMPACT_DIFF_CONTEXT_LINES + 1).coerceAtMost(lines.size)
        if (start == 0 && endExclusive == lines.size) return null

        return lines.subList(start, endExclusive).joinToString("\n")
    }

    private fun countLines(text: String?): Int {
        if (text.isNullOrEmpty()) return 0
        return text.split("\n").size
    }
}
