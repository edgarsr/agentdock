package agentdock.bridge.frontend

import agentdock.settings.GlobalSettings

/**
 * The client-side copy of the backend's settings file.
 *
 * The theme, the notification sounds, the dictation and the status bar widget all run in this
 * process but the file they describe lives on the backend. Rather than giving the client a second
 * settings file to drift from, the backend sends a snapshot whenever the settings change and this
 * holds the latest one. Defaults apply until the first snapshot arrives, exactly as they would for
 * a settings file that has not been written yet.
 */
object FrontendSettings {

    @Volatile
    var current: GlobalSettings = GlobalSettings()
        private set

    private val listeners = mutableListOf<(GlobalSettings) -> Unit>()

    fun apply(updated: GlobalSettings) {
        current = updated
        val snapshot = synchronized(listeners) { listeners.toList() }
        snapshot.forEach { listener -> runCatching { listener(updated) } }
    }

    fun addListener(listener: (GlobalSettings) -> Unit) {
        synchronized(listeners) { listeners.add(listener) }
    }

    fun removeListener(listener: (GlobalSettings) -> Unit) {
        synchronized(listeners) { listeners.remove(listener) }
    }
}
