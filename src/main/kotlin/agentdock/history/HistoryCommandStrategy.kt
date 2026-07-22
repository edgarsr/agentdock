package agentdock.history

import agentdock.acp.AcpExecutionTarget
import agentdock.acp.buildAdapterCliCommandParts
import agentdock.acp.isWindowsLocalTarget
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

private const val HISTORY_CLI_COMMAND_TIMEOUT_MS = 25_000L

internal fun runAgentHistoryCliCommand(
    adapterId: String,
    projectPath: String,
    args: List<String>,
    timeoutMillis: Long = HISTORY_CLI_COMMAND_TIMEOUT_MS
): String {
    require(timeoutMillis > 0L) { "History command timeout must be positive" }
    val (_, commandParts) = buildAdapterCliCommandParts(adapterId, args)
        ?: throw IllegalStateException("Unable to build history command for adapter '$adapterId'")
    val localCommandParts = if (
        isWindowsLocalTarget(AcpExecutionTarget.LOCAL) &&
        commandParts.firstOrNull()?.let { it.endsWith(".cmd", true) || it.endsWith(".bat", true) } == true
    ) {
        listOf("cmd.exe", "/c") + commandParts
    } else {
        commandParts
    }
    val process = ProcessBuilder(localCommandParts)
        .directory(File(projectPath))
        .redirectErrorStream(true)
        .start()
    val output = StringBuilder()
    var outputFailure: Exception? = null
    val outputThread = Thread {
        try {
            process.inputStream.bufferedReader().use { reader ->
                val buffer = CharArray(DEFAULT_BUFFER_SIZE)
                while (true) {
                    val count = reader.read(buffer)
                    if (count < 0) break
                    output.append(buffer, 0, count)
                }
            }
        } catch (error: Exception) {
            outputFailure = error
        }
    }.apply {
        isDaemon = true
        name = "agentdock-history-$adapterId"
        start()
    }

    try {
        if (!process.waitFor(timeoutMillis, TimeUnit.MILLISECONDS)) {
            throw TimeoutException("History command for adapter '$adapterId' timed out after ${timeoutMillis}ms")
        }
        outputThread.join(5_000L)
        if (outputThread.isAlive) {
            throw IOException("Unable to finish reading history command output for adapter '$adapterId'")
        }
        outputFailure?.let { throw IOException("Unable to read history command output for adapter '$adapterId'", it) }
        if (process.exitValue() != 0) {
            throw IllegalStateException(
                "History command for adapter '$adapterId' exited with code ${process.exitValue()}"
            )
        }
        return output.toString().trim()
    } finally {
        if (process.isAlive) {
            process.destroy()
            if (!process.waitFor(500L, TimeUnit.MILLISECONDS)) {
                process.destroyForcibly()
            }
        }
        if (outputThread.isAlive) {
            runCatching { process.inputStream.close() }
            outputThread.interrupt()
        }
    }
}
