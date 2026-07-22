package agentdock.acp

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.util.concurrent.TimeUnit

object AcpAuthStatusService {
    private const val STATUS_COMMAND_TIMEOUT_SECONDS = 15L
    private val statusJson = Json { ignoreUnknownKeys = true }

    data class AuthStatus(val authenticated: Boolean)

    fun getStatus(adapterName: String): AuthStatus {
        val adapterInfo = runCatching { AcpAdapterConfig.getAdapterInfo(adapterName) }.getOrNull()
            ?: throw IllegalArgumentException("Unknown ACP adapter: $adapterName")
        return when (val method = adapterInfo.authConfig?.statusMethod) {
            "cliAuthStatus" -> cliAuthStatus(adapterInfo)
            "grokAuthStatus" -> grokAuthStatus()
            null -> throw IllegalStateException("Adapter '$adapterName' does not define statusMethod")
            else -> throw IllegalStateException("Unsupported status method '$method' for adapter '$adapterName'")
        }
    }

    fun grokAuthStatus(authFile: File = File(System.getProperty("user.home"), ".grok/auth.json")): AuthStatus {
        if (!authFile.isFile) return AuthStatus(authenticated = false)

        val authenticated = runCatching {
            statusJson.parseToJsonElement(authFile.readText()).jsonObject.values.any { entry ->
                (entry as? JsonObject)?.get("key")?.jsonPrimitive?.contentOrNull?.isNotBlank() == true
            }
        }.getOrDefault(false)
        return AuthStatus(authenticated = authenticated)
    }

    private fun cliAuthStatus(adapterInfo: AcpAdapterConfig.AdapterInfo): AuthStatus {
        val authConfig = adapterInfo.authConfig
            ?: throw IllegalStateException("Adapter '${adapterInfo.id}' does not define authConfig")
        if (authConfig.statusArgs.isEmpty()) {
            throw IllegalStateException("Adapter '${adapterInfo.id}' does not define statusArgs for cliAuthStatus")
        }

        // Preserve the current shared CLI behavior until these adapters receive dedicated status methods.
        return runCatching {
            val command = AcpAuthCommand.build(adapterInfo, authConfig.statusArgs).orEmpty()
            if (command.isEmpty()) return@runCatching AuthStatus(authenticated = true)
            val builder = ProcessBuilder(command)
                .directory(AcpAuthCommand.workingDirectory(adapterInfo))
                .redirectErrorStream(true)
            AcpNodeRuntimeResolver.resolveAvailable()?.let { AcpNodeRuntimeResolver.applyTo(builder, it) }
            val process = builder.start()
            val output = process.inputStream.bufferedReader().use { it.readText() }.trim()
            val finished = process.waitFor(STATUS_COMMAND_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            if (!finished) {
                process.destroyForcibly()
                return@runCatching AuthStatus(authenticated = true)
            }
            AuthStatus(authenticated = parseAuthenticatedFromStatusOutput(output) ?: true)
        }.getOrElse {
            AuthStatus(authenticated = true)
        }
    }

    private fun parseAuthenticatedFromStatusOutput(output: String): Boolean? {
        if (output.isBlank()) return null

        val parsedJson = runCatching {
            val jsonStart = output.indexOf('{')
            val jsonEnd = output.lastIndexOf('}')
            val cleanOutput = if (jsonStart >= 0 && jsonEnd > jsonStart) {
                output.substring(jsonStart, jsonEnd + 1)
            } else {
                output
            }
            statusJson.parseToJsonElement(cleanOutput).jsonObject
        }.getOrNull()

        if (parsedJson != null) {
            val loggedIn = parsedJson["loggedIn"]?.jsonPrimitive?.booleanOrNull
                ?: parsedJson["logged_in"]?.jsonPrimitive?.booleanOrNull
            if (loggedIn != null) return loggedIn
            parsedJson["authenticated"]?.jsonPrimitive?.booleanOrNull?.let { return it }
            if (!parsedJson["login"]?.jsonPrimitive?.contentOrNull.isNullOrBlank()) return true
        }

        val lower = output.lowercase()
        if (lower.contains("\"loggedin\": true") || lower.contains("\"loggedin\":true")) return true
        if (lower.contains("not logged in")) return false
        if (lower.contains("logged in")) return true
        if (lower.contains("authenticated")) return true
        return null
    }
}
