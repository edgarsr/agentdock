package agentdock.history

import java.io.File
import kotlin.io.path.createTempDirectory
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class KimiSessionHistoryTest {
    @Test
    fun `session directory and index entry are deleted`() {
        val kimiDataDirectory = createTempDirectory("agentdock-kimi-history").toFile()
        val sessionId = "session_6b77bc7d-8d42-4cc7-a17c-dfc813883d7a"
        val otherSessionId = "session_a84ba994-dcd7-453c-8202-108fda61cc53"
        val projectPath = File(kimiDataDirectory, "project").absolutePath
        val sessionDirectory = File(kimiDataDirectory, "sessions/project/$sessionId").apply {
            mkdirs()
            resolve("state.json").writeText("{}")
        }
        val otherSessionDirectory = File(kimiDataDirectory, "sessions/project/$otherSessionId").apply { mkdirs() }
        val indexFile = File(kimiDataDirectory, "session_index.jsonl").apply {
            writeText(
                listOf(
                    indexEntry(sessionId, sessionDirectory, projectPath),
                    indexEntry(otherSessionId, otherSessionDirectory, projectPath)
                ).joinToString(separator = "\n", postfix = "\n")
            )
        }

        assertTrue(KimiSessionHistory.deleteSession(kimiDataDirectory, projectPath, sessionId))

        assertFalse(sessionDirectory.exists())
        assertTrue(otherSessionDirectory.exists())
        assertEquals(
            indexEntry(otherSessionId, otherSessionDirectory, projectPath) + "\n",
            indexFile.readText()
        )
    }

    @Test
    fun `session directory outside Kimi sessions root is rejected`() {
        val kimiDataDirectory = createTempDirectory("agentdock-kimi-history").toFile()
        val sessionId = "session_6b77bc7d-8d42-4cc7-a17c-dfc813883d7a"
        val projectPath = File(kimiDataDirectory, "project").absolutePath
        val outsideDirectory = File(kimiDataDirectory.parentFile, sessionId).apply { mkdirs() }
        val indexFile = File(kimiDataDirectory, "session_index.jsonl").apply {
            writeText(indexEntry(sessionId, outsideDirectory, projectPath) + "\n")
        }

        assertFalse(KimiSessionHistory.deleteSession(kimiDataDirectory, projectPath, sessionId))

        assertTrue(outsideDirectory.exists())
        assertTrue(indexFile.readText().contains(sessionId))
        outsideDirectory.delete()
    }

    private fun indexEntry(sessionId: String, sessionDirectory: File, projectPath: String): String {
        val sessionPath = sessionDirectory.absolutePath.replace("\\", "/")
        val workDir = projectPath.replace("\\", "/")
        return """{"sessionId":"$sessionId","sessionDir":"$sessionPath","workDir":"$workDir"}"""
    }
}
