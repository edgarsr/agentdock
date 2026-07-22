package agentdock.acp

import com.agentclientprotocol.model.AuthMethodId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout

object AcpLoginService {
    private const val CLI_LOGIN_TIMEOUT_MS = 60_000L
    private const val ACP_LOGIN_TIMEOUT_MS = 300_000L

    suspend fun login(
        adapterName: String,
        service: AcpClientService,
        projectPath: String? = null,
        onProgress: (suspend () -> Unit)? = null
    ): Boolean {
        val adapterInfo = AcpAdapterConfig.getAdapterInfo(adapterName)
        return when (val method = adapterInfo.authConfig?.loginMethod) {
            "cliLogin" -> cliLogin(adapterInfo, projectPath, onProgress)
            "acpAuthenticateLogin" -> acpAuthenticateLogin(adapterInfo, service)
            null -> throw IllegalStateException("Adapter '$adapterName' does not define loginMethod")
            else -> throw IllegalStateException("Unsupported login method '$method' for adapter '$adapterName'")
        }
    }

    private suspend fun cliLogin(
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        projectPath: String?,
        onProgress: (suspend () -> Unit)?
    ): Boolean = withContext(Dispatchers.IO) {
        val authConfig = adapterInfo.authConfig
            ?: throw IllegalStateException("Adapter '${adapterInfo.id}' does not define authConfig")
        if (authConfig.loginArgs.isEmpty()) {
            throw IllegalStateException("Adapter '${adapterInfo.id}' does not define loginArgs for cliLogin")
        }
        val command = AcpAuthCommand.build(adapterInfo, authConfig.loginArgs)
            ?: throw IllegalStateException("Unable to build login command for '${adapterInfo.id}'")
        val builder = ProcessBuilder(command)
            .directory(AcpAuthCommand.workingDirectory(adapterInfo, projectPath))
            .redirectErrorStream(true)
        AcpNodeRuntimeResolver.resolveAvailable()?.let { AcpNodeRuntimeResolver.applyTo(builder, it) }
        val process = builder.start()
        val output = StringBuilder()
        Thread {
            runCatching {
                process.inputStream.bufferedReader().useLines { lines ->
                    lines.forEach { output.appendLine(it) }
                }
            }
        }.apply {
            isDaemon = true
            name = "acp-login-drain-${adapterInfo.id}"
            start()
        }

        try {
            val startedAt = System.currentTimeMillis()
            var lastProgressAt = 0L
            while (System.currentTimeMillis() - startedAt < CLI_LOGIN_TIMEOUT_MS) {
                if (System.currentTimeMillis() - lastProgressAt > 3_000L) {
                    onProgress?.invoke()
                    lastProgressAt = System.currentTimeMillis()
                }
                if (!process.isAlive) {
                    val exitCode = process.exitValue()
                    if (exitCode != 0) {
                        val details = output.toString().trim().takeLast(240)
                            .takeIf { it.isNotBlank() }
                            ?.let { ": $it" }
                            .orEmpty()
                        throw IllegalStateException("Login command failed (exit $exitCode)$details")
                    }
                    return@withContext true
                }
                delay(1_000L)
            }
            process.destroyForcibly()
            throw IllegalStateException("Login timed out")
        } catch (error: CancellationException) {
            process.destroyForcibly()
            throw error
        }
    }

    @OptIn(com.agentclientprotocol.annotations.UnstableApi::class)
    private suspend fun acpAuthenticateLogin(
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        service: AcpClientService
    ): Boolean {
        val authMethodId = adapterInfo.authConfig?.authMethodId?.trim().orEmpty()
        if (authMethodId.isEmpty()) {
            throw IllegalStateException(
                "Adapter '${adapterInfo.id}' does not define authMethodId for acpAuthenticateLogin"
            )
        }

        val sharedProcess = service.activeProcesses.computeIfAbsent(service.processKey(adapterInfo.id)) {
            service.createSharedProcess(adapterInfo.id)
        }
        service.ensureSharedProcessStarted(sharedProcess, adapterInfo)
        if (authMethodId !in sharedProcess.authMethodIds) {
            throw IllegalStateException(
                "Adapter '${adapterInfo.id}' did not advertise ACP auth method '$authMethodId'"
            )
        }
        val client = sharedProcess.client
            ?: throw IllegalStateException("ACP client is not initialized for '${adapterInfo.id}'")
        withTimeout(ACP_LOGIN_TIMEOUT_MS) {
            client.authenticate(AuthMethodId(authMethodId))
        }
        return true
    }
}
