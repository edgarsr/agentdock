package agentdock.utils

import java.io.File

/**
 * Where the plugin keeps its runtime files on the machine it is running on.
 *
 * Both processes resolve this independently, which is what Split Mode needs: agent runtimes are
 * downloaded on the host next to the project, while the speech model belongs on the client next to
 * the microphone.
 */
object AgentDockPaths {

    private const val RUNTIME_DIR_NAME = ".agent-dock"

    fun baseRuntimeDir(): File = File(System.getProperty("user.home"), RUNTIME_DIR_NAME)

    fun dependenciesDir(): File = File(baseRuntimeDir(), "dependencies")
}
