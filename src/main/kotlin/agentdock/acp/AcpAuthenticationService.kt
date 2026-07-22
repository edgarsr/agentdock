package agentdock.acp

import com.agentclientprotocol.model.AuthMethod
import java.io.File
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout

internal object AcpAuthenticationService {
    private const val AUTH_TIMEOUT_MS = 300_000L
    private const val LOGOUT_TIMEOUT_MS = 15_000L

    @OptIn(com.agentclientprotocol.annotations.UnstableApi::class)
    suspend fun login(
        adapterId: String,
        methodId: String,
        service: AcpClientService
    ): Boolean {
        val adapterInfo = AcpAdapterConfig.getAdapterInfo(adapterId)
        return when (adapterInfo.loginMethod) {
            "acp" -> acpLogin(adapterId, methodId, service)
            "cli" -> {
                cliLogin(adapterInfo)
                true
            }
            else -> throw IllegalStateException("Login is not configured for '$adapterId'")
        }
    }

    @OptIn(com.agentclientprotocol.annotations.UnstableApi::class)
    private suspend fun acpLogin(
        adapterId: String,
        methodId: String,
        service: AcpClientService
    ): Boolean {
        val sharedProcess = initializedProcess(adapterId, service)
        val method = sharedProcess.authMethods.firstOrNull { it.id.value == methodId }
            ?: throw IllegalStateException(
                "Adapter '$adapterId' did not advertise ACP auth method '$methodId'"
            )

        when (method) {
            is AuthMethod.AgentAuth -> {
                val client = sharedProcess.client
                    ?: throw IllegalStateException("ACP client is not initialized for '$adapterId'")
                withTimeout(AUTH_TIMEOUT_MS) {
                    client.authenticate(method.id)
                }
                return false
            }

            is AuthMethod.TerminalAuth -> {
                runCommandAuth(adapterId, method, service)
                return true
            }

            else -> throw IllegalStateException(
                "ACP auth method '${method.name}' has an unsupported type"
            )
        }
    }

    private suspend fun cliLogin(adapterInfo: AcpAdapterConfig.AdapterInfo) {
        val target = AcpAdapterPaths.getExecutionTarget()
        val adapterRoot = AcpAdapterPaths.getDownloadPath(adapterInfo.id, target)
        val command = AcpAdapterPaths.buildLaunchCommand(
            adapterRootPath = adapterRoot,
            adapterInfo = adapterInfo.copy(args = emptyList()),
            target = target
        ) + adapterInfo.loginArgs
        runCommand(
            adapterId = adapterInfo.id,
            command = command,
            workingDirectory = File(adapterRoot),
            timeoutMs = AUTH_TIMEOUT_MS,
            actionName = "Login"
        )
    }

    suspend fun logout(adapterId: String, service: AcpClientService): Boolean {
        val adapterInfo = AcpAdapterConfig.getAdapterInfo(adapterId)
        return when (adapterInfo.logoutMethod) {
            "acp" -> {
                acpLogout(adapterId, service)
                false
            }
            "cli" -> {
                cliLogout(adapterInfo)
                true
            }
            null -> throw IllegalStateException("Logout is not configured for '$adapterId'")
            else -> throw IllegalStateException(
                "Unsupported logout method '${adapterInfo.logoutMethod}' for '$adapterId'"
            )
        }
    }

    @OptIn(com.agentclientprotocol.annotations.UnstableApi::class)
    private suspend fun acpLogout(adapterId: String, service: AcpClientService) {
        val sharedProcess = initializedProcess(adapterId, service)
        if (!sharedProcess.logoutAvailable) {
            throw IllegalStateException("Adapter '$adapterId' did not advertise ACP logout")
        }
        val client = sharedProcess.client
            ?: throw IllegalStateException("ACP client is not initialized for '$adapterId'")
        withTimeout(AUTH_TIMEOUT_MS) {
            client.logout()
        }
    }

    private suspend fun cliLogout(adapterInfo: AcpAdapterConfig.AdapterInfo) {
        check(adapterInfo.logoutArgs.isNotEmpty()) {
            "Adapter '${adapterInfo.id}' does not define logoutArgs for CLI logout"
        }
        val target = AcpAdapterPaths.getExecutionTarget()
        val adapterRoot = AcpAdapterPaths.getDownloadPath(adapterInfo.id, target)
        val command = AcpAdapterPaths.buildLaunchCommand(
            adapterRootPath = adapterRoot,
            adapterInfo = adapterInfo.copy(args = emptyList()),
            target = target
        ) + adapterInfo.logoutArgs
        runCommand(
            adapterId = adapterInfo.id,
            command = command,
            workingDirectory = File(adapterRoot),
            timeoutMs = LOGOUT_TIMEOUT_MS,
            actionName = "Logout"
        )
    }

    private suspend fun initializedProcess(
        adapterId: String,
        service: AcpClientService
    ): AcpClientService.SharedProcess {
        val adapterInfo = AcpAdapterConfig.getAdapterInfo(adapterId)
        val sharedProcess = service.activeProcesses.computeIfAbsent(service.processKey(adapterId)) {
            service.createSharedProcess(adapterId)
        }
        service.ensureSharedProcessStarted(sharedProcess, adapterInfo)
        return sharedProcess
    }

    @OptIn(com.agentclientprotocol.annotations.UnstableApi::class)
    private suspend fun runCommandAuth(
        adapterId: String,
        method: AuthMethod.TerminalAuth,
        service: AcpClientService
    ) {
        val adapterInfo = AcpAdapterConfig.getAdapterInfo(adapterId)
        val target = AcpAdapterPaths.getExecutionTarget()
        val adapterRoot = AcpAdapterPaths.getDownloadPath(adapterId, target)
        val command = AcpAdapterPaths.buildLaunchCommand(
            adapterRootPath = adapterRoot,
            adapterInfo = adapterInfo,
            projectPath = service.project.basePath,
            target = target
        ) + method.args.orEmpty()
        val workingDirectory = service.project.basePath
            ?.takeIf { it.isNotBlank() }
            ?.let(::File)
            ?: File(adapterRoot)
        runCommand(
            adapterId = adapterId,
            command = command,
            workingDirectory = workingDirectory,
            environment = method.env.orEmpty(),
            timeoutMs = AUTH_TIMEOUT_MS,
            actionName = "Authentication"
        )
    }

    private suspend fun runCommand(
        adapterId: String,
        command: List<String>,
        workingDirectory: File,
        environment: Map<String, String> = emptyMap(),
        timeoutMs: Long,
        actionName: String
    ) = withContext(Dispatchers.IO) {
        val builder = ProcessBuilder(command)
            .directory(workingDirectory)
            .redirectErrorStream(true)
        AcpProcessEnvironment.applyTo(builder)
        AcpNodeRuntimeResolver.resolveAvailable()?.let { runtime ->
            AcpNodeRuntimeResolver.applyTo(builder, runtime)
        }
        builder.environment().putAll(environment)

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
            name = "acp-${actionName.lowercase()}-drain-$adapterId"
            start()
        }

        try {
            val startedAt = System.currentTimeMillis()
            while (process.isAlive && System.currentTimeMillis() - startedAt < timeoutMs) {
                delay(250L)
            }
            if (process.isAlive) {
                AcpProcessUtils.destroyProcessTree(process.toHandle())
                throw IllegalStateException("$actionName timed out")
            }
            drainer.join(1_000L)
            val exitCode = process.exitValue()
            if (exitCode != 0) {
                val details = output.toString().trim().takeLast(240)
                    .takeIf { it.isNotBlank() }
                    ?.let { ": $it" }
                    .orEmpty()
                throw IllegalStateException("$actionName command failed (exit $exitCode)$details")
            }
        } catch (error: CancellationException) {
            AcpProcessUtils.destroyProcessTree(process.toHandle())
            throw error
        } catch (error: Exception) {
            if (process.isAlive) {
                AcpProcessUtils.destroyProcessTree(process.toHandle())
            }
            throw error
        }
    }
}
