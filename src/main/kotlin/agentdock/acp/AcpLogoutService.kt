package agentdock.acp

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

object AcpLogoutService {
    private const val LOGOUT_COMMAND_TIMEOUT_SECONDS = 15L

    suspend fun logout(adapterName: String): Boolean {
        val adapterInfo = AcpAdapterConfig.getAdapterInfo(adapterName)
        return when (val method = adapterInfo.authConfig?.logoutMethod) {
            "cliLogout" -> cliLogout(adapterInfo)
            null -> throw IllegalStateException("Adapter '$adapterName' does not define logoutMethod")
            else -> throw IllegalStateException("Unsupported logout method '$method' for adapter '$adapterName'")
        }
    }

    private suspend fun cliLogout(adapterInfo: AcpAdapterConfig.AdapterInfo): Boolean = withContext(Dispatchers.IO) {
        val authConfig = adapterInfo.authConfig
            ?: throw IllegalStateException("Adapter '${adapterInfo.id}' does not define authConfig")
        if (authConfig.logoutArgs.isEmpty()) {
            throw IllegalStateException("Adapter '${adapterInfo.id}' does not define logoutArgs for cliLogout")
        }
        val command = AcpAuthCommand.build(adapterInfo, authConfig.logoutArgs)
            ?: throw IllegalStateException("Unable to build logout command for '${adapterInfo.id}'")
        val builder = ProcessBuilder(command)
            .directory(AcpAuthCommand.workingDirectory(adapterInfo))
            .redirectErrorStream(true)
        AcpNodeRuntimeResolver.resolveAvailable()?.let { AcpNodeRuntimeResolver.applyTo(builder, it) }
        val process = builder.start()
        val output = StringBuilder()
        val drainer = Thread {
            runCatching {
                process.inputStream.bufferedReader().useLines { lines ->
                    lines.forEach { output.appendLine(it) }
                }
            }
        }.apply {
            isDaemon = true
            name = "acp-logout-drain-${adapterInfo.id}"
            start()
        }

        if (!process.waitFor(LOGOUT_COMMAND_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
            process.destroyForcibly()
            throw IllegalStateException("Logout timed out")
        }
        drainer.join(1_000L)
        val exitCode = process.exitValue()
        if (exitCode != 0) {
            val details = output.toString().trim().takeLast(240)
                .takeIf { it.isNotBlank() }
                ?.let { ": $it" }
                .orEmpty()
            throw IllegalStateException("Logout command failed (exit $exitCode)$details")
        }
        true
    }
}
