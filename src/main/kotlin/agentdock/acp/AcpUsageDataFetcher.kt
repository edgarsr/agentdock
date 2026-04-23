package agentdock.acp

import kotlinx.serialization.json.*
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Fetches usage/quota data from different AI provider adapters.
 */
internal object AcpUsageDataFetcher {
    private const val LOCAL_USAGE_TIMEOUT_SECONDS = 30L

    fun fetchGeminiUsageData(adapterId: String): String {
        return try {
            val (_, commandParts) = buildAdapterCliCommandParts(adapterId, listOf("--usage-json")) ?: return ""
            val adapterDir = AcpAdapterPaths.getDownloadPath(adapterId)
            val output = runLocalCliAndCaptureStdout(commandParts, adapterDir, timeoutSeconds = 60)
                ?: return ""
            val jsonLine = output.lines().find { it.startsWith("__GEMINI_USAGE_JSON__") }
            if (jsonLine != null) jsonLine.substring("__GEMINI_USAGE_JSON__".length).trim() else extractJsonPayload(output)
        } catch (_: Exception) { "" }
    }

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
        val cli = adapterInfo.cli ?: return ""
        val target = AcpAdapterPaths.getExecutionTarget()
        val adapterRoot = AcpAdapterPaths.getDownloadPath(adapterId)
        if (!AcpAdapterPaths.isDownloaded(adapterId)) return ""

        val executable = platformBinaryForTarget(cli.executable, target)?.takeIf { it.isNotBlank() } ?: return ""

        val commandParts = mutableListOf(resolveCliPath(adapterRoot, executable, target))
        cli.entryPath?.takeIf { it.isNotBlank() }?.let { commandParts += resolveCliPath(adapterRoot, it, target) }
        commandParts += "--usage-json"

        return try {
            val stdout = runLocalCliAndCaptureStdout(commandParts, adapterRoot, timeoutSeconds = LOCAL_USAGE_TIMEOUT_SECONDS)
                ?: return ""
            extractJsonPayload(stdout)
        } catch (_: Exception) { "" }
    }

    private fun extractJsonPayload(raw: String): String {
        val trimmed = raw.trim()
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed

        val firstBrace = trimmed.indexOf('{')
        val lastBrace = trimmed.lastIndexOf('}')
        if (firstBrace == -1 || lastBrace == -1 || lastBrace <= firstBrace) return ""
        return trimmed.substring(firstBrace, lastBrace + 1).trim()
    }

    private fun buildLocalCliCommandLine(commandParts: List<String>): com.intellij.execution.configurations.GeneralCommandLine {
        val executable = commandParts.firstOrNull() ?: return com.intellij.execution.configurations.GeneralCommandLine()
        val args = commandParts.drop(1)
        val isWindows = System.getProperty("os.name").lowercase().contains("win")
        val (exe, allArgs) = if (isWindows && executable.lowercase().endsWith(".cmd")) {
            "cmd.exe" to (listOf("/c", executable) + args)
        } else {
            executable to args
        }
        return com.intellij.execution.configurations.GeneralCommandLine(exe)
            .withParameters(allArgs)
            .withEnvironment(System.getenv())
            .withParentEnvironmentType(com.intellij.execution.configurations.GeneralCommandLine.ParentEnvironmentType.CONSOLE)
    }

    private fun runLocalCliAndCaptureStdout(
        commandParts: List<String>,
        workingDir: String,
        timeoutSeconds: Long
    ): String? {
        val process = buildLocalCliCommandLine(commandParts)
            .withWorkDirectory(workingDir)
            .createProcess()
        val stdout = StringBuilder()
        val outThread = Thread {
            runCatching {
                process.inputStream.bufferedReader().useLines { lines ->
                    lines.forEach { stdout.appendLine(it) }
                }
            }
        }.apply { isDaemon = true; start() }
        val errThread = Thread {
            runCatching {
                process.errorStream.bufferedReader().useLines { lines ->
                    lines.forEach { }
                }
            }
        }.apply { isDaemon = true; start() }

        val finished = process.waitFor(timeoutSeconds, TimeUnit.SECONDS)
        if (!finished) {
            process.destroyForcibly()
            outThread.join(1000)
            errThread.join(1000)
            return null
        }

        outThread.join(1000)
        errThread.join(1000)
        return stdout.toString()
    }

    private fun readTargetFile(rawPath: String): String? {
        val resolved = rawPath.replace("~", System.getProperty("user.home"))
        val file = File(resolved)
        return if (!file.exists()) null else file.readText()
    }
}
