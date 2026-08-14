package agentdock.acp

import agentdock.history.ConversationReplayData
import kotlinx.serialization.json.JsonPrimitive

private const val PROBE_TEXT_LENGTH = 200
private val whitespaceRun = Regex("\\s+")

private fun normalize(value: CharSequence): String = whitespaceRun.replace(value, " ").trim()

/** Keeps only the first and the last assistant answer of a suppressed replay, both bounded. */
internal class ReplayFreshnessProbe {
    private val current = StringBuilder()
    var firstText: String? = null
    var lastText: String? = null

    @Synchronized
    fun appendAssistantText(text: String) {
        if (current.length < PROBE_TEXT_LENGTH * 8) current.append(text)
    }

    @Synchronized
    fun closeMessage() {
        val text = normalize(current).take(PROBE_TEXT_LENGTH)
        current.setLength(0)
        if (text.isEmpty()) return
        if (firstText == null) firstText = text
        lastText = text
    }
}

/**
 * Discards a cached replay only on positive evidence: the agent's last answer is missing while an
 * earlier one is present. Anything else keeps the cache, since a wrong discard is visible to the user.
 */
internal fun conversationWasContinuedElsewhere(
    probe: ReplayFreshnessProbe,
    cached: ConversationReplayData
): Boolean {
    val lastText = probe.lastText ?: return false
    val controlText = probe.firstText ?: return false

    var controlFound = false
    var lastFound = false
    for (session in cached.sessions) {
        for (prompt in session.prompts) {
            val text = normalize(
                prompt.events.asSequence()
                    .filter { (it["role"] as? JsonPrimitive)?.content == "assistant" }
                    .filter { (it["type"] as? JsonPrimitive)?.content == "text" }
                    .mapNotNull { (it["text"] as? JsonPrimitive)?.content }
                    .joinToString("")
            )
            if (!controlFound) controlFound = text.contains(controlText)
            if (!lastFound) lastFound = text.contains(lastText)
            if (controlFound && lastFound) return false
        }
    }
    return controlFound && !lastFound
}
