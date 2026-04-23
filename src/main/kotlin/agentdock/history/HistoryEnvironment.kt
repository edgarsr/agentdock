package agentdock.history

internal object HistoryEnvironment {
    fun historySyncKey(projectPath: String): String = projectPath

    fun conversationId(adapterName: String, sessionId: String): String {
        return "conv_" + historyHashMd5("$adapterName:$sessionId")
    }
}
