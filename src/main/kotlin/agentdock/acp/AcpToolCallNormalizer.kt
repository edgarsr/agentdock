package agentdock.acp

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

private val readCommandNames = setOf("get-content", "gc", "cat", "type")
private val readCommandPathOptions = setOf("path", "literalpath")
private val readCommandOptionsWithValue = setOf(
    "credential",
    "delimiter",
    "encoding",
    "filter",
    "include",
    "exclude",
    "readcount",
    "tail",
    "totalcount"
)
private val searchCommandNames = setOf("rg", "grep")
private val searchCommandOptionsWithValue = setOf(
    "after-context",
    "before-context",
    "context",
    "count-matches",
    "encoding",
    "engine",
    "field-context-separator",
    "field-match-separator",
    "file",
    "glob",
    "iglob",
    "ignore-file",
    "json-path",
    "max-columns",
    "max-count",
    "max-depth",
    "max-filesize",
    "path-separator",
    "pre",
    "regexp",
    "replace",
    "sort",
    "threads",
    "type",
    "type-add",
    "type-clear",
    "type-not",
    "A",
    "B",
    "C",
    "e",
    "f",
    "g",
    "m",
    "t",
    "T"
)

internal fun normalizeToolRawJson(
    parsed: JsonObject,
    forceReadPath: String? = null,
    forceSearchInput: JsonObject? = null
): JsonObject? {
    normalizeExecuteReadToolRawJson(parsed, forceReadPath)?.let { return it }
    return normalizeExecuteSearchToolRawJson(parsed, forceSearchInput)
}

private fun normalizeExecuteReadToolRawJson(parsed: JsonObject, forceReadPath: String? = null): JsonObject? {
    val kind = parsed["kind"]?.jsonPrimitive?.contentOrNull?.lowercase()
    if (forceReadPath == null && kind != "execute" && kind != "read") return null

    val command = parsed.stringAt("rawInput", "command")
        ?: parsed.parsedCommandString()
        ?: parsed.stringAt("title")
    val commandPath = command?.let(::extractReadCommandPath)
    val filePath = forceReadPath?.takeIf { it.isNotBlank() }
        ?: commandPath
        ?: parsed.stringAt("rawInput", "path")
        ?: parsed.stringAt("rawInput", "filePath")
        ?: parsed.stringAt("locations", "path")
        ?: return null

    if (kind == "execute" && forceReadPath == null && commandPath == null) return null

    return buildJsonObject {
        parsed.forEach { (key, value) ->
            when (key) {
                "kind" -> put("kind", "read")
                "content", "text" -> Unit
                "rawInput" -> put("rawInput", normalizedReadRawInput(value as? JsonObject, filePath))
                "rawOutput" -> put("rawOutput", normalizedReadRawOutput(value as? JsonObject))
                "locations" -> put("locations", normalizedReadLocations(value, filePath))
                else -> put(key, value)
            }
        }
        if (parsed["kind"] == null) put("kind", "read")
        if (parsed["rawInput"] == null) put("rawInput", normalizedReadRawInput(null, filePath))
        if (parsed["locations"] == null) put("locations", normalizedReadLocations(null, filePath))
    }
}

private fun normalizedReadRawInput(rawInput: JsonObject?, filePath: String): JsonObject = buildJsonObject {
    rawInput?.forEach { (key, value) -> put(key, value) }
    if (rawInput?.get("path") == null) put("path", filePath)
    if (rawInput?.get("filePath") == null) put("filePath", filePath)
}

private fun normalizedReadRawOutput(rawOutput: JsonObject?): JsonObject = buildJsonObject {
    rawOutput?.get("parsed_cmd")?.let { put("parsed_cmd", it) }
}

private fun normalizedReadLocations(locations: JsonElement?, filePath: String): JsonArray {
    val existing = locations as? JsonArray
    if (existing != null && existing.isNotEmpty()) return existing
    return buildJsonArray {
        add(buildJsonObject { put("path", filePath) })
    }
}

private data class SearchCommand(val pattern: String, val path: String?)

private fun normalizeExecuteSearchToolRawJson(parsed: JsonObject, forceSearchInput: JsonObject? = null): JsonObject? {
    val kind = parsed["kind"]?.jsonPrimitive?.contentOrNull?.lowercase()
    if (forceSearchInput == null && kind != "execute" && kind != "search") return null

    val command = parsed.stringAt("rawInput", "command")
        ?: parsed.parsedCommandString()
        ?: parsed.stringAt("title")
    val commandSearch = command?.let(::extractSearchCommand)
    val searchInput = forceSearchInput
        ?: commandSearch?.let { buildSearchRawInput(it.pattern, it.path) }
        ?: (parsed["rawInput"] as? JsonObject)?.takeIf { input ->
            input["query"]?.jsonPrimitive?.contentOrNull?.isNotBlank() == true ||
                input["pattern"]?.jsonPrimitive?.contentOrNull?.isNotBlank() == true
        }
        ?: return null

    if (kind == "execute" && forceSearchInput == null && commandSearch == null) return null

    val title = searchInput["query"]?.jsonPrimitive?.contentOrNull
        ?: searchInput["pattern"]?.jsonPrimitive?.contentOrNull
        ?: parsed["title"]?.jsonPrimitive?.contentOrNull
        ?: "Search"

    return buildJsonObject {
        parsed.forEach { (key, value) ->
            when (key) {
                "kind" -> put("kind", "search")
                "title" -> put("title", title)
                "content", "text" -> Unit
                "rawInput" -> put("rawInput", searchInput)
                "rawOutput" -> put("rawOutput", normalizedSearchRawOutput(value as? JsonObject))
                else -> put(key, value)
            }
        }
        if (parsed["kind"] == null) put("kind", "search")
        if (parsed["title"] == null) put("title", title)
        if (parsed["rawInput"] == null) put("rawInput", searchInput)
    }
}

private fun buildSearchRawInput(pattern: String, path: String?): JsonObject = buildJsonObject {
    put("pattern", pattern)
    if (!path.isNullOrBlank()) put("path", path)
    put("query", if (path.isNullOrBlank()) pattern else "$path | $pattern")
}

private fun normalizedSearchRawOutput(rawOutput: JsonObject?): JsonObject = buildJsonObject {
    rawOutput?.get("parsed_cmd")?.let { put("parsed_cmd", it) }
}

private fun JsonObject.parsedCommandString(): String? {
    val rawOutput = this["rawOutput"] as? JsonObject ?: return null
    val parsedCommand = rawOutput["parsed_cmd"] ?: return null
    if (parsedCommand is JsonObject) return parsedCommand.stringAt("cmd")
    val parsedCommandArray = parsedCommand as? JsonArray ?: return null
    return parsedCommandArray.asReversed().firstNotNullOfOrNull { item ->
        (item as? JsonObject)?.stringAt("cmd")
    }
}

private fun JsonObject.stringAt(vararg keys: String): String? {
    var current: JsonElement = this
    for (key in keys) {
        current = when (current) {
            is JsonObject -> current[key] ?: return null
            is JsonArray -> (current.firstOrNull() as? JsonObject)?.get(key) ?: return null
            else -> return null
        }
    }

    val primitive = current as? JsonPrimitive
    if (primitive?.isString == true) return primitive.content.trim().takeIf { it.isNotBlank() }

    val array = current as? JsonArray ?: return null
    return array.asReversed().firstNotNullOfOrNull { item ->
        (item as? JsonPrimitive)
            ?.takeIf { it.isString }
            ?.content
            ?.trim()
            ?.takeIf { it.isNotBlank() }
    }
}

private fun extractReadCommandPath(command: String): String? {
    val trimmed = command.trim()
    if (trimmed.isBlank() || hasShellControlOperator(trimmed)) return null

    val tokens = shellTokens(trimmed)
    if (tokens.size < 2) return null
    if (tokens.first().lowercase() !in readCommandNames) return null

    for (index in 1 until tokens.size) {
        val token = tokens[index]
        if (!token.startsWith("-")) continue
        val optionName = token.trimStart('-').lowercase()
        if (optionName in readCommandPathOptions) {
            return tokens.getOrNull(index + 1)?.takeUnless { it.startsWith("-") }
        }
    }

    var index = 1
    while (index < tokens.size) {
        val token = tokens[index]
        if (!token.startsWith("-")) return token
        val optionName = token.trimStart('-').lowercase()
        index += if (optionName in readCommandOptionsWithValue) 2 else 1
    }

    return null
}

private fun extractSearchCommand(command: String): SearchCommand? {
    val trimmed = command.trim()
    if (trimmed.isBlank() || hasShellControlOperator(trimmed)) return null

    val tokens = shellTokens(trimmed)
    if (tokens.size < 2) return null
    val commandName = tokens.first().lowercase()
    if (commandName !in searchCommandNames) return null
    if (tokens.any { it == "--files" || it == "-l" || it == "--files-with-matches" }) return null

    val positional = mutableListOf<String>()
    var index = 1
    while (index < tokens.size) {
        val token = tokens[index]
        if (token == "--") {
            positional.addAll(tokens.drop(index + 1))
            break
        }

        if (!token.startsWith("-") || token == "-") {
            positional += token
            index++
            continue
        }

        val optionName = token.trimStart('-')
        val inlineValue = optionName.substringAfter('=', missingDelimiterValue = "")
        if (inlineValue.isNotBlank()) {
            if (optionName.substringBefore("=") in setOf("regexp", "e")) {
                positional += inlineValue
            }
            index++
            continue
        }

        if (optionName in setOf("regexp", "e")) {
            tokens.getOrNull(index + 1)?.let { positional += it }
            index += 2
            continue
        }

        index += if (optionName in searchCommandOptionsWithValue) 2 else 1
    }

    val pattern = positional.firstOrNull()?.takeIf { it.isNotBlank() } ?: return null
    val path = positional.drop(1).firstOrNull()?.takeIf { it.isNotBlank() }
    return SearchCommand(pattern, path)
}

private fun hasShellControlOperator(command: String): Boolean =
    command.any { it == '|' || it == '<' || it == '>' || it == ';' } ||
        command.contains("&&") ||
        command.contains("||")

private fun shellTokens(command: String): List<String> {
    val tokens = mutableListOf<String>()
    val current = StringBuilder()
    var quote: Char? = null

    command.forEach { char ->
        val currentQuote = quote
        when {
            currentQuote != null && char == currentQuote -> quote = null
            currentQuote != null -> current.append(char)
            char == '\'' || char == '"' -> quote = char
            char.isWhitespace() -> {
                if (current.isNotEmpty()) {
                    tokens.add(current.toString())
                    current.clear()
                }
            }
            else -> current.append(char)
        }
    }

    if (current.isNotEmpty()) tokens.add(current.toString())
    return tokens
}
