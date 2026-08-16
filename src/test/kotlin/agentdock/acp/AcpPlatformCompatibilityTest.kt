package agentdock.acp

import java.io.File
import kotlin.io.path.createTempDirectory
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AcpPlatformCompatibilityTest {
    @Test
    fun `Claude Code uses its CLI login status method`() {
        val adapter = AcpAdapterConfig.getAdapterInfo("claude-code")

        assertEquals("claudeCodeCliAuthStatus", adapter.loginStatusMethod)
    }

    @Test
    fun `Claude Code login status parser reads logged in state`() {
        assertEquals(false, parseClaudeCodeLoginStatus("""{"loggedIn":false,"authMethod":"none"}"""))
        assertEquals(true, parseClaudeCodeLoginStatus("""{"loggedIn":true,"authMethod":"claude.ai"}"""))
        assertEquals(null, parseClaudeCodeLoginStatus("""{"authMethod":"none"}"""))
    }

    @Test
    fun `Codex uses its CLI login status method`() {
        val adapter = AcpAdapterConfig.getAdapterInfo("codex")

        assertEquals("codexCliLoginStatus", adapter.loginStatusMethod)
        assertEquals("cli", adapter.agentVersionConfig?.command)
    }

    @Test
    fun `Codex login status parser reads CLI output`() {
        assertEquals(false, parseCodexLoginStatus("Not logged in"))
        assertEquals(true, parseCodexLoginStatus("Logged in using ChatGPT"))
        assertEquals(null, parseCodexLoginStatus("Unable to read login status"))
    }

    @Test
    fun `Cursor uses ACP login and CLI logout`() {
        val adapter = AcpAdapterConfig.getAdapterInfo("cursor-cli")

        assertEquals("acp", adapter.loginMethod)
        assertEquals("cli", adapter.logoutMethod)
        assertEquals(listOf("logout"), adapter.logoutArgs)
        assertEquals("cursorCliStatus", adapter.loginStatusMethod)
    }

    @Test
    fun `Kimi Code adapter uses the npm ACP command`() = withOsName("Windows 11") {
        val adapter = AcpAdapterConfig.getAdapterInfo("kimi-code")

        assertEquals("@moonshot-ai/kimi-code", adapter.distribution.packageName)
        assertEquals(listOf("acp"), adapter.args)
        assertEquals("acpSessionList", adapter.sessionListMethod)
        assertEquals("kimiCodeSessionDelete", adapter.sessionDeleteMethod)
        assertEquals(
            listOf("cmd.exe", "/c", File("C:/agent/node_modules/.bin/kimi.cmd").absolutePath, "acp"),
            buildAdapterLaunchCommand("C:/agent", adapter, "C:/project", AcpExecutionTarget.LOCAL)
        )
        assertEquals(listOf("--session", "{sessionId}"), adapter.cli?.resumeArgs)
    }

    @Test
    fun `Grok Build adapter uses the npm ACP stdio command`() = withOsName("Windows 11") {
        val adapter = AcpAdapterConfig.getAdapterInfo("grok-build")

        assertEquals("@xai-official/grok", adapter.distribution.packageName)
        assertEquals("1.0.4", adapter.distribution.minimumVersion)
        assertEquals(listOf("--no-auto-update", "agent", "stdio"), adapter.args)
        assertEquals("grokCliSessions", adapter.sessionListMethod)
        assertEquals("grokCliSessionDelete", adapter.sessionDeleteMethod)
        assertEquals("acp", adapter.loginMethod)
        assertEquals("cli", adapter.logoutMethod)
        assertEquals(listOf("logout"), adapter.logoutArgs)
        assertEquals("grokBuildAuthFile", adapter.loginStatusMethod)
        assertEquals(
            listOf("cmd.exe", "/c", File("C:/agent/node_modules/.bin/grok.cmd").absolutePath) + adapter.args,
            buildAdapterLaunchCommand("C:/agent", adapter, "C:/project", AcpExecutionTarget.LOCAL)
        )
    }

    @Test
    fun `Grok Build login status parser checks for an auth key`() {
        assertEquals(
            true,
            parseGrokBuildLoginStatus("""{"https://auth.x.ai:account":{"key":"token","auth_mode":"oidc"}}""")
        )
        assertEquals(
            false,
            parseGrokBuildLoginStatus("""{"https://auth.x.ai:account":{"auth_mode":"oidc"}}""")
        )
        assertEquals(false, parseGrokBuildLoginStatus("{}"))
        assertEquals(null, parseGrokBuildLoginStatus("not json"))
    }

    @Test
    fun `launch detection is independent from minimum version support`() = withOsName("Windows 11") {
        val runtimeDir = createTempDirectory("agentdock-old-adapter").toFile()
        val adapter = npmAdapter().copy(
            distribution = npmAdapter().distribution.copy(minimumVersion = "2.0.0")
        )
        File(runtimeDir, "node_modules/.bin/tool.cmd").apply {
            parentFile.mkdirs()
            writeText("@echo off")
        }
        File(runtimeDir, "node_modules/tool/package.json").apply {
            parentFile.mkdirs()
            writeText("""{"version":"1.5.0"}""")
        }

        assertTrue(AcpAdapterPaths.hasInstalledAdapterLaunch(
            runtimeDir,
            adapter,
            AcpExecutionTarget.LOCAL
        ))
        assertFalse(isInstalledVersionSupported(adapter, installedVersionFromRuntimeDir(runtimeDir, adapter)))
    }

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

    @Test
    fun `process environment appends common executable dirs and removes duplicates`() {
        val existing = createTempDirectory("agentdock-existing").toFile()
        val common = createTempDirectory("agentdock-common").toFile()
        val path = listOf(existing.absolutePath, common.absolutePath).joinToString(File.pathSeparator)

        val env = AcpProcessEnvironment.enrichedEnvironment(
            source = mapOf("PATH" to path),
            commonExecutableDirs = listOf(common)
        )

        assertEquals(path, env["PATH"])
    }

    @Test
    fun `process environment keeps current values and adds missing shell values`() {
        val currentPath = createTempDirectory("agentdock-current-path").toFile()
        val shellPath = createTempDirectory("agentdock-shell-path").toFile()

        val env = AcpProcessEnvironment.mergedBaseEnvironment(
            current = mapOf(
                "PATH" to currentPath.absolutePath,
                "TOKEN" to "current-token"
            ),
            shell = mapOf(
                "PATH" to shellPath.absolutePath,
                "TOKEN" to "shell-token",
                "SHELL_ONLY" to "shell-value"
            ),
            commonExecutableDirs = emptyList()
        )

        assertEquals("current-token", env["TOKEN"])
        assertEquals("shell-value", env["SHELL_ONLY"])
        assertEquals(
            listOf(currentPath.absolutePath, shellPath.absolutePath).joinToString(File.pathSeparator),
            env["PATH"]
        )
    }

    @Test
    fun `process environment prepends runtime path entries before base path`() {
        val existing = createTempDirectory("agentdock-existing").toFile()
        val runtime = createTempDirectory("agentdock-runtime").toFile()

        val env = AcpProcessEnvironment.withPrependedPathEntries(
            source = mapOf("PATH" to existing.absolutePath),
            extraEntries = listOf(runtime)
        )

        assertEquals(
            listOf(runtime.absolutePath, existing.absolutePath).joinToString(File.pathSeparator),
            env["PATH"]
        )
    }

    @Test
    fun `process builder environment keeps existing variables while prepending runtime path`() {
        val existing = createTempDirectory("agentdock-existing").toFile()
        val runtime = createTempDirectory("agentdock-runtime").toFile()
        val builder = ProcessBuilder("node")
        val environment = builder.environment()
        environment.clear()
        environment["AGENTDOCK_CUSTOM"] = "keep-me"
        environment["PATH"] = existing.absolutePath

        AcpProcessEnvironment.applyTo(builder, listOf(runtime))

        assertEquals("keep-me", environment["AGENTDOCK_CUSTOM"])
        assertEquals(runtime.absolutePath, environment["PATH"]?.split(File.pathSeparator)?.firstOrNull())
        assertEquals(existing.absolutePath, environment["PATH"]?.split(File.pathSeparator)?.getOrNull(1))
    }

    @Test
    fun `process environment detects path key case insensitively`() {
        assertEquals("Path", AcpProcessEnvironment.pathKey(mapOf("Path" to "/usr/bin")))
        assertEquals("PATH", AcpProcessEnvironment.pathKey(emptyMap()))
    }

    @Test
    fun `process environment does not append unix executable dirs on windows hosts`() = withOsName("Windows 11") {
        val env = AcpProcessEnvironment.enrichedEnvironment(source = mapOf("Path" to "base-path"))

        assertEquals("base-path", env["Path"])
    }

    @Test
    fun `process registry keeps adapter root cleanup disabled while another owner is alive`() {
        val baseDir = createTempDirectory("agentdock-registry").toFile()
        val destroyedPids = mutableListOf<Long>()
        val cleanedRoots = mutableListOf<String>()
        val alivePids = mutableSetOf(1L, 2L, 11L, 22L)

        val first = registryStore(baseDir, ownerPid = 1L, ownerId = "owner-1", alivePids, destroyedPids, cleanedRoots)
        val second = registryStore(baseDir, ownerPid = 2L, ownerId = "owner-2", alivePids, destroyedPids, cleanedRoots)

        first.registerOwner()
        first.registerProcess("tool", "/tmp/shared-tool", 11L)
        second.registerOwner()
        second.registerProcess("tool", "/tmp/shared-tool", 22L)

        first.closeOwnerAndCleanupIfLast()

        assertTrue(cleanedRoots.isEmpty())
        assertTrue(destroyedPids.isEmpty())
    }

    @Test
    fun `process registry cleans adapter roots when the last owner closes`() {
        val baseDir = createTempDirectory("agentdock-registry").toFile()
        val destroyedPids = mutableListOf<Long>()
        val cleanedRoots = mutableListOf<String>()
        val alivePids = mutableSetOf(1L, 11L)

        val store = registryStore(baseDir, ownerPid = 1L, ownerId = "owner-1", alivePids, destroyedPids, cleanedRoots)

        store.registerOwner()
        store.registerProcess("tool", "/tmp/shared-tool", 11L)
        store.unregisterProcess(11L)
        store.closeOwnerAndCleanupIfLast()

        assertEquals(listOf(File("/tmp/shared-tool").absoluteFile.normalize().path.replace('\\', '/')), cleanedRoots)
        assertTrue(destroyedPids.isEmpty())
    }

    @Test
    fun `process registry removes dead owners without adapter root cleanup while another owner is alive`() {
        val baseDir = createTempDirectory("agentdock-registry").toFile()
        val destroyedPids = mutableListOf<Long>()
        val cleanedRoots = mutableListOf<String>()
        val alivePids = mutableSetOf(1L, 3L, 33L)

        val dead = registryStore(baseDir, ownerPid = 2L, ownerId = "owner-2", alivePids + 2L + 22L, destroyedPids, cleanedRoots)
        dead.registerOwner()
        dead.registerProcess("tool", "/tmp/shared-tool", 22L)

        val current = registryStore(baseDir, ownerPid = 1L, ownerId = "owner-1", alivePids, destroyedPids, cleanedRoots)
        val otherLive = registryStore(baseDir, ownerPid = 3L, ownerId = "owner-3", alivePids, destroyedPids, cleanedRoots)
        current.registerOwner()
        otherLive.registerOwner()
        otherLive.registerProcess("tool", "/tmp/shared-tool", 33L)

        current.closeOwnerAndCleanupIfLast()

        assertEquals(listOf(22L), destroyedPids)
        assertTrue(cleanedRoots.isEmpty())
    }

    @Test
    fun `process registry remembers roots from closed owners for final cleanup`() {
        val baseDir = createTempDirectory("agentdock-registry").toFile()
        val destroyedPids = mutableListOf<Long>()
        val cleanedRoots = mutableListOf<String>()
        val alivePids = mutableSetOf(1L, 2L, 11L, 22L)

        val first = registryStore(baseDir, ownerPid = 1L, ownerId = "owner-1", alivePids, destroyedPids, cleanedRoots)
        val second = registryStore(baseDir, ownerPid = 2L, ownerId = "owner-2", alivePids, destroyedPids, cleanedRoots)

        first.registerOwner()
        first.registerProcess("tool-a", "/tmp/tool-a", 11L)
        second.registerOwner()
        second.registerProcess("tool-b", "/tmp/tool-b", 22L)

        first.closeOwnerAndCleanupIfLast()
        alivePids.remove(1L)
        second.closeOwnerAndCleanupIfLast()

        assertEquals(
            setOf(
                File("/tmp/tool-a").absoluteFile.normalize().path.replace('\\', '/'),
                File("/tmp/tool-b").absoluteFile.normalize().path.replace('\\', '/')
            ),
            cleanedRoots.toSet()
        )
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

    private fun registryStore(
        baseDir: File,
        ownerPid: Long,
        ownerId: String,
        alivePids: Set<Long>,
        destroyedPids: MutableList<Long>,
        cleanedRoots: MutableList<String>
    ): AcpProcessRegistryStore {
        return AcpProcessRegistryStore(
            baseDir = baseDir,
            currentOwnerPid = ownerPid,
            currentOwnerId = ownerId,
            isProcessAlive = { pid -> pid in alivePids },
            destroyRegisteredProcess = { pid, _ -> destroyedPids.add(pid) },
            stopProcessesUsingRoots = { roots -> cleanedRoots.addAll(roots) }
        )
    }
}
