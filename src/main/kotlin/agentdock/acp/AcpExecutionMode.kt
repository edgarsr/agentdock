package agentdock.acp

import agentdock.utils.AgentDockPaths
import java.io.File
import java.util.concurrent.TimeUnit

internal fun quoteUnixShellArg(value: String): String =
    "'" + value.replace("'", "'\"'\"'") + "'"

internal enum class AcpExecutionTarget {
    LOCAL
}

internal data class CommandResult(
    val exitCode: Int,
    val stdout: String,
    val stderr: String
)

internal object AcpExecutionMode {

    fun isWindowsHost(): Boolean = hostPlatform() == "windows"

    fun hostPlatform(): String {
        val os = System.getProperty("os.name").lowercase()
        return when {
            os.contains("win") -> "windows"
            os.contains("mac") -> "macos"
            else -> "linux"
        }
    }

    fun currentTarget(): AcpExecutionTarget = AcpExecutionTarget.LOCAL

    fun localBaseRuntimeDir(): File = AgentDockPaths.baseRuntimeDir()

    fun localDependenciesDir(): File = AgentDockPaths.dependenciesDir()

    fun runCommand(
        command: List<String>,
        stdin: String? = null,
        timeoutSeconds: Long = 30
    ): CommandResult? {
        return runCatching {
            val builder = ProcessBuilder(command)
                .redirectErrorStream(false)
            AcpProcessEnvironment.applyTo(builder)
            val process = builder.start()

            if (stdin != null) {
                process.outputStream.bufferedWriter().use { writer -> writer.write(stdin) }
            } else {
                process.outputStream.close()
            }

            val stdout = StringBuilder()
            val stderr = StringBuilder()
            val outThread = Thread {
                process.inputStream.bufferedReader().useLines { lines ->
                    lines.forEach { line -> stdout.appendLine(line) }
                }
            }.apply { isDaemon = true; start() }
            val errThread = Thread {
                process.errorStream.bufferedReader().useLines { lines ->
                    lines.forEach { line -> stderr.appendLine(line) }
                }
            }.apply { isDaemon = true; start() }

            val finished = process.waitFor(timeoutSeconds, TimeUnit.SECONDS)
            if (!finished) {
                process.destroyForcibly()
                outThread.join(1000)
                errThread.join(1000)
                CommandResult(-1, stdout.toString(), stderr.toString())
            } else {
                outThread.join(1000)
                errThread.join(1000)
                CommandResult(process.exitValue(), stdout.toString(), stderr.toString())
            }
        }.getOrNull()
    }
}
