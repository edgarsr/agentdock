package agentdock.history

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import java.io.File
import java.nio.file.Files

class HistoryStorageTest {
    @Test
    fun `safe conversation ids remain valid filename tokens`() {
        assertEquals("conv-1-1712345678901", HistoryStorage.requireSafeConversationId("conv-1-1712345678901"))
        assertEquals("conv_0123456789abcdef", HistoryStorage.requireSafeConversationId("conv_0123456789abcdef"))
        assertEquals(
            "3f8d8c9e-cc1f-49c1-bb42-9d9d1a5ad842",
            HistoryStorage.requireSafeConversationId("3f8d8c9e-cc1f-49c1-bb42-9d9d1a5ad842")
        )
    }

    @Test
    fun `conversation ids cannot contain path traversal or separators`() {
        listOf(
            "",
            ".",
            "..",
            "../outside",
            "..\\outside",
            "nested/conversation",
            "nested\\conversation",
            "C:\\temp\\conversation",
            "/tmp/conversation"
        ).forEach { value ->
            assertFailsWith<IllegalArgumentException>(value) {
                HistoryStorage.requireSafeConversationId(value)
            }
        }
    }

    @Test
    fun `invalid conversation ids are rejected before replay files are saved`() {
        withIsolatedHistoryStorage("agent-dock-history-invalid") { projectDir ->
            val saved = AgentDockHistoryService.saveConversationReplay(
                projectPath = projectDir.absolutePath,
                conversationId = "../outside",
                data = ConversationReplayData()
            )

            assertFalse(saved)
            assertFalse(projectDir.parentFile.resolve("outside.json").exists())
        }
    }

    @Test
    fun `agentdock project slug keeps existing Windows separator shape`() {
        assertEquals(
            "C--www-jetbrains-unified-llm-plugin",
            HistoryStorage.agentDockProjectSlug("C:\\www\\jetbrains\\unified_llm_plugin")
        )
    }

    @Test
    fun `agentdock project slug does not start with dash for unix absolute paths`() {
        assertEquals(
            "home-vboxuser-WebstormProjects-untitled",
            HistoryStorage.agentDockProjectSlug("/home/vboxuser/WebstormProjects/untitled")
        )
    }

    @Test
    fun `runtime metadata stores used adapters as latest-last distinct list`() {
        withIsolatedHistoryStorage("agent-dock-history-used-adapters") { projectDir ->
            val projectPath = projectDir.absolutePath

            AgentDockHistoryService.upsertRuntimeSessionMetadata(
                projectPath = projectPath,
                conversationId = "conv-used-adapters",
                sessionId = "session-1",
                adapterName = "beta",
                promptCount = 1,
                titleCandidate = "First prompt",
                inheritedAdapterNames = listOf("claude", "beta", "claude"),
                touchUpdatedAt = true
            )
            AgentDockHistoryService.upsertRuntimeSessionMetadata(
                projectPath = projectPath,
                conversationId = "conv-used-adapters",
                sessionId = "session-2",
                adapterName = "openai",
                promptCount = 2,
                titleCandidate = "Second prompt",
                touchUpdatedAt = true
            )

            val conversation = HistoryStorage.readExistingProjectIndex(projectPath)
                .single { it.id == "conv-used-adapters" }
            assertEquals(listOf("claude", "beta", "openai"), conversation.usedAdapterNames)
        }
    }

    @Test
    fun `fork prompt append copies source replay prefix into empty target conversation`() {
        withIsolatedHistoryStorage("agent-dock-history-fork-replay") { projectDir ->
            val projectPath = projectDir.absolutePath

            AgentDockHistoryService.saveConversationReplay(
                projectPath = projectPath,
                conversationId = "source-conversation",
                data = ConversationReplayData(
                    sessions = listOf(
                        ConversationSessionReplayEntry(
                            sessionId = "source-session-1",
                            adapterName = "claude",
                            prompts = listOf(replayPrompt("one"), replayPrompt("two"))
                        ),
                        ConversationSessionReplayEntry(
                            sessionId = "source-session-2",
                            adapterName = "beta",
                            prompts = listOf(replayPrompt("three"))
                        )
                    )
                )
            )

            AgentDockHistoryService.upsertRuntimeSessionMetadata(
                projectPath = projectPath,
                conversationId = "fork-conversation",
                sessionId = "fork-session",
                adapterName = "openai",
                promptCount = 1,
                titleCandidate = "Forked",
                touchUpdatedAt = true
            )
            AgentDockHistoryService.appendConversationPrompt(
                projectPath = projectPath,
                conversationId = "fork-conversation",
                sessionId = "fork-session",
                adapterName = "openai",
                blocks = listOf(textBlock("new")),
                events = listOf(textBlock("answer")),
                assistantMeta = ConversationAssistantMetadata(agentId = "openai"),
                forkBase = ForkConversationBase(sourceConversationId = "source-conversation", promptCount = 2)
            )
            AgentDockHistoryService.appendConversationPrompt(
                projectPath = projectPath,
                conversationId = "fork-conversation",
                sessionId = "fork-session",
                adapterName = "openai",
                blocks = listOf(textBlock("next")),
                events = listOf(textBlock("next answer")),
                assistantMeta = ConversationAssistantMetadata(agentId = "openai"),
                forkBase = ForkConversationBase(sourceConversationId = "source-conversation", promptCount = 2)
            )

            val replayFile = HistoryStorage.conversationDataFile(projectPath, "fork-conversation")
            val replay = HistoryReplayStore.readConversationData(replayFile)

            assertEquals(2, replay?.sessions?.size)
            assertEquals("source-session-1", replay?.sessions?.get(0)?.sessionId)
            assertEquals(2, replay?.sessions?.get(0)?.prompts?.size)
            assertEquals("fork-session", replay?.sessions?.get(1)?.sessionId)
            assertEquals(2, replay?.sessions?.get(1)?.prompts?.size)

            AgentDockHistoryService.upsertRuntimeSessionMetadata(
                projectPath = projectPath,
                conversationId = "fork-conversation",
                sessionId = "fork-session",
                adapterName = "openai",
                promptCount = 1,
                titleCandidate = "Forked",
                touchUpdatedAt = true
            )
            val conversation = HistoryStorage.readExistingProjectIndex(projectPath)
                .single { it.id == "fork-conversation" }
            assertEquals(4, conversation.promptCount)
        }
    }

    @Test
    fun `conversation deletion tolerates sessions from removed adapters`() {
        withIsolatedHistoryStorage("agent-dock-history-retired-adapter-delete") { projectDir ->
            val projectPath = projectDir.absolutePath

            AgentDockHistoryService.upsertRuntimeSessionMetadata(
                projectPath = projectPath,
                conversationId = "retired-conversation",
                sessionId = "retired-session",
                adapterName = "retired-adapter",
                promptCount = 1,
                titleCandidate = "Retired adapter chat",
                touchUpdatedAt = true
            )
            AgentDockHistoryService.saveConversationReplay(
                projectPath = projectPath,
                conversationId = "retired-conversation",
                data = ConversationReplayData(
                    sessions = listOf(
                        ConversationSessionReplayEntry(
                            sessionId = "retired-session",
                            adapterName = "retired-adapter",
                            prompts = listOf(replayPrompt("old"))
                        )
                    )
                )
            )

            val replayFile = HistoryStorage.conversationDataFile(projectPath, "retired-conversation")
            assertTrue(replayFile.isFile)

            val result = runBlocking {
                AgentDockHistoryService.deleteConversations(projectPath, listOf("retired-conversation"))
            }

            assertTrue(result.success)
            assertEquals(emptyList(), result.failures)
            assertEquals(emptyList(), HistoryStorage.readExistingProjectIndex(projectPath))
            assertFalse(replayFile.exists())
        }
    }

    private fun replayPrompt(text: String): ConversationPromptReplayEntry {
        return ConversationPromptReplayEntry(
            blocks = listOf(textBlock(text)),
            events = listOf(textBlock("answer $text")),
            assistantMeta = ConversationAssistantMetadata()
        )
    }

    private fun textBlock(text: String): JsonObject {
        return buildJsonObject {
            put("type", JsonPrimitive("text"))
            put("text", JsonPrimitive(text))
        }
    }

    private fun withIsolatedHistoryStorage(prefix: String, block: (projectDir: File) -> Unit) {
        synchronized(historyStorageTestLock) {
            val originalUserHome = System.getProperty("user.home")
            val testHome = Files.createTempDirectory("$prefix-home-").toFile()
            val projectDir = Files.createTempDirectory("$prefix-project-").toFile()
            try {
                System.setProperty("user.home", testHome.absolutePath)
                block(projectDir)
            } finally {
                val projectHistoryDir = runCatching {
                    HistoryStorage.projectIndexFile(projectDir.absolutePath).parentFile
                }.getOrNull()
                runCatching { projectHistoryDir?.deleteRecursively() }
                runCatching { File(testHome, ".agent-dock").deleteRecursively() }
                runCatching { projectDir.deleteRecursively() }
                if (originalUserHome == null) {
                    System.clearProperty("user.home")
                } else {
                    System.setProperty("user.home", originalUserHome)
                }
                runCatching { testHome.deleteRecursively() }
            }
        }
    }

    private companion object {
        private val historyStorageTestLock = Any()
    }
}
