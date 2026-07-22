package agentdock.history

import java.time.LocalDate
import java.time.ZoneId

internal object GrokSessionHistory {
    private const val ALL_SESSIONS_LIMIT = Int.MAX_VALUE
    private val sessionIdPattern = Regex(
        "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
    )
    private val sessionRowPattern = Regex(
        "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})" +
            "\\s+(\\d{4}-\\d{2}-\\d{2})\\s+(\\d{4}-\\d{2}-\\d{2})\\s+(\\S+)\\s*(.*)$"
    )
    private val ansiEscapePattern = Regex("\\u001B\\[[0-?]*[ -/]*[@-~]")

    fun grokCliSessions(adapterId: String, projectPath: String): List<SessionMeta> {
        val output = runAgentHistoryCliCommand(
            adapterId = adapterId,
            projectPath = projectPath,
            args = listOf("--no-auto-update", "sessions", "list", "--limit", ALL_SESSIONS_LIMIT.toString())
        ) ?: throw IllegalStateException("Grok session list command failed")

        return parseSessionList(output, adapterId, projectPath)
    }

    fun grokCliSessionDelete(adapterId: String, projectPath: String, sessionId: String): Boolean {
        if (!sessionIdPattern.matches(sessionId)) return false
        return runAgentHistoryCliCommand(
            adapterId = adapterId,
            projectPath = projectPath,
            args = listOf("--no-auto-update", "sessions", "delete", sessionId)
        ) != null
    }

    internal fun parseSessionList(output: String, adapterId: String, projectPath: String): List<SessionMeta> {
        val lines = output.lineSequence()
            .map { ansiEscapePattern.replace(it, "").trimEnd() }
            .filter { it.isNotBlank() }
            .toList()
        if (lines.any { it == "No sessions found." }) return emptyList()

        val headerIndex = lines.indexOfFirst { it.startsWith("SESSION ID") }
        if (headerIndex < 0) {
            throw IllegalStateException("Grok session list response did not include the session table header")
        }
        val sessionLines = lines.drop(headerIndex + 1)
        if (sessionLines.isEmpty()) {
            throw IllegalStateException("Grok session list response included an empty session table")
        }

        return sessionLines.map { line ->
            val match = sessionRowPattern.matchEntire(line)
                ?: throw IllegalStateException("Grok session list contained an unrecognized session row")
            val (sessionId, createdDate, updatedDate, _, rawSummary) = match.destructured
            SessionMeta(
                sessionId = sessionId,
                adapterName = adapterId,
                projectPath = projectPath,
                title = fallbackHistoryTitle(rawSummary.takeUnless { it == "(no summary)" }),
                filePath = "",
                createdAt = parseCliDate(createdDate),
                updatedAt = parseCliDate(updatedDate)
            )
        }
    }

    private fun parseCliDate(value: String): Long =
        LocalDate.parse(value)
            .atStartOfDay(ZoneId.systemDefault())
            .toInstant()
            .toEpochMilli()
}
