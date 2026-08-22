package agentdock.bridge.frontend

/**
 * Commands the client answers itself.
 *
 * A handler belongs here when sending it to the backend would be wrong or merely slow: the mouse
 * cursor and the repaint touch this process's own Swing component, dictation needs this machine's
 * microphone, and notification sounds have to come out of this machine's speakers. Everything not
 * registered here falls through to the backend.
 */
internal class FrontendCommands {

    private val handlers = HashMap<String, (String) -> Unit>()

    fun register(name: String, handler: (String) -> Unit) {
        handlers[name] = handler
    }

    /** Returns `true` when the command was handled locally and must not be forwarded. */
    fun handleLocally(name: String, payload: String): Boolean {
        val handler = handlers[name] ?: return false
        runCatching { handler(payload) }
        return true
    }
}
