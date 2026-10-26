package agentdock.settings

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import java.io.File
import java.nio.file.Files

class GlobalSettingsStoreTest {
    @Test
    fun `an update keeps the fields it does not set`() = withIsolatedSettings {
        GlobalSettingsStore.update(buildJsonObject { put("approvalMode", JsonPrimitive("auto")) })
        val updated = GlobalSettingsStore.update(buildJsonObject { put("sendMode", JsonPrimitive("ctrl-enter")) })

        assertEquals("auto", updated?.approvalMode)
        assertEquals("ctrl-enter", updated?.sendMode)
        assertEquals("auto", GlobalSettingsStore.load().approvalMode)
    }

    @Test
    fun `an update that does not decode saves nothing`() = withIsolatedSettings {
        GlobalSettingsStore.update(buildJsonObject { put("approvalMode", JsonPrimitive("auto")) })
        val before = GlobalSettingsStore.load()

        assertNull(GlobalSettingsStore.update(buildJsonObject { put("sendMode", JsonNull) }))
        assertNull(GlobalSettingsStore.update(buildJsonObject { put("uiZoomPercent", JsonPrimitive("large")) }))
        assertEquals(before, GlobalSettingsStore.load())
    }

    @Test
    fun `an update without the access code keeps the saved one`() = withIsolatedSettings {
        val code = assertNotNull(GlobalSettingsStore.load().browserAccessCode)

        val updated = GlobalSettingsStore.update(buildJsonObject { put("browserAccessCode", JsonNull) })

        assertEquals(code, updated?.browserAccessCode)
    }

    private fun withIsolatedSettings(block: () -> Unit) {
        synchronized(settingsTestLock) {
            val originalUserHome = System.getProperty("user.home")
            val testHome = Files.createTempDirectory("settings-home-").toFile()
            try {
                System.setProperty("user.home", testHome.absolutePath)
                block()
            } finally {
                runCatching { File(testHome, ".agent-dock").deleteRecursively() }
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
        private val settingsTestLock = Any()
    }
}
