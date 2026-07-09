package agentdock.acp

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals

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
    }

    @Test
    fun `runtime metadata falls back to legacy models and modes json`() {
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

        val metadata = runtimeMetadataFromSessionResponseJson(response, adapterInfo(disabledModes = listOf("plan")))

        assertEquals(null, metadata.modelConfigId)
        assertEquals("legacy-a", metadata.currentModelId)
        assertEquals(listOf("legacy-a", "legacy-b"), metadata.availableModels.map { it.modelId })
        assertEquals(null, metadata.modeConfigId)
        assertEquals("code", metadata.currentModeId)
        assertEquals(listOf("code"), metadata.availableModes.map { it.id })
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
