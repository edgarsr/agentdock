package agentdock.acp

import com.agentclientprotocol.model.ContentBlock
import kotlinx.serialization.json.*
import agentdock.history.ConversationPromptReplayEntry
import agentdock.history.ConversationReplayData
import agentdock.history.ConversationSessionReplayEntry
import agentdock.history.AgentDockHistoryService
import agentdock.history.HistoryReplayStore

internal fun AcpBridge.startHistoryReplayCapture(
    chatId: String,
    projectPath: String,
    conversationId: String
) {
    if (projectPath.isBlank() || conversationId.isBlank()) return
    historyReplayCaptures[chatId] = HistoryReplayCapture(
        projectPath = projectPath,
        conversationId = conversationId
    )
}

internal fun AcpBridge.beginImportedReplaySession(
    chatId: String,
    sessionId: String,
    adapterName: String
) {
    val capture = historyReplayCaptures[chatId] ?: return
    capture.currentSessionId = sessionId.takeIf { it.isNotBlank() }
    capture.currentAdapterName = adapterName.takeIf { it.isNotBlank() }
}

internal fun AcpBridge.discardHistoryReplayCapture(chatId: String) {
    historyReplayCaptures.remove(chatId)
}

internal fun AcpBridge.flushHistoryReplayCapture(chatId: String): ConversationReplayData? {
    val capture = historyReplayCaptures.remove(chatId) ?: return null
    val sessions = capture.sessions
        .filter { it.prompts.isNotEmpty() }
        .map { session ->
            ConversationSessionReplayEntry(
                sessionId = session.sessionId,
                adapterName = session.adapterName,
                prompts = session.prompts.map { prompt ->
                    ConversationPromptReplayEntry(
                        blocks = prompt.blocks,
                        events = prompt.events,
                        assistantMeta = prompt.assistantMeta
                    )
                }
            )
        }
    if (sessions.isEmpty()) return null
    val data = HistoryReplayStore.normalizeReplayData(ConversationReplayData(sessions = sessions))
    AgentDockHistoryService.saveConversationReplay(
        projectPath = capture.projectPath,
        conversationId = capture.conversationId,
        data = data
    )
    return data
}

internal fun AcpBridge.recordReplayUserBlock(
    chatId: String,
    sessionId: String,
    adapterName: String,
    messageId: String?,
    content: ContentBlock
) {
    val capture = historyReplayCaptures[chatId] ?: return
    if (sessionId.isBlank() || adapterName.isBlank()) return
    val block = storedReplayPromptBlockFromContentBlock(content) ?: return
    val session = getOrCreateReplaySession(capture, sessionId, adapterName)
    val prompt = getOrCreateReplayUserPrompt(session, messageId)
    prompt.blocks.add(block)
}

private fun getOrCreateReplayUserPrompt(
    session: ReplaySessionCapture,
    messageId: String?
): ReplayPromptCapture {
    val normalizedMessageId = messageId?.trim()?.takeIf(String::isNotEmpty)
    val current = session.prompts.lastOrNull()
    if (current != null && normalizedMessageId == null) {
        // Message IDs are optional. Preserve the legacy one-chunk-per-prompt fallback
        // instead of guessing boundaries for agents that do not provide them.
        if (current.events.isEmpty() && current.blocks.isEmpty()) return current
    }
    if (normalizedMessageId != null &&
        current != null &&
        current.sourceMessageId == normalizedMessageId &&
        current.events.isEmpty() &&
        current.assistantMeta == null
    ) return current

    return ReplayPromptCapture(sourceMessageId = normalizedMessageId).also {
        session.prompts.add(it)
    }
}

internal fun AcpBridge.getOrCreateReplaySession(
    capture: HistoryReplayCapture,
    sessionId: String,
    adapterName: String
): ReplaySessionCapture {
    val existing = capture.sessions.firstOrNull {
        it.sessionId == sessionId && it.adapterName == adapterName
    }
    if (existing != null) return existing
    return ReplaySessionCapture(sessionId = sessionId, adapterName = adapterName).also {
        capture.sessions.add(it)
    }
}

internal fun AcpBridge.getOrCreateReplayPrompt(session: ReplaySessionCapture): ReplayPromptCapture {
    val current = session.prompts.lastOrNull()
    if (current == null) {
        return ReplayPromptCapture().also { session.prompts.add(it) }
    }
    return current
}
