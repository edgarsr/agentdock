package agentdock.acp

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class FileSearchPathPolicyTest {
    @Test
    fun `normal queries skip files under hidden directories`() {
        assertTrue(isHiddenDirectoryFileSearchPath(".cache/runtime/state-manager.js", "manage"))
        assertTrue(isHiddenDirectoryFileSearchPath("tools/.runtime/cache/state-manager.js", "manage"))
    }

    @Test
    fun `hidden directories can be searched explicitly`() {
        assertFalse(isHiddenDirectoryFileSearchPath(".cache/runtime/state-manager.js", ".cache"))
    }

    @Test
    fun `normal source paths are searchable`() {
        assertFalse(isHiddenDirectoryFileSearchPath("src/components/AgentManagement.tsx", "manage"))
        assertFalse(isHiddenDirectoryFileSearchPath("app/Http/Controllers/UserController.php", "controller"))
        assertFalse(isHiddenDirectoryFileSearchPath("src/package/module.py", "module"))
    }
}
