package agentdock.acp

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class AcpRuntimeMetadataTest {
    @Test
    fun `runtime metadata reads model and mode from session config options json`() {
        val response = Json.parseToJsonElement(
            """
            {
              "sessionId": "session-1",
              "configOptions": [
                {
                  "id": "model",
                  "name": "Model",
                  "category": "model",
                  "type": "select",
                  "currentValue": "gpt-5.5",
                  "options": [
                    { "value": "gpt-5.5", "name": "GPT-5.5", "description": "Frontier model" },
                    { "value": "gpt-5.4", "name": "GPT-5.4", "description": "Everyday model" }
                  ]
                },
                {
                  "id": "mode",
                  "name": "Session Mode",
                  "category": "mode",
                  "type": "select",
                  "currentValue": "build",
                  "options": [
                    { "value": "build", "name": "Build", "description": "Can use tools" },
                    { "value": "plan", "name": "Plan", "description": "Planning only" }
                  ]
                },
                {
                  "id": "reasoning_effort",
                  "name": "Reasoning Effort",
                  "category": "thought_level",
                  "type": "select",
                  "currentValue": "medium",
                  "options": [
                    { "value": "low", "name": "Low", "description": "Fast responses" },
                    { "value": "medium", "name": "Medium", "description": "Balanced" },
                    { "value": "high", "name": "High", "description": "Deeper reasoning" }
                  ]
                },
                {
                  "id": "verbosity",
                  "name": "Verbosity",
                  "type": "select",
                  "currentValue": "brief",
                  "options": [
                    { "value": "brief", "name": "Brief" },
                    { "value": "detailed", "name": "Detailed" }
                  ]
                },
                {
                  "id": "use_tools",
                  "name": "Use tools",
                  "type": "boolean",
                  "currentValue": true
                }
              ]
            }
            """.trimIndent()
        ).jsonObject

        val metadata = runtimeMetadataFromSessionResponseJson(response, adapterInfo(disabledModels = listOf("5.4")))

        assertEquals("model", metadata.modelConfigId)
        assertEquals("gpt-5.5", metadata.currentModelId)
        assertEquals(listOf("gpt-5.5"), metadata.availableModels.map { it.modelId })
        assertEquals("mode", metadata.modeConfigId)
        assertEquals("build", metadata.currentModeId)
        assertEquals(listOf("build", "plan"), metadata.availableModes.map { it.id })
        assertEquals("reasoning_effort", metadata.reasoningEffortConfigId)
        assertEquals("medium", metadata.currentReasoningEffortId)
        assertEquals(listOf("low", "medium", "high"), metadata.availableReasoningEfforts.map { it.id })
        assertEquals("brief", metadata.configOptions.first { it.id == "verbosity" }.currentValue)
        assertEquals("true", metadata.configOptions.first { it.id == "use_tools" }.currentValue)
    }

    @Test
    fun `runtime metadata ignores legacy models and modes json`() {
        val response = Json.parseToJsonElement(
            """
            {
              "sessionId": "session-1",
              "models": {
                "currentModelId": "legacy-a",
                "availableModels": [
                  { "modelId": "legacy-a", "name": "Legacy A" },
                  { "modelId": "legacy-b", "name": "Legacy B" }
                ]
              },
              "modes": {
                "currentModeId": "code",
                "availableModes": [
                  { "id": "code", "name": "Code" },
                  { "id": "plan", "name": "Plan" }
                ]
              }
            }
            """.trimIndent()
        ).jsonObject

        val metadata = runtimeMetadataFromSessionResponseJson(response, adapterInfo())

        assertEquals(null, metadata.modelConfigId)
        assertEquals(null, metadata.currentModelId)
        assertEquals(emptyList(), metadata.availableModels)
        assertEquals(null, metadata.modeConfigId)
        assertEquals(null, metadata.currentModeId)
        assertEquals(emptyList(), metadata.availableModes)
        assertEquals(null, metadata.reasoningEffortConfigId)
        assertEquals(null, metadata.currentReasoningEffortId)
        assertEquals(emptyList(), metadata.availableReasoningEfforts)
    }

    @Test
    fun `runtime metadata picks up reasoning effort from dynamic config option response`() {
        val initialResponse = Json.parseToJsonElement(
            """
            {
              "sessionId": "session-1",
              "configOptions": [
                {
                  "id": "model",
                  "category": "model",
                  "type": "select",
                  "currentValue": "opencode/big-pickle",
                  "options": [
                    { "value": "opencode/big-pickle", "name": "OpenCode Zen/Big Pickle" },
                    { "value": "openai/gpt-5.4", "name": "OpenAI/GPT-5.4" }
                  ]
                },
                {
                  "id": "mode",
                  "category": "mode",
                  "type": "select",
                  "currentValue": "build",
                  "options": [
                    { "value": "build", "name": "build" },
                    { "value": "plan", "name": "plan" }
                  ]
                }
              ]
            }
            """.trimIndent()
        ).jsonObject
        val modelChangeResponse = Json.parseToJsonElement(
            """
            {
              "configOptions": [
                {
                  "id": "model",
                  "category": "model",
                  "type": "select",
                  "currentValue": "openai/gpt-5.4",
                  "options": [
                    { "value": "opencode/big-pickle", "name": "OpenCode Zen/Big Pickle" },
                    { "value": "openai/gpt-5.4", "name": "OpenAI/GPT-5.4" }
                  ]
                },
                {
                  "id": "mode",
                  "category": "mode",
                  "type": "select",
                  "currentValue": "build",
                  "options": [
                    { "value": "build", "name": "build" },
                    { "value": "plan", "name": "plan" }
                  ]
                },
                {
                  "id": "reasoning_effort",
                  "category": "thought_level",
                  "type": "select",
                  "currentValue": "low",
                  "options": [
                    { "value": "none", "name": "None" },
                    { "value": "low", "name": "Low" },
                    { "value": "medium", "name": "Medium" },
                    { "value": "high", "name": "High" },
                    { "value": "xhigh", "name": "Xhigh" }
                  ]
                }
              ]
            }
            """.trimIndent()
        ).jsonObject

        val initialMetadata = runtimeMetadataFromSessionResponseJson(initialResponse, adapterInfo())
        val changedMetadata = runtimeMetadataFromConfigOptionsJson(modelChangeResponse["configOptions"], adapterInfo())

        assertEquals(emptyList(), initialMetadata.availableReasoningEfforts)
        assertEquals("openai/gpt-5.4", changedMetadata.currentModelId)
        assertEquals("reasoning_effort", changedMetadata.reasoningEffortConfigId)
        assertEquals("low", changedMetadata.currentReasoningEffortId)
        assertEquals(listOf("none", "low", "medium", "high", "xhigh"), changedMetadata.availableReasoningEfforts.map { it.id })
    }

    @Test
    fun `runtime metadata does not invent reasoning effort when config option is absent`() {
        val response = Json.parseToJsonElement(
            """
            {
              "sessionId": "session-1",
              "configOptions": [
                {
                  "id": "model",
                  "category": "model",
                  "type": "select",
                  "currentValue": "opencode/deepseek-v4-flash-free",
                  "options": [
                    { "value": "opencode/deepseek-v4-flash-free", "name": "OpenCode/DeepSeek V4 Flash Free" }
                  ]
                }
              ]
            }
            """.trimIndent()
        ).jsonObject

        val metadata = runtimeMetadataFromSessionResponseJson(response, adapterInfo())

        assertEquals(null, metadata.reasoningEffortConfigId)
        assertEquals(emptyList(), metadata.availableReasoningEfforts)
    }

    @Test
    fun `runtime metadata clears current model when every model is disabled`() {
        val response = Json.parseToJsonElement(
            """
            {
              "configOptions": [
                {
                  "id": "model",
                  "category": "model",
                  "type": "select",
                  "currentValue": "disabled-model",
                  "options": [
                    { "value": "disabled-model", "name": "Disabled model" }
                  ]
                }
              ]
            }
            """.trimIndent()
        ).jsonObject

        val metadata = runtimeMetadataFromSessionResponseJson(
            response,
            adapterInfo(disabledModels = listOf("disabled-model"))
        )

        assertEquals(null, metadata.currentModelId)
        assertEquals(emptyList(), metadata.availableModels)
    }

    @Test
    fun `runtime metadata uses config option reasoning effort`() {
        val response = Json.parseToJsonElement(
            """
            {
              "sessionId": "session-1",
              "configOptions": [
                {
                  "id": "model",
                  "category": "model",
                  "type": "select",
                  "currentValue": "openai/gpt-5.4",
                  "options": [
                    { "value": "openai/gpt-5.4", "name": "OpenAI/GPT-5.4" }
                  ]
                },
                {
                  "id": "reasoning_effort",
                  "category": "thought_level",
                  "type": "select",
                  "currentValue": "medium",
                  "options": [
                    { "value": "medium", "name": "Medium" }
                  ]
                }
              ]
            }
            """.trimIndent()
        ).jsonObject

        val metadata = runtimeMetadataFromSessionResponseJson(response, adapterInfo())

        assertEquals("medium", metadata.currentReasoningEffortId)
        assertEquals(listOf("medium"), metadata.availableReasoningEfforts.map { it.id })
    }

    @Test
    fun `config option update extractor returns session id and config options`() {
        val params = Json.parseToJsonElement(
            """
            {
              "sessionId": "session-2",
              "update": {
                "sessionUpdate": "config_option_update",
                "configOptions": [
                  {
                    "id": "reasoning_effort",
                    "category": "thought_level",
                    "type": "select",
                    "currentValue": "high",
                    "options": [
                      { "value": "medium", "name": "Medium" },
                      { "value": "high", "name": "High" }
                    ]
                  }
                ]
              }
            }
            """.trimIndent()
        )

        val (sessionId, configOptions) = extractConfigOptionsUpdate(params)!!

        assertEquals("session-2", sessionId)
        assertEquals("session-2", extractSessionUpdateSessionId(params))
        val metadata = runtimeMetadataFromConfigOptionsJson(configOptions, adapterInfo())
        assertEquals("reasoning_effort", metadata.reasoningEffortConfigId)
        assertEquals("high", metadata.currentReasoningEffortId)
    }

    @Test
    fun `fresh snapshot replaces adapter options and preserves untouched model effort catalog`() {
        val existing = CachedAdapterConfigOptions(
            adapterId = "codex",
            adapterVersion = "1.0.0",
            refreshedAtMillis = 100L,
            configOptions = listOf(
                AcpConfigOption(
                    "reasoning_effort", "Reasoning", category = "thought_level", type = "select",
                    currentValue = "high",
                    options = listOf(AcpConfigOptionValue("high", "High"))
                )
            ),
            reasoningEffortsByModel = mapOf(
                "model-a" to listOf(AcpConfigOptionValue("high", "High", null)),
                "model-b" to listOf(AcpConfigOptionValue("low", "Low", null))
            )
        )
        val fresh = AcpClientService.AdapterRuntimeMetadata(
            configOptions = listOf(
                AcpConfigOption(
                    "model", "Model", category = "model", type = "select", currentValue = "model-a",
                    options = listOf(
                        AcpConfigOptionValue("model-a", "Model A", null),
                        AcpConfigOptionValue("model-b", "Model B", null)
                    )
                ),
                AcpConfigOption(
                    "mode", "Mode", category = "mode", type = "select", currentValue = "new-mode",
                    options = listOf(AcpConfigOptionValue("new-mode", "New mode", null))
                )
            )
        )

        val updated = existing.updatedWithSnapshot(adapterInfo(), "1.0.0", fresh)

        assertEquals(100L, updated.refreshedAtMillis)
        assertEquals(emptyList(), updated.reasoningEffortsByModel["model-a"])
        assertEquals(listOf("low"), updated.reasoningEffortsByModel["model-b"]?.map { it.value })
        assertEquals("reasoning_effort", updated.configOptions.first { it.isReasoning() }.id)
        val runtime = updated.toRuntimeMetadata(adapterInfo())
        assertEquals("new-mode", runtime.currentModeId)
        assertEquals(null, runtime.currentReasoningEffortId)
    }

    @Test
    fun `cache preserves mode and effort options when adapter has no model selector`() {
        val metadata = AcpClientService.AdapterRuntimeMetadata(
            configOptions = listOf(
                AcpConfigOption(
                    "mode", "Mode", category = "mode", type = "select", currentValue = "build",
                    options = listOf(AcpConfigOptionValue("build", "Build", null))
                ),
                AcpConfigOption(
                    "reasoning_effort", "Reasoning", category = "thought_level", type = "select",
                    currentValue = "medium",
                    options = listOf(AcpConfigOptionValue("medium", "Medium", null))
                ),
                AcpConfigOption(
                    "verbosity", "Verbosity", type = "select", currentValue = "brief",
                    options = listOf(AcpConfigOptionValue("brief", "Brief", null))
                )
            )
        )

        val existing: CachedAdapterConfigOptions? = null
        val cached = existing.updatedWithSnapshot(adapterInfo(), "1.0.0", metadata, refreshedAtMillis = 100L)
        val restored = cached.toRuntimeMetadata(adapterInfo())

        assertEquals("build", restored.currentModeId)
        assertEquals(listOf("build"), restored.availableModes.map { it.id })
        assertEquals("medium", restored.currentReasoningEffortId)
        assertEquals(listOf("medium"), restored.availableReasoningEfforts.map { it.id })
        assertEquals("brief", restored.configOptions.first { it.id == "verbosity" }.currentValue)
    }

    @Test
    fun `set config option response requires complete config options state`() {
        val response = Json.parseToJsonElement("{}").jsonObject

        assertFailsWith<IllegalStateException> {
            runtimeMetadataFromSetConfigOptionResponseJson(response, adapterInfo())
        }
    }

    private fun adapterInfo(
        disabledModels: List<String> = emptyList(),
        disabledModes: List<String> = emptyList()
    ): AcpAdapterConfig.AdapterInfo {
        return AcpAdapterConfig.AdapterInfo(
            id = "codex",
            name = "Codex",
            distribution = AcpAdapterConfig.Distribution(
                type = AcpAdapterConfig.DistributionType.NPM,
                version = "latest",
                packageName = "codex"
            ),
            disabledModels = disabledModels,
            disabledModes = disabledModes
        )
    }
}
