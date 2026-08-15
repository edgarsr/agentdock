package agentdock.acp

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNull

class FileIconCacheKeyTest {
    @Test
    fun `separators are normalised so one file has one key`() {
        val expected = "C:/www/agentdock/src/AcpBridge.kt"
        assertEquals(expected, fileIconCacheKey("C:\\www\\agentdock\\src\\AcpBridge.kt"))
        assertEquals(expected, fileIconCacheKey("C:\\www/agentdock\\src/AcpBridge.kt"))
        assertEquals(expected, fileIconCacheKey("  C:/www/agentdock/src/AcpBridge.kt  "))
    }

    @Test
    fun `bare names and dotfiles keep their own key`() {
        assertEquals("package.json", fileIconCacheKey("package.json"))
        assertEquals("frontend/.gitignore", fileIconCacheKey("frontend/.gitignore"))
    }

    @Test
    fun `files sharing a name do not share a key`() {
        // Icons are derived from file contents, so same-named files must resolve separately.
        assertNotEquals(fileIconCacheKey("src/a/Config.kt"), fileIconCacheKey("src/b/Config.kt"))
    }

    @Test
    fun `paths naming no file have no key`() {
        assertNull(fileIconCacheKey(""))
        assertNull(fileIconCacheKey("   "))
        assertNull(fileIconCacheKey("src/main/"))
        assertNull(fileIconCacheKey("C:\\www\\agentdock\\"))
    }
}
