package agentdock.history

internal object GrokSessionHistory {
    private val sessionIdPattern = Regex(
        "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
    )

    fun grokCliSessionDelete(adapterId: String, projectPath: String, sessionId: String): Boolean {
        return sessionIdPattern.matches(sessionId) && runCatching {
            runAgentHistoryCliCommand(
                adapterId = adapterId,
                projectPath = projectPath,
                args = listOf("--no-auto-update", "sessions", "delete", sessionId)
            )
        }.isSuccess
    }
}
