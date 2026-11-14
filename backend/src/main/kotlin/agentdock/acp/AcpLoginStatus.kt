package agentdock.acp

import com.agentclientprotocol.rpc.MethodName
import java.io.File
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlin.time.Duration.Companion.seconds

internal object AcpLoginStatus {
    private const val ACP_METHOD = "acp"
    private const val ANTIGRAVITY_METHOD = "antigravityCliModels"
    private const val CODEX_METHOD = "codexCliLoginStatus"
    private const val CURSOR_METHOD = "cursorCliStatus"
    private const val COPILOT_RPC_METHOD = "copilotRpcAuthStatus"
    private const val GROK_BUILD_METHOD = "grokBuildAuthFile"
    private const val QODER_METHOD = "qoderCliStatus"
    private const val STATUS_TIMEOUT_SECONDS = 10L

    /** Whether [resolve] can tell the status; null until an ACP agent's process has reported its capabilities. */
    fun isSupported(adapterInfo: AcpAdapterConfig.AdapterInfo, service: AcpClientService): Boolean? =
        if (adapterInfo.loginStatusMethod == ACP_METHOD) service.authStatusAvailability[adapterInfo.id] else true

    /** Blocks for the non-ACP methods; call from an IO context. */
    suspend fun resolve(
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        service: AcpClientService
    ): Boolean? = when (adapterInfo.loginStatusMethod) {
        ACP_METHOD -> if (isSupported(adapterInfo, service) == false) null else resolveAcp(adapterInfo.id, service)
        ANTIGRAVITY_METHOD -> runCliStatusCommand(adapterInfo, listOf("models"))?.let(::parseAntigravityLoginStatus)
        CODEX_METHOD -> resolveCodex(adapterInfo)
        CURSOR_METHOD -> resolveCursor(adapterInfo)
        COPILOT_RPC_METHOD -> AcpCopilotAuthenticationRpc.fetchLoginStatus(adapterInfo.id)
        GROK_BUILD_METHOD -> resolveGrokBuild()
        QODER_METHOD -> resolveQoder(adapterInfo)
        else -> null
    }

    /**
     * Sends the draft-RFD `auth/status` request raw: Kotlin SDK 0.34.0 models an older response
     * shape (`authenticated`) than adapters send (`state`).
     */
    private suspend fun resolveAcp(adapterId: String, service: AcpClientService): Boolean? = try {
        val protocol = AcpAuthenticationService.initializedProcess(adapterId, service).protocol
            .takeIf { service.authStatusAvailability[adapterId] == true }
        withTimeoutOrNull(STATUS_TIMEOUT_SECONDS.seconds) {
            protocol?.sendRequestRaw(MethodName("auth/status"), JsonObject(emptyMap()))
        }?.let(::parseAcpLoginStatus)
    } catch (error: CancellationException) {
        throw error
    } catch (_: Exception) {
        null
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
    ): String? = runAdapterCliCommand(adapterInfo.id, args, STATUS_TIMEOUT_SECONDS.seconds)
        ?.let { it.stdout + "\n" + it.stderr }
}

/** `agy models` lists one model per line as `id<TAB>name`, or asks to sign in; anything else, such as a network error, is unknown. */
internal fun parseAntigravityLoginStatus(output: String): Boolean? = when {
    output.contains("Please sign in", ignoreCase = true) -> false
    output.lineSequence().any { it.trim().contains('\t') } -> true
    else -> null
}

/** `auth/status` answers `authenticated`, `unauthenticated`, or `unknown`, which is no result. */
internal fun parseAcpLoginStatus(response: JsonElement): Boolean? =
    when (((response as? JsonObject)?.get("state") as? JsonPrimitive)?.contentOrNull) {
        "authenticated" -> true
        "unauthenticated" -> false
        else -> null
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
