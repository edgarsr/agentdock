package agentdock.mcp

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI
import java.nio.charset.StandardCharsets
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * Checks whether a configured MCP server is reachable.
 *
 * For stdio servers, the configured command is started and an MCP initialize
 * request is sent over stdin. A matching JSON-RPC response confirms that the
 * process is running and speaking MCP.
 *
 * For HTTP and SSE servers, only a TCP connection to the configured host and
 * port is attempted. This confirms that something is listening, but does not
 * verify the HTTP endpoint or the MCP protocol.
 */
object McpStatusChecker {

    private const val INITIALIZE_REQUEST_ID = 1
    private const val STDIO_TIMEOUT_MS = 8_000L
    private const val HTTP_CONNECT_TIMEOUT_MS = 5_000

    private val json = Json {
        ignoreUnknownKeys = true
    }

    private val initializeRequest = buildJsonObject {
        put("jsonrpc", "2.0")
        put("id", INITIALIZE_REQUEST_ID)
        put("method", "initialize")
        putJsonObject("params") {
            put("protocolVersion", "2025-11-25")
            putJsonObject("capabilities") {}
            putJsonObject("clientInfo") {
                put("name", "agentdock-healthcheck")
                put("version", "1.0")
            }
        }
    }.toString()

    suspend fun check(server: McpServerConfig): McpStatusUpdate {
        if (!server.enabled) {
            return status(server, McpStatus.DISABLED, "Disabled")
        }

        return when (server.transport.lowercase()) {
            "stdio" -> checkStdio(server)
            "http", "sse" -> checkReachable(server)
            else -> status(
                server,
                McpStatus.ERROR,
                "Unknown transport: ${server.transport}"
            )
        }
    }

    private suspend fun checkStdio(
        server: McpServerConfig
    ): McpStatusUpdate = withContext(Dispatchers.IO) {
        val command = server.command
            ?.trim()
            ?.takeIf(String::isNotEmpty)
            ?: return@withContext status(
                server,
                McpStatus.ERROR,
                "No command configured"
            )

        val process = try {
            ProcessBuilder(listOf(command) + server.args.orEmpty())
                /*
                 * Drain stderr together with stdout so a noisy process cannot block
                 * after filling its stderr pipe. Non-JSON log lines are ignored.
                 */
                .redirectErrorStream(true)
                .apply {
                    server.env.orEmpty()
                        .filter { it.name.isNotBlank() }
                        .forEach { environment()[it.name] = it.value }
                }
                .start()
        } catch (e: IOException) {
            return@withContext status(
                server,
                McpStatus.ERROR,
                "Failed to start process: ${exceptionMessage(e)}"
            )
        }

        val readerExecutor = Executors.newSingleThreadExecutor { runnable ->
            Thread(runnable, "mcp-status-${server.id}").apply {
                isDaemon = true
            }
        }

        val stdin = process.outputStream.bufferedWriter(StandardCharsets.UTF_8)

        try {
            val responseFuture = readerExecutor.submit<InitializeResponse> {
                readInitializeResponse(process)
            }

            try {
                stdin.write(initializeRequest)
                stdin.newLine()
                stdin.flush()
            } catch (e: IOException) {
                return@withContext status(
                    server,
                    McpStatus.ERROR,
                    "Failed to write initialize request: ${exceptionMessage(e)}"
                )
            }

            val response = try {
                responseFuture.get(STDIO_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            } catch (_: TimeoutException) {
                return@withContext status(
                    server,
                    McpStatus.ERROR,
                    "No initialize response within ${STDIO_TIMEOUT_MS / 1_000}s"
                )
            } catch (e: ExecutionException) {
                return@withContext status(
                    server,
                    McpStatus.ERROR,
                    "Failed to read initialize response: " +
                            exceptionMessage(e.cause ?: e)
                )
            }

            status(
                server,
                if (response.success) McpStatus.CONNECTED else McpStatus.ERROR,
                response.detail
            )
        } finally {
            runCatching { stdin.close() }

            if (process.isAlive) {
                process.destroy()

                if (!process.waitFor(250, TimeUnit.MILLISECONDS)) {
                    process.destroyForcibly()
                    process.waitFor(1, TimeUnit.SECONDS)
                }
            }

            readerExecutor.shutdownNow()
        }
    }

    private fun readInitializeResponse(process: Process): InitializeResponse {
        var lastOutput: String? = null

        process.inputStream
            .bufferedReader(StandardCharsets.UTF_8)
            .useLines { lines ->
                for (line in lines) {
                    val trimmed = line.trim()
                    if (trimmed.isEmpty()) {
                        continue
                    }

                    lastOutput = trimmed

                    val response = parseInitializeResponse(trimmed)
                    if (response != null) {
                        return response
                    }
                }
            }

        return InitializeResponse(
            success = false,
            detail = lastOutput
                ?.takeLast(500)
                ?: "Process exited without an initialize response"
        )
    }

    private fun parseInitializeResponse(line: String): InitializeResponse? {
        val message = runCatching {
            json.parseToJsonElement(line).jsonObject
        }.getOrNull() ?: return null

        if (message["id"]?.jsonPrimitive?.intOrNull != INITIALIZE_REQUEST_ID) {
            return null
        }

        val error = message["error"] as? JsonObject
        if (error != null) {
            val errorMessage = error["message"]
                ?.jsonPrimitive
                ?.contentOrNull
                ?: "Initialize request failed"

            return InitializeResponse(
                success = false,
                detail = errorMessage
            )
        }

        if (message["result"] != null) {
            return InitializeResponse(
                success = true,
                detail = "Initialized"
            )
        }

        return InitializeResponse(
            success = false,
            detail = "Invalid initialize response"
        )
    }

    private suspend fun checkReachable(
        server: McpServerConfig
    ): McpStatusUpdate = withContext(Dispatchers.IO) {
        val rawUrl = server.url
            ?.trim()
            ?.takeIf(String::isNotEmpty)
            ?: return@withContext status(
                server,
                McpStatus.ERROR,
                "No URL configured"
            )

        val uri = runCatching { URI.create(rawUrl) }.getOrNull()
        val host = uri?.host

        if (uri == null || host.isNullOrBlank()) {
            return@withContext status(
                server,
                McpStatus.ERROR,
                "Invalid URL: $rawUrl"
            )
        }

        val port = when {
            uri.port > 0 -> uri.port
            uri.scheme.equals("https", ignoreCase = true) -> 443
            uri.scheme.equals("http", ignoreCase = true) -> 80
            else -> return@withContext status(
                server,
                McpStatus.ERROR,
                "Could not determine port for: $rawUrl"
            )
        }

        try {
            Socket().use {
                it.connect(
                    InetSocketAddress(host, port),
                    HTTP_CONNECT_TIMEOUT_MS
                )
            }

            status(
                server,
                McpStatus.CONNECTED,
                "Port reachable"
            )
        } catch (e: IOException) {
            status(
                server,
                McpStatus.ERROR,
                "${e.javaClass.simpleName}: ${exceptionMessage(e)}"
            )
        }
    }

    private fun status(
        server: McpServerConfig,
        status: McpStatus,
        detail: String
    ) = McpStatusUpdate(server.id, status, detail)

    private fun exceptionMessage(error: Throwable): String =
        error.message ?: error.javaClass.simpleName

    private data class InitializeResponse(
        val success: Boolean,
        val detail: String
    )
}