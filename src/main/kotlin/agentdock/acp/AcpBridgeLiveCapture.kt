package agentdock.acp

import kotlinx.serialization.json.JsonObject
import agentdock.history.ConversationAssistantMetadata
import agentdock.history.AgentDockHistoryService
import agentdock.history.ForkConversationBase

internal fun AcpBridge.beginLivePromptCapture(
    chatId: String,
    blocks: List<JsonObject>,
    forkBase: ForkConversationBase?
): String? {
    val projectPath = service.project.basePath.orEmpty()
    val sessionId = service.sessionId(chatId).orEmpty()
    val adapterName = service.activeAdapterName(chatId).orEmpty()
    if (projectPath.isBlank() || sessionId.isBlank() || adapterName.isBlank()) return null

    val captureId = "prompt-${System.nanoTime()}"
    val capture = LivePromptCapture(
        captureId = captureId,
        projectPath = projectPath,
        conversationId = chatId,
        sessionId = sessionId,
        adapterName = adapterName,
        blocks = blocks,
        forkBase = forkBase,
        startedAtMillis = System.currentTimeMillis(),
        assistantMeta = buildAssistantMetadata(
            adapterName = adapterName,
            modelId = service.activeModelId(chatId),
            modeId = service.activeModeId(chatId)
        )
    )
    livePromptCaptures.put(chatId, capture)?.let { previous ->
        synchronized(previous) {
            previous.closed = true
        }
    }
    return captureId
}

internal fun AcpBridge.appendLivePromptTextEvent(chatId: String, text: String, expectedCaptureId: String? = null) {
    val capture = livePromptCaptures[chatId] ?: return
    if (expectedCaptureId != null && capture.captureId != expectedCaptureId) return
    synchronized(capture) {
        if (capture.closed) return
        capture.events.add(buildStoredContentChunk("assistant", "text", text = text))
    }
}

internal fun AcpBridge.markLivePromptVisibleAssistantOutput(chatId: String, expectedCaptureId: String? = null) {
    val capture = livePromptCaptures[chatId] ?: return
    if (expectedCaptureId != null && capture.captureId != expectedCaptureId) return
    synchronized(capture) {
        if (capture.closed) return
        capture.hasVisibleAssistantOutput = true
    }
}

internal fun AcpBridge.ensureLivePromptNoResponseFallback(
    chatId: String,
    fallbackText: String,
    expectedCaptureId: String? = null
): Boolean {
    val capture = livePromptCaptures[chatId] ?: return false
    if (expectedCaptureId != null && capture.captureId != expectedCaptureId) return false
    return synchronized(capture) {
        if (capture.closed) return false
        if (capture.hasVisibleAssistantOutput) return false
        capture.events.add(buildStoredContentChunk("assistant", "text", text = fallbackText))
        capture.hasVisibleAssistantOutput = true
        true
    }
}

internal fun AcpBridge.flushLivePromptCapture(
    chatId: String,
    expectedCaptureId: String? = null
): ConversationAssistantMetadata? {
    val capture = livePromptCaptures[chatId] ?: return null
    if (expectedCaptureId != null && capture.captureId != expectedCaptureId) return null
    val snapshot = synchronized(capture) {
        if (capture.closed) return null
        capture.closed = true
        LivePromptCaptureSnapshot(
            projectPath = capture.projectPath,
            conversationId = capture.conversationId,
            sessionId = capture.sessionId,
            adapterName = capture.adapterName,
            blocks = capture.blocks,
            forkBase = capture.forkBase,
            events = capture.events.toList(),
            startedAtMillis = capture.startedAtMillis,
            assistantMeta = capture.assistantMeta,
            contextTokensUsed = capture.contextTokensUsed,
            contextWindowSize = capture.contextWindowSize
        )
    }
    livePromptCaptures.remove(chatId, capture)
    if (snapshot.blocks.isEmpty() && snapshot.events.isEmpty()) return null

    val durationSeconds = ((System.currentTimeMillis() - snapshot.startedAtMillis).coerceAtLeast(0L)) / 1000.0
    val assistantMeta = snapshot.assistantMeta?.copy(
        promptStartedAtMillis = snapshot.startedAtMillis,
        durationSeconds = durationSeconds,
        contextTokensUsed = snapshot.contextTokensUsed,
        contextWindowSize = snapshot.contextWindowSize
    ) ?: buildAssistantMetadata(
        adapterName = snapshot.adapterName,
        promptStartedAtMillis = snapshot.startedAtMillis,
        durationSeconds = durationSeconds,
        contextTokensUsed = snapshot.contextTokensUsed,
        contextWindowSize = snapshot.contextWindowSize
    )

    AgentDockHistoryService.appendConversationPrompt(
        projectPath = snapshot.projectPath,
        conversationId = snapshot.conversationId,
        sessionId = snapshot.sessionId,
        adapterName = snapshot.adapterName,
        blocks = snapshot.blocks,
        events = snapshot.events,
        assistantMeta = assistantMeta,
        forkBase = snapshot.forkBase
    )
    return assistantMeta
}

private data class LivePromptCaptureSnapshot(
    val projectPath: String,
    val conversationId: String,
    val sessionId: String,
    val adapterName: String,
    val blocks: List<JsonObject>,
    val forkBase: ForkConversationBase?,
    val events: List<JsonObject>,
    val startedAtMillis: Long,
    val assistantMeta: ConversationAssistantMetadata?,
    val contextTokensUsed: Long?,
    val contextWindowSize: Long?
)
