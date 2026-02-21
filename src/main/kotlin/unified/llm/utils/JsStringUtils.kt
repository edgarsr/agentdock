package unified.llm.utils

/**
 * Escapes a string for safe injection into JavaScript code within single quotes.
 * Handles common escape sequences: backslash, single quote, newline, carriage return.
 */
fun String.escapeForJsString(): String {
    return this
        .replace("\\", "\\\\")
        .replace("'", "\\'")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
}
