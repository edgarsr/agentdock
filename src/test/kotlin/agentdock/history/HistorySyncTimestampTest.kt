package agentdock.history

import kotlin.test.Test
import kotlin.test.assertEquals

class HistorySyncTimestampTest {
    @Test
    fun `invalid discovered creation time does not erase existing time`() {
        assertEquals(1_000L, resolveSyncedCreatedAt(1_000L, 0L))
    }

    @Test
    fun `earliest valid creation time is retained`() {
        assertEquals(500L, resolveSyncedCreatedAt(1_000L, 500L))
        assertEquals(500L, resolveSyncedCreatedAt(0L, 500L))
    }

    @Test
    fun `invalid discovered update time does not erase existing time`() {
        assertEquals(1_000L, resolveSyncedUpdatedAt(1_000L, 0L))
    }

    @Test
    fun `latest valid update time is retained`() {
        assertEquals(1_500L, resolveSyncedUpdatedAt(1_000L, 1_500L))
        assertEquals(1_500L, resolveSyncedUpdatedAt(0L, 1_500L))
    }
}
