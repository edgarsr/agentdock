package agentdock.utils

import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

/**
 * Renders a string as a JavaScript string literal, quotes included, ready to be interpolated
 * into executeJavaScript source. JSON string literals are a subset of JavaScript string
 * literals, so the JSON encoder does the escaping and nothing is escaped by hand.
 */
fun String.jsStringLiteral(): String = Json.encodeToString(String.serializer(), this)
