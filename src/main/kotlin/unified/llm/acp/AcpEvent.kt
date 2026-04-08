package unified.llm.acp

import com.agentclientprotocol.protocol.JsonRpcException
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

sealed class AcpEvent {
    data class PromptDone(val stopReason: String) : AcpEvent()
    data class Error(val message: String) : AcpEvent()
}

fun formatAcpError(e: Throwable): String {
    if (e is JsonRpcException) {
        val data = e.data
        if (data != null) {
            try {
                val dataObj = data.jsonObject
                val detailedMessage = dataObj["message"]?.jsonPrimitive?.content
                if (!detailedMessage.isNullOrBlank()) {
                    return detailedMessage
                }
            } catch (_: Exception) {
            }
        }
    }
    return e.message ?: e.toString()
}
