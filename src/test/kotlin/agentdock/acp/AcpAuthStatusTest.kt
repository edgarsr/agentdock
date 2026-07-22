package agentdock.acp

import java.io.File
import kotlin.io.path.createTempDirectory
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AcpAuthStatusTest {
    @Test
    fun `adapter configs select auth functions by name`() {
        listOf("codex", "claude-code", "cursor-cli").forEach { adapterId ->
            val auth = AcpAdapterConfig.getAdapterInfo(adapterId).authConfig
            assertEquals("cliAuthStatus", auth?.statusMethod)
            assertEquals("cliLogin", auth?.loginMethod)
            assertEquals("cliLogout", auth?.logoutMethod)
        }

        val qoderAuth = AcpAdapterConfig.getAdapterInfo("qoder").authConfig
        assertEquals("cliAuthStatus", qoderAuth?.statusMethod)
        assertEquals("cliLogin", qoderAuth?.loginMethod)
        assertEquals(null, qoderAuth?.logoutMethod)

        val grokAuth = AcpAdapterConfig.getAdapterInfo("grok-build").authConfig
        assertEquals("grokAuthStatus", grokAuth?.statusMethod)
        assertEquals("acpAuthenticateLogin", grokAuth?.loginMethod)
        assertEquals("cliLogout", grokAuth?.logoutMethod)
        assertEquals("grok.com", grokAuth?.authMethodId)
        assertEquals(listOf("logout"), grokAuth?.logoutArgs)

        assertEquals(null, AcpAdapterConfig.getAdapterInfo("opencode").authConfig)
    }

    @Test
    fun `grokAuthStatus is authenticated when auth json contains a key`() {
        val authFile = createAuthFile(
            """{"https://auth.x.ai::profile":{"key":"secret"}}"""
        )

        assertTrue(AcpAuthStatusService.grokAuthStatus(authFile).authenticated)
    }

    @Test
    fun `grokAuthStatus is unauthenticated without a key`() {
        val authFile = createAuthFile(
            """{"https://auth.x.ai::profile":{"refresh_token":"secret"}}"""
        )

        assertFalse(AcpAuthStatusService.grokAuthStatus(authFile).authenticated)
    }

    @Test
    fun `grokAuthStatus is unauthenticated when auth json does not exist`() {
        val missingFile = File(createTempDirectory("agentdock-grok-auth").toFile(), "auth.json")

        assertFalse(AcpAuthStatusService.grokAuthStatus(missingFile).authenticated)
    }

    private fun createAuthFile(content: String): File {
        val authFile = File(createTempDirectory("agentdock-grok-auth").toFile(), "auth.json")
        authFile.writeText(content)
        return authFile
    }
}
