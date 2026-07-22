package agentdock.history

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class GrokSessionHistoryTest {
    @Test
    fun `session table is parsed into history metadata`() {
        val sessions = GrokSessionHistory.parseSessionList(
            output = """
                (no label)
                SESSION ID                            CREATED     UPDATED     STATUS      SUMMARY
                019f86ac-885c-7751-920f-f1d63c318d29  2026-07-21  2026-07-22  local       First Grok conversation
                019f86ad-0e89-74c0-8c00-3558c4f5c6a9  2026-07-22  2026-07-22  local       (no summary)
            """.trimIndent(),
            adapterId = "grok-build",
            projectPath = "C:/project"
        )

        assertEquals(2, sessions.size)
        assertEquals("019f86ac-885c-7751-920f-f1d63c318d29", sessions[0].sessionId)
        assertEquals("First Grok conversation", sessions[0].title)
        assertEquals("Untitled Session", sessions[1].title)
        assertTrue(sessions[0].createdAt > 0)
    }

    @Test
    fun `empty Grok history is accepted`() {
        assertEquals(
            emptyList(),
            GrokSessionHistory.parseSessionList("No sessions found.", "grok-build", "C:/project")
        )
    }

    @Test
    fun `incomplete Grok table is rejected`() {
        assertFailsWith<IllegalStateException> {
            GrokSessionHistory.parseSessionList(
                output = """
                    (no label)
                    SESSION ID                            CREATED     UPDATED     STATUS      SUMMARY
                    019f86ac-885c-7751-920f-f1d63c318d29  2026-07-21  2026-07-22  local       Only one row
                    unrecognized row
                """.trimIndent(),
                adapterId = "grok-build",
                projectPath = "C:/project"
            )
        }
    }

}
