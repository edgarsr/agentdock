package agentdock.acp

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

class AcpPlatformCompatibilityTest {
    @Test
    fun `local Linux and macOS use unix npm launch binaries`() = withOsName("Linux") {
        val adapter = npmAdapter()

        val launchPath = resolveAdapterLaunchPath("/tmp/agent", adapter, AcpExecutionTarget.LOCAL).orEmpty()
            .replace("\\", "/")

        assertEquals("/tmp/agent/node_modules/.bin/tool", launchPath)
        assertFalse(launchPath.endsWith(".cmd"))
    }

    @Test
    fun `JavaScript launch files use node on unix local hosts`() = withOsName("Mac OS X") {
        val adapter = AcpAdapterConfig.AdapterInfo(
            id = "tool",
            name = "Tool",
            distribution = AcpAdapterConfig.Distribution(
                type = AcpAdapterConfig.DistributionType.NPM,
                version = "latest",
                packageName = "tool"
            ),
            launchPath = "dist/index.js"
        )

        val command = buildAdapterLaunchCommand("/tmp/agent", adapter, "/tmp/project", AcpExecutionTarget.LOCAL)

        assertEquals("node", command.first())
    }

    private fun npmAdapter(): AcpAdapterConfig.AdapterInfo {
        return AcpAdapterConfig.AdapterInfo(
            id = "tool",
            name = "Tool",
            distribution = AcpAdapterConfig.Distribution(
                type = AcpAdapterConfig.DistributionType.NPM,
                version = "latest",
                packageName = "tool"
            ),
            launchBinary = AcpAdapterConfig.PlatformBinary(
                win = "node_modules/.bin/tool.cmd",
                unix = "node_modules/.bin/tool"
            )
        )
    }

    private fun withOsName(value: String, block: () -> Unit) {
        val previous = System.getProperty("os.name")
        try {
            System.setProperty("os.name", value)
            block()
        } finally {
            System.setProperty("os.name", previous)
        }
    }
}
