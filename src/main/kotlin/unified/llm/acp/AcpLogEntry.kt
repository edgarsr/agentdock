package unified.llm.acp

/**
 * A single raw JSON-RPC message captured for the debug log.
 */
data class AcpLogEntry(
    val direction: Direction,
    val json: String,
    val timestampMillis: Long = System.currentTimeMillis()
) {
    enum class Direction { SENT, RECEIVED }
}
