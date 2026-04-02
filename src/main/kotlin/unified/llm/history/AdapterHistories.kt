package unified.llm.history

internal interface AdapterHistory {
    val adapterId: String

    fun collectSessions(projectPath: String): List<SessionMeta>

    fun deleteSession(projectPath: String, sessionId: String, sourceFilePath: String?): Boolean
}

internal object AdapterHistoryRegistry {
    private val histories: Map<String, AdapterHistory> = listOf(
        ClaudeCodeHistory,
        CodexHistory,
        CursorCliHistory,
        GeminiCliHistory,
        GithubCopilotCliHistory,
        KiloHistory,
        OpenCodeHistory
    ).associateBy { it.adapterId }

    fun get(adapterId: String): AdapterHistory? = histories[adapterId]

    fun all(): Collection<AdapterHistory> = histories.values
}
