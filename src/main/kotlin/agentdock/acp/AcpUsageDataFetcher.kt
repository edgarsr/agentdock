package agentdock.acp

import kotlinx.serialization.json.*
import java.io.BufferedInputStream
import java.io.File
import java.nio.charset.StandardCharsets
import java.time.YearMonth
import java.time.ZoneOffset
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * Fetches usage/quota data from different AI provider adapters.
 */
internal object AcpUsageDataFetcher {
    private const val LOCAL_USAGE_TIMEOUT_SECONDS = 30L

    fun fetchClaudeUsageData(): String {
        val accessToken = try {
            readTargetFile("~/.claude/.credentials.json")
                ?.let { Json.parseToJsonElement(it).jsonObject.get("claudeAiOauth")?.jsonObject?.get("accessToken")?.jsonPrimitive?.content }
        } catch (_: Exception) { null }

        if (accessToken == null) return """{"authType":"api_key"}"""

        return try {
            val conn = java.net.URI("https://api.anthropic.com/api/oauth/usage").toURL()
                .openConnection() as java.net.HttpURLConnection
            conn.requestMethod = "GET"
            conn.setRequestProperty("Authorization", "Bearer $accessToken")
            conn.setRequestProperty("anthropic-beta", "oauth-2025-04-20")
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("User-Agent", "claude-code/2.1.71")
            conn.connectTimeout = 5000
            conn.readTimeout = 5000

            if (conn.responseCode == 200) {
                val body = conn.inputStream.bufferedReader().use { it.readText() }
                val obj = Json.parseToJsonElement(body).jsonObject
                JsonObject(obj + ("authType" to JsonPrimitive("subscription"))).toString()
            } else """{"authType":"subscription"}"""
        } catch (_: Exception) { """{"authType":"subscription"}""" }
    }

    fun fetchCodexUsageData(): String {
        val authJson = try {
            val text = readTargetFile("~/.codex/auth.json") ?: return ""
            Json.parseToJsonElement(text).jsonObject
        } catch (_: Exception) { return "" }

        if (authJson["auth_mode"]?.jsonPrimitive?.content == "apikey") return """{"authType":"api_key"}"""

        val accessToken = authJson["tokens"]?.jsonObject?.get("access_token")?.jsonPrimitive?.content ?: return ""

        return try {
            val conn = java.net.URI("https://chatgpt.com/backend-api/wham/usage").toURL()
                .openConnection() as java.net.HttpURLConnection
            conn.requestMethod = "GET"
            conn.setRequestProperty("Authorization", "Bearer $accessToken")
            conn.setRequestProperty("Accept", "*/*")
            conn.setRequestProperty("User-Agent", "Mozilla/5.0")
            conn.connectTimeout = 5000
            conn.readTimeout = 5000

            if (conn.responseCode == 200) {
                val body = conn.inputStream.bufferedReader().use { it.readText() }
                val obj = Json.parseToJsonElement(body).jsonObject
                JsonObject(obj + ("authType" to JsonPrimitive("subscription"))).toString()
            } else """{"authType":"subscription"}"""
        } catch (_: Exception) { """{"authType":"subscription"}""" }
    }

    fun fetchCopilotUsageData(adapterId: String): String {
        val adapterInfo = runCatching { AcpAdapterConfig.getAdapterInfo(adapterId) }.getOrNull() ?: return ""
        val target = AcpAdapterPaths.getExecutionTarget()
        val adapterRoot = AcpAdapterPaths.getDownloadPath(adapterId)
        if (!AcpAdapterPaths.isDownloaded(adapterId)) return ""
        val launchPath = AcpAdapterPaths.resolveLaunchPath(adapterRoot, adapterInfo, target) ?: return ""
        val runtime = AcpNodeRuntimeResolver.resolveAvailable() ?: return ""

        val commandLine = com.intellij.execution.configurations.GeneralCommandLine(runtime.node)
            .withParameters(launchPath, "--server", "--stdio", "--log-level", "none")
            .withEnvironment(AcpProcessEnvironment.baseEnvironment())
            .withParentEnvironmentType(com.intellij.execution.configurations.GeneralCommandLine.ParentEnvironmentType.CONSOLE)
            .let { AcpNodeRuntimeResolver.applyTo(it, runtime) }
            .withWorkDirectory(adapterRoot)
        val process = runCatching { commandLine.createProcess() }.getOrNull() ?: return ""
        val responses = LinkedBlockingQueue<JsonObject>()
        val reader = Thread {
            runCatching {
                val input = BufferedInputStream(process.inputStream)
                while (true) {
                    readCopilotRpcMessage(input)?.let(responses::offer) ?: break
                }
            }
        }.apply { isDaemon = true; start() }
        val errThread = Thread {
            runCatching { process.errorStream.bufferedReader().useLines { lines -> lines.forEach { } } }
        }.apply { isDaemon = true; start() }

        return try {
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(LOCAL_USAGE_TIMEOUT_SECONDS)
            sendCopilotRpcRequest(process, 1, "connect")
            awaitCopilotRpcResult(responses, 1, deadline) ?: return ""
            sendCopilotRpcRequest(process, 2, "account.getQuota")
            val quotaResult = awaitCopilotRpcResult(responses, 2, deadline) ?: return ""
            sendCopilotRpcRequest(process, 3, "account.getCurrentAuth")
            val authResult = awaitCopilotRpcResult(responses, 3, deadline)
            normalizeCopilotQuota(quotaResult, authResult)
        } catch (_: Exception) {
            ""
        } finally {
            process.destroy()
            if (!process.waitFor(2, TimeUnit.SECONDS)) process.destroyForcibly()
            reader.join(1000)
            errThread.join(1000)
        }
    }

    private fun sendCopilotRpcRequest(process: Process, id: Int, method: String) {
        val content = buildJsonObject {
            put("jsonrpc", "2.0")
            put("id", id)
            put("method", method)
            putJsonObject("params") {}
        }.toString().toByteArray(StandardCharsets.UTF_8)
        val header = "Content-Length: ${content.size}\r\n\r\n".toByteArray(StandardCharsets.UTF_8)
        process.outputStream.write(header)
        process.outputStream.write(content)
        process.outputStream.flush()
    }

    private fun awaitCopilotRpcResult(
        responses: LinkedBlockingQueue<JsonObject>,
        id: Int,
        deadline: Long
    ): JsonObject? {
        while (true) {
            val remaining = deadline - System.nanoTime()
            if (remaining <= 0) return null
            val message = responses.poll(remaining, TimeUnit.NANOSECONDS) ?: return null
            if (message["id"]?.jsonPrimitive?.intOrNull != id) continue
            if (message["error"] != null) return null
            return message["result"] as? JsonObject
        }
    }

    private fun readCopilotRpcMessage(input: BufferedInputStream): JsonObject? {
        var contentLength: Int? = null
        while (true) {
            val line = readCopilotRpcHeaderLine(input) ?: return null
            if (line.isEmpty()) break
            if (line.startsWith("Content-Length:", ignoreCase = true)) {
                contentLength = line.substringAfter(':').trim().toIntOrNull()
            }
        }
        val length = contentLength?.takeIf { it > 0 } ?: return null
        val bytes = ByteArray(length)
        var offset = 0
        while (offset < length) {
            val read = input.read(bytes, offset, length - offset)
            if (read < 0) return null
            offset += read
        }
        return Json.parseToJsonElement(String(bytes, StandardCharsets.UTF_8)) as? JsonObject
    }

    private fun readCopilotRpcHeaderLine(input: BufferedInputStream): String? {
        val bytes = mutableListOf<Byte>()
        while (true) {
            val next = input.read()
            if (next < 0) return null
            if (next == '\n'.code) {
                if (bytes.lastOrNull() == '\r'.code.toByte()) bytes.removeAt(bytes.lastIndex)
                return bytes.toByteArray().toString(StandardCharsets.UTF_8)
            }
            bytes += next.toByte()
        }
    }

    private fun normalizeCopilotQuota(quotaResult: JsonObject, authResult: JsonObject?): String {
        val snapshots = quotaResult["quotaSnapshots"] as? JsonObject ?: return ""
        val authInfo = authResult?.get("authInfo") as? JsonObject
        val copilotUser = authInfo?.get("copilotUser") as? JsonObject
        val isFreePlan = copilotUser
            ?.get("access_type_sku")
            ?.jsonPrimitive
            ?.contentOrNull
            ?.contains("free", ignoreCase = true) == true
        val planQuota = snapshots["premium_interactions"] as? JsonObject
        val chatQuota = snapshots["chat"] as? JsonObject
        val planEntitlement = planQuota
            ?.get("entitlementRequests")
            ?.jsonPrimitive
            ?.doubleOrNull
        val chatEntitlement = chatQuota
            ?.get("entitlementRequests")
            ?.jsonPrimitive
            ?.doubleOrNull
        val quota = when {
            chatQuota != null && (isFreePlan || (planEntitlement ?: 0.0) <= 0.0 && (chatEntitlement ?: 0.0) > 0.0) -> chatQuota
            planQuota != null -> planQuota
            chatQuota != null -> chatQuota
            else -> snapshots.values.firstOrNull { it is JsonObject } as? JsonObject ?: return ""
        }
        val nextReset = YearMonth.now(ZoneOffset.UTC)
            .plusMonths(1)
            .atDay(1)
            .atStartOfDay(ZoneOffset.UTC)
            .toInstant()
            .toString()
        val normalizedQuota = JsonObject(quota + ("resetDate" to JsonPrimitive(nextReset)))

        return buildJsonObject {
            put("quota", normalizedQuota)
        }.toString()
    }

    private fun readTargetFile(rawPath: String): String? {
        val resolved = rawPath.replace("~", System.getProperty("user.home"))
        val file = File(resolved)
        return if (!file.exists()) null else file.readText()
    }
}
