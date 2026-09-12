package agentdock.acp

import com.agentclientprotocol.protocol.JsonRpcException
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive

sealed class AcpEvent {
    data class PromptDone(val stopReason: String) : AcpEvent()
    data class Error(val message: String) : AcpEvent()
}

fun formatAcpError(e: Throwable): String {
    val message = e.message ?: e.toString()
    val data = (e as? JsonRpcException)?.data
    if (data == null || data == JsonNull) return message
    val details = if (data is JsonPrimitive) data.content else data.toString()
    return if (details.isBlank() || details == message) message else "$message\n$details"
}
