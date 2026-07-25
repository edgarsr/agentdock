package agentdock.acp

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.io.BufferedInputStream
import java.nio.charset.StandardCharsets
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

internal object AcpCopilotAuthenticationRpc {
    private const val STATUS_TIMEOUT_SECONDS = 10L
    private const val LOGOUT_TIMEOUT_SECONDS = 15L

    fun fetchLoginStatus(adapterId: String): Boolean? =
        withRpc(adapterId, STATUS_TIMEOUT_SECONDS) { rpc ->
            val result = rpc.request("account.getCurrentAuth", null) ?: return@withRpc null
            result["authInfo"] is JsonObject
        }

    fun logout(adapterId: String) {
        val succeeded = withRpc(adapterId, LOGOUT_TIMEOUT_SECONDS) { rpc ->
            val currentAuth = rpc.request("account.getCurrentAuth", null) ?: return@withRpc false
            val authInfo = currentAuth["authInfo"] as? JsonObject ?: return@withRpc true
            rpc.request(
                method = "account.logout",
                params = buildJsonObject {
                    put("authInfo", authInfo)
                }
            ) != null
        } == true
        if (!succeeded) throw IllegalStateException("Copilot logout failed")
    }

    private fun <T> withRpc(
        adapterId: String,
        timeoutSeconds: Long,
        action: (RpcSession) -> T
    ): T? {
        val adapterInfo = runCatching { AcpAdapterConfig.getAdapterInfo(adapterId) }.getOrNull() ?: return null
        val target = AcpAdapterPaths.getExecutionTarget()
        val adapterRoot = AcpAdapterPaths.getDownloadPath(adapterId)
        if (!AcpAdapterPaths.isDownloaded(adapterId)) return null
        val launchPath = AcpAdapterPaths.resolveLaunchPath(adapterRoot, adapterInfo, target) ?: return null
        val runtime = AcpNodeRuntimeResolver.resolveAvailable() ?: return null

        val commandLine = com.intellij.execution.configurations.GeneralCommandLine(runtime.node)
            .withParameters(launchPath, "--server", "--stdio", "--log-level", "none")
            .withEnvironment(AcpProcessEnvironment.baseEnvironment())
            .withParentEnvironmentType(
                com.intellij.execution.configurations.GeneralCommandLine.ParentEnvironmentType.CONSOLE
            )
            .let { AcpNodeRuntimeResolver.applyTo(it, runtime) }
            .withWorkDirectory(adapterRoot)
        val process = runCatching { commandLine.createProcess() }.getOrNull() ?: return null
        val responses = LinkedBlockingQueue<JsonObject>()
        val reader = Thread {
            runCatching {
                val input = BufferedInputStream(process.inputStream)
                while (true) {
                    readMessage(input)?.let(responses::offer) ?: break
                }
            }
        }.apply {
            isDaemon = true
            start()
        }
        val errorReader = Thread {
            runCatching {
                process.errorStream.bufferedReader().useLines { lines -> lines.forEach { } }
            }
        }.apply {
            isDaemon = true
            start()
        }

        return try {
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(timeoutSeconds)
            val rpc = RpcSession(process, responses, deadline)
            rpc.request("connect") ?: return null
            action(rpc)
        } catch (_: Exception) {
            null
        } finally {
            process.destroy()
            if (!process.waitFor(2, TimeUnit.SECONDS)) process.destroyForcibly()
            reader.join(1_000)
            errorReader.join(1_000)
        }
    }

    private class RpcSession(
        private val process: Process,
        private val responses: LinkedBlockingQueue<JsonObject>,
        private val deadline: Long
    ) {
        private var nextId = 1

        fun request(
            method: String,
            params: JsonObject? = buildJsonObject {}
        ): JsonObject? {
            val id = nextId++
            AcpCopilotAuthenticationRpc.sendRequest(process, id, method, params)
            return AcpCopilotAuthenticationRpc.awaitResult(responses, id, deadline)
        }
    }

    private fun sendRequest(
        process: Process,
        id: Int,
        method: String,
        params: JsonObject?
    ) {
        val content = buildJsonObject {
            put("jsonrpc", "2.0")
            put("id", id)
            put("method", method)
            if (params != null) put("params", params)
        }.toString().toByteArray(StandardCharsets.UTF_8)
        val header = "Content-Length: ${content.size}\r\n\r\n".toByteArray(StandardCharsets.UTF_8)
        process.outputStream.write(header)
        process.outputStream.write(content)
        process.outputStream.flush()
    }

    private fun awaitResult(
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

    private fun readMessage(input: BufferedInputStream): JsonObject? {
        var contentLength: Int? = null
        while (true) {
            val line = readHeaderLine(input) ?: return null
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

    private fun readHeaderLine(input: BufferedInputStream): String? {
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
}
