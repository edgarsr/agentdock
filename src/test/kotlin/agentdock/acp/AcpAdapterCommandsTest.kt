package agentdock.acp

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AcpAdapterCommandsTest {

    private fun command(name: String, description: String = "", inputHint: String? = null) =
        AvailableCommandPayload(name = name, description = description, inputHint = inputHint)

    @Test
    fun `merge keeps declared commands first and appends runtime commands`() {
        val merged = mergeAvailableCommands(
            declared = listOf(command("compact", "Summarize")),
            runtime = listOf(command("review", "Review code"))
        )

        assertEquals(listOf("compact", "review"), merged.map { it.name })
    }

    @Test
    fun `merge lets runtime commands win name conflicts case-insensitively`() {
        val merged = mergeAvailableCommands(
            declared = listOf(command("compact", "Declared description")),
            runtime = listOf(command("Compact", "Runtime description"))
        )

        assertEquals(1, merged.size)
        assertEquals("Runtime description", merged.single().description)
    }

    @Test
    fun `merge returns runtime when nothing is declared and declared when runtime is empty`() {
        val runtime = listOf(command("review"))
        assertEquals(runtime, mergeAvailableCommands(emptyList(), runtime))

        val declared = listOf(command("compact"))
        assertEquals(declared, mergeAvailableCommands(declared, emptyList()))

        assertTrue(mergeAvailableCommands(emptyList(), emptyList()).isEmpty())
    }

    @Test
    fun `custom acp config decodes commands and defaults to empty`() {
        val json = Json { ignoreUnknownKeys = true }

        val withCommands = json.decodeFromString<CustomAcpConfig>(
            """
            {
              "id": "custom-acp-test",
              "name": "OpenCode",
              "command": "docker",
              "commands": [
                { "name": "/compact", "description": "Summarize" }
              ]
            }
            """.trimIndent()
        )
        assertEquals(listOf(CustomAcpCommandConfig("/compact", "Summarize")), withCommands.commands)

        val withoutCommands = json.decodeFromString<CustomAcpConfig>(
            """{"id":"custom-acp-test","name":"OpenCode","command":"docker"}"""
        )
        assertTrue(withoutCommands.commands.isEmpty())
    }

    @Test
    fun `normalize strips slashes, trims and dedupes commands case-insensitively`() {
        val normalized = CustomAcpConfigStore.normalize(
            listOf(
                CustomAcpConfig(
                    id = "custom-acp-test",
                    name = "OpenCode",
                    command = "docker",
                    commands = listOf(
                        CustomAcpCommandConfig(" /compact ", "Summarize"),
                        CustomAcpCommandConfig("compact", "Duplicate"),
                        CustomAcpCommandConfig("Compact", "Duplicate again"),
                        CustomAcpCommandConfig("  ", "Blank name")
                    )
                )
            )
        ).single()

        assertEquals(
            listOf(CustomAcpCommandConfig("compact", "Summarize")),
            normalized.commands
        )
    }

    @Test
    fun `toAdapterInfo maps declared commands onto adapter info`() {
        val adapterInfo = CustomAcpConfigStore.toAdapterInfo(
            CustomAcpConfig(
                id = "custom-acp-test",
                name = "OpenCode",
                command = "docker",
                commands = listOf(CustomAcpCommandConfig("compact", "Summarize the conversation"))
            )
        )

        assertEquals(
            listOf(AcpAdapterConfig.AdapterCommand("compact", "Summarize the conversation")),
            adapterInfo.commands
        )
    }
}
