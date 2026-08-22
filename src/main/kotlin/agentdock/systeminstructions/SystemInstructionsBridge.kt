package agentdock.systeminstructions

import agentdock.bridge.BridgeHost
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import agentdock.utils.jsStringLiteral

private val json = Json { ignoreUnknownKeys = true }

class SystemInstructionsBridge(
    private val host: BridgeHost,
    private val scope: CoroutineScope
) {
    fun install() {
        host.register("loadSystemInstructions") {
            scope.launch(Dispatchers.IO) {
                push(SystemInstructionsStore.load())
            }
        }

        host.register("saveSystemInstructions") { payload ->
            if (payload.isNotBlank()) {
                scope.launch(Dispatchers.IO) {
                    runCatching {
                        val instructions = json.decodeFromString(ListSerializer(SystemInstruction.serializer()), payload)
                        SystemInstructionsStore.save(instructions)
                        push(instructions)
                    }
                }
            }
        }
    }

    private fun push(instructions: List<SystemInstruction>) {
        val payload = Json.encodeToString(ListSerializer(SystemInstruction.serializer()), instructions).jsStringLiteral()
        host.eval("if(window.__onSystemInstructions) window.__onSystemInstructions(JSON.parse($payload));")
    }
}
