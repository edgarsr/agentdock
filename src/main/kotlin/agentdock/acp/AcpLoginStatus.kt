package agentdock.acp

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

internal object AcpLoginStatus {
    private const val CLAUDE_CODE_METHOD = "claudeCodeCliAuthStatus"
    private const val CODEX_METHOD = "codexCliLoginStatus"
    private const val CURSOR_METHOD = "cursorCliStatus"
    private const val COPILOT_RPC_METHOD = "copilotRpcAuthStatus"
    private const val GROK_BUILD_METHOD = "grokBuildAuthFile"
    private const val QODER_METHOD = "qoderCliStatus"
    private const val STATUS_TIMEOUT_SECONDS = 10L

    fun resolve(
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        target: AcpExecutionTarget
    ): Boolean? = when (adapterInfo.loginStatusMethod) {
        CLAUDE_CODE_METHOD -> resolveClaudeCode(adapterInfo, target)
        CODEX_METHOD -> resolveCodex(adapterInfo)
        CURSOR_METHOD -> resolveCursor(adapterInfo)
        COPILOT_RPC_METHOD -> AcpCopilotAuthenticationRpc.fetchLoginStatus(adapterInfo.id)
        GROK_BUILD_METHOD -> resolveGrokBuild()
        QODER_METHOD -> resolveQoder(adapterInfo)
        else -> null
    }

    private fun resolveClaudeCode(
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        target: AcpExecutionTarget
    ): Boolean? {
        val adapterRoot = AcpAdapterPaths.getDownloadPath(adapterInfo.id, target)
        val command = AcpAdapterPaths.buildLaunchCommand(
            adapterRootPath = adapterRoot,
            adapterInfo = adapterInfo.copy(args = emptyList()),
            target = target
        ) + listOf("--cli", "auth", "status")
        val result = AcpExecutionMode.runCommand(
            command = command,
            timeoutSeconds = STATUS_TIMEOUT_SECONDS
        ) ?: return null
        return parseClaudeCodeLoginStatus(result.stdout)
            ?: parseClaudeCodeLoginStatus(result.stderr)
    }

    private fun resolveCodex(adapterInfo: AcpAdapterConfig.AdapterInfo): Boolean? =
        runCliStatusCommand(adapterInfo, listOf("login", "status"))?.let(::parseCodexLoginStatus)

    private fun resolveCursor(adapterInfo: AcpAdapterConfig.AdapterInfo): Boolean? =
        runCliStatusCommand(adapterInfo, listOf("status"))?.let(::parseCursorLoginStatus)

    private fun resolveGrokBuild(): Boolean? {
        val authFile = File(System.getProperty("user.home"), ".grok/auth.json")
        if (!authFile.isFile) return false
        val content = runCatching { authFile.readText() }.getOrNull() ?: return null
        return parseGrokBuildLoginStatus(content)
    }

    private fun resolveQoder(adapterInfo: AcpAdapterConfig.AdapterInfo): Boolean? =
        runCliStatusCommand(adapterInfo, listOf("status"))?.let(::parseQoderLoginStatus)

    private fun runCliStatusCommand(
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        args: List<String>
    ): String? {
        val (_, commandParts) = buildAdapterCliCommandParts(
            adapterId = adapterInfo.id,
            extraArgs = args
        ) ?: return null
        val command = if (
            AcpExecutionMode.isWindowsHost() &&
            commandParts.firstOrNull()?.let {
                it.endsWith(".cmd", ignoreCase = true) || it.endsWith(".bat", ignoreCase = true)
            } == true
        ) {
            listOf("cmd.exe", "/c") + commandParts
        } else {
            commandParts
        }
        val result = AcpExecutionMode.runCommand(
            command = command,
            timeoutSeconds = STATUS_TIMEOUT_SECONDS
        ) ?: return null
        return result.stdout + "\n" + result.stderr
    }
}

internal fun parseClaudeCodeLoginStatus(output: String): Boolean? {
    val jsonStart = output.indexOf('{')
    val jsonEnd = output.lastIndexOf('}')
    if (jsonStart < 0 || jsonEnd < jsonStart) return null

    return runCatching {
        Json.parseToJsonElement(output.substring(jsonStart, jsonEnd + 1))
            .jsonObject["loggedIn"]
            ?.jsonPrimitive
            ?.booleanOrNull
    }.getOrNull()
}

internal fun parseCodexLoginStatus(output: String): Boolean? {
    val lines = output.lineSequence().map { it.trim() }.filter { it.isNotEmpty() }.toList()
    return when {
        lines.any { it.equals("Not logged in", ignoreCase = true) } -> false
        lines.any { it.startsWith("Logged in", ignoreCase = true) } -> true
        else -> null
    }
}

internal fun parseCursorLoginStatus(output: String): Boolean =
    !output.contains("Not logged in", ignoreCase = true)

internal fun parseQoderLoginStatus(output: String): Boolean =
    !output.contains("Account: Not logged in", ignoreCase = true)

internal fun parseGrokBuildLoginStatus(content: String): Boolean? = runCatching {
    Json.parseToJsonElement(content).jsonObject.values.any { authEntry ->
        val key = (authEntry as? JsonObject)?.get("key") as? JsonPrimitive
        key?.contentOrNull?.isNotBlank() == true
    }
}.getOrNull()
