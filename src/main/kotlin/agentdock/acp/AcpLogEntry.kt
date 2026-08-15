package agentdock.acp

/**
 * A single raw JSON-RPC message captured for the debug log.
 */
data class AcpLogEntry(
    val adapterId: String,
    val direction: Direction,
    val json: String,
    val category: Category = Category.PROTOCOL,
    val timestampMillis: Long = System.currentTimeMillis()
) {
    enum class Direction { SENT, RECEIVED }
    enum class Category { PROTOCOL, INTERNAL, STDERR }
}
