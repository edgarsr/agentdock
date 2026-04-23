package agentdock.history

internal object HistorySessionSourceResolver {
    fun findSessionSourceMeta(projectPath: String, sessionId: String, adapterName: String): SessionMeta? {
        val indexedSession = findIndexedSessionEntry(projectPath, sessionId, adapterName) ?: return null
        val sourceFilePath = indexedSession.sourceFilePath?.takeIf { it.isNotBlank() }
            ?: SessionListDeleteSupport.resolveSourceFilePath(projectPath, adapterName, sessionId)
        return SessionMeta(
            sessionId = sessionId,
            adapterName = adapterName,
            projectPath = projectPath,
            title = "Untitled Session",
            filePath = sourceFilePath,
            createdAt = indexedSession.createdAt,
            updatedAt = indexedSession.updatedAt
        )
    }

    private fun findIndexedSessionEntry(
        projectPath: String,
        sessionId: String,
        adapterName: String
    ): HistorySessionIndexEntry? {
        if (projectPath.isBlank() || sessionId.isBlank() || adapterName.isBlank()) return null
        return HistoryStorage.readExistingProjectIndex(projectPath)
            .asSequence()
            .flatMap { it.sessions.asSequence() }
            .firstOrNull { it.sessionId == sessionId && it.adapterName == adapterName }
    }
}
