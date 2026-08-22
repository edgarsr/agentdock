package agentdock.bridge

/**
 * Whether the UI is currently showing a dark theme.
 *
 * Adapter icons are chosen on the backend but displayed on the client, and in Remote Development
 * the backend is headless - its own look and feel says nothing about what the user sees. The client
 * reports its theme through the `themeChanged` command instead.
 */
object ClientTheme {

    @Volatile
    var isDark: Boolean = true
        private set

    fun update(theme: String) {
        isDark = theme != "light"
    }
}
