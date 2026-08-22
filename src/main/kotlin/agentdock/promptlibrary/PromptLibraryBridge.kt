package agentdock.promptlibrary

import agentdock.bridge.BridgeHost
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import agentdock.utils.jsStringLiteral

private val json = Json { ignoreUnknownKeys = true }

class PromptLibraryBridge(
    private val host: BridgeHost,
    private val scope: CoroutineScope
) {
    fun install() {
        host.register("loadPromptLibrary") {
            scope.launch(Dispatchers.IO) {
                push(PromptLibraryStore.load())
            }
        }

        host.register("savePromptLibrary") { payload ->
            if (payload.isNotBlank()) {
                scope.launch(Dispatchers.IO) {
                    runCatching {
                        val prompts = json.decodeFromString(ListSerializer(PromptLibraryItem.serializer()), payload)
                        PromptLibraryStore.save(prompts)
                        push(prompts)
                    }
                }
            }
        }
    }

    private fun push(prompts: List<PromptLibraryItem>) {
        val payload = Json.encodeToString(ListSerializer(PromptLibraryItem.serializer()), prompts).jsStringLiteral()
        host.eval("if(window.__onPromptLibrary) window.__onPromptLibrary(JSON.parse($payload));")
    }
}
