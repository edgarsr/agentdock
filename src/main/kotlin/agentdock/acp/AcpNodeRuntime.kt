package agentdock.acp

import com.intellij.execution.configurations.GeneralCommandLine
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.net.URI
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.TimeUnit

internal data class AcpNodeRuntime(
    val node: String,
    val npm: String,
    val npx: String,
    val pathEntries: List<File> = emptyList(),
    val managed: Boolean = false
)

internal object AcpNodeRuntimeResolver {
    private const val NODE_DIST_BASE = "https://nodejs.org/dist"
    private const val NODE_INDEX_URL = "$NODE_DIST_BASE/index.json"
    private const val NODE_INSTALL_TIMEOUT_MINUTES = 10L
    private val json = Json { ignoreUnknownKeys = true }

    fun resolveOrInstall(
        statusCallback: ((String) -> Unit)? = null,
        cancellation: AcpAdapterInstallCancellation? = null
    ): AcpNodeRuntime? {
        resolveAvailable()?.let { return it }
        return installManaged(statusCallback, cancellation)?.takeIf { smokeTest(it) }
    }

    fun resolveAvailable(): AcpNodeRuntime? {
        resolveSystem()?.let { return it }
        resolveManaged()?.let { return it }
        return null
    }

    fun applyTo(builder: ProcessBuilder, runtime: AcpNodeRuntime) {
        val path = mergedPath(runtime.pathEntries, builder.environment())
        if (path.isNotBlank()) {
            builder.environment()[pathKey(builder.environment())] = path
        }
    }

    fun applyTo(commandLine: GeneralCommandLine, runtime: AcpNodeRuntime): GeneralCommandLine {
        val env = System.getenv().toMutableMap()
        val path = mergedPath(runtime.pathEntries, env)
        if (path.isNotBlank()) env[pathKey(env)] = path
        return commandLine.withEnvironment(env)
    }

    fun resolveManaged(): AcpNodeRuntime? {
        val root = managedVersionRoot() ?: return null
        val node = nodeIn(root) ?: return null
        val npm = npmIn(root) ?: return null
        val npx = npxIn(root) ?: return null
        val runtime = AcpNodeRuntime(
            node = node.absolutePath,
            npm = npm.absolutePath,
            npx = npx.absolutePath,
            pathEntries = listOfNotNull(node.parentFile, npm.parentFile).distinctBy { it.absolutePath.lowercase() },
            managed = true
        )
        return runtime.takeIf { smokeTest(it) }
    }

    fun managedRoot(): File = File(AcpAdapterPaths.getDependenciesDir(), "node")

    private fun managedVersionRoot(): File? {
        val root = managedRoot()
        if (!root.isDirectory) return null
        return root.listFiles()
            ?.filter { it.isDirectory && it.name.startsWith("v") }
            ?.maxWithOrNull(compareBy<File> { semanticVersionPart(it.name, 0) }
                .thenBy { semanticVersionPart(it.name, 1) }
                .thenBy { semanticVersionPart(it.name, 2) })
    }

    private fun semanticVersionPart(version: String, index: Int): Int =
        version.trimStart('v')
            .split('.')
            .getOrNull(index)
            ?.takeWhile { it.isDigit() }
            ?.toIntOrNull()
            ?: 0

    private fun resolveSystem(): AcpNodeRuntime? {

        val candidates = buildList {
            add(emptyList<File>())
            nvmdBinDir()?.takeIf { it.isDirectory }?.let { add(listOf(it)) }
        }

        candidates.forEach { entries ->
            val runtime = AcpNodeRuntime(
                node = commandName("node"),
                npm = commandName("npm"),
                npx = commandName("npx"),
                pathEntries = entries,
                managed = false
            )
            if (smokeTest(runtime)) return runtime
        }

        return resolveFromNvmdWhich()
    }

    private fun resolveFromNvmdWhich(): AcpNodeRuntime? {
        val nvmdBin = nvmdBinDir()?.takeIf { it.isDirectory } ?: return null
        val nvmd = executableIn(nvmdBin, "nvmd") ?: File(nvmdBin, if (AcpExecutionMode.isWindowsHost()) "nvmd.cmd" else "nvmd")
        if (!nvmd.exists()) return null
        val pathEntries = listOf(nvmdBin)
        val node = runWhich(nvmd.absolutePath, "node", pathEntries) ?: return null
        val npm = runWhich(nvmd.absolutePath, "npm", pathEntries) ?: return null
        val npx = runWhich(nvmd.absolutePath, "npx", pathEntries) ?: commandName("npx")
        val runtime = AcpNodeRuntime(node, npm, npx, pathEntries, managed = false)
        return runtime.takeIf { smokeTest(it) }
    }

    private fun runWhich(nvmd: String, name: String, pathEntries: List<File>): String? {
        val process = ProcessBuilder(nvmd, "which", name).redirectErrorStream(true)
        applyTo(process, AcpNodeRuntime(commandName("node"), commandName("npm"), commandName("npx"), pathEntries))
        return runCatching {
            val started = process.start()
            val output = started.inputStream.bufferedReader().use { it.readText() }.trim()
            if (!started.waitFor(10, TimeUnit.SECONDS)) {
                started.destroyForcibly()
                return null
            }
            output.lines().firstOrNull { it.isNotBlank() }?.trim()?.takeIf { started.exitValue() == 0 }
        }.getOrNull()
    }

    private fun installManaged(
        statusCallback: ((String) -> Unit)? = null,
        cancellation: AcpAdapterInstallCancellation? = null
    ): AcpNodeRuntime? {
        return try {
            cancellation?.throwIfCancelled()
            statusCallback?.invoke("Node.js was not found. Installing managed Node.js LTS...")
            val release = latestLtsRelease()
            val artifact = artifactName(release.version)
            val versionDir = File(managedRoot(), release.version)
            val archive = File(managedRoot(), artifact)
            val shasums = fetchText("$NODE_DIST_BASE/${release.version}/SHASUMS256.txt")
            val expectedSha = shasums.lineSequence()
                .map { it.trim() }
                .firstOrNull { it.endsWith(" $artifact") || it.endsWith("  $artifact") }
                ?.substringBefore(' ')
                ?.trim()
                ?: throw IllegalStateException("Unable to verify Node.js checksum")

            managedRoot().mkdirs()
            if (versionDir.isDirectory) versionDir.deleteRecursively()
            statusCallback?.invoke("Downloading Node.js ${release.version}...")
            downloadFile("$NODE_DIST_BASE/${release.version}/$artifact", archive, cancellation)
            cancellation?.throwIfCancelled()
            verifySha256(archive, expectedSha)

            statusCallback?.invoke("Extracting Node.js ${release.version}...")
            extractArchive(archive, managedRoot(), cancellation)
            archive.delete()

            val extractedRoot = File(managedRoot(), artifact.removeSuffix(".zip").removeSuffix(".tar.xz").removeSuffix(".tar.gz"))
            if (extractedRoot.isDirectory && extractedRoot != versionDir) {
                if (versionDir.exists()) versionDir.deleteRecursively()
                extractedRoot.renameTo(versionDir)
            }

            val runtime = resolveManaged()
            if (runtime == null) {
                statusCallback?.invoke("Error: Managed Node.js installation failed")
            } else {
                statusCallback?.invoke("Managed Node.js ${release.version} installed successfully.")
            }
            runtime
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            statusCallback?.invoke("Error: ${e.message ?: "Node.js installation failed"}")
            null
        }
    }

    private data class NodeRelease(val version: String)

    private fun latestLtsRelease(): NodeRelease {
        val releases = json.parseToJsonElement(fetchText(NODE_INDEX_URL)) as JsonArray
        val version = releases.firstNotNullOfOrNull { entry ->
            val obj = entry.jsonObject
            val lts = obj["lts"]?.jsonPrimitive?.contentOrNull
            obj["version"]?.jsonPrimitive?.contentOrNull?.takeIf { !lts.isNullOrBlank() && lts != "false" }
        } ?: throw IllegalStateException("Unable to resolve latest Node.js LTS")
        return NodeRelease(version)
    }

    private fun artifactName(version: String): String {
        val platform = when {
            AcpExecutionMode.isWindowsHost() -> "win"
            System.getProperty("os.name").lowercase(Locale.ROOT).contains("mac") -> "darwin"
            else -> "linux"
        }
        val arch = when {
            System.getProperty("os.arch").lowercase(Locale.ROOT).contains("aarch64") -> "arm64"
            System.getProperty("os.arch").lowercase(Locale.ROOT).contains("arm64") -> "arm64"
            else -> "x64"
        }
        val ext = if (platform == "win") "zip" else "tar.xz"
        return "node-$version-$platform-$arch.$ext"
    }

    private fun fetchText(url: String): String {
        val connection = URI(url).toURL().openConnection()
        connection.connectTimeout = 15_000
        connection.readTimeout = 30_000
        return connection.getInputStream().bufferedReader().use { it.readText() }
    }

    private fun downloadFile(
        url: String,
        target: File,
        cancellation: AcpAdapterInstallCancellation?
    ) {
        target.parentFile.mkdirs()
        val connection = URI(url).toURL().openConnection()
        connection.connectTimeout = 15_000
        connection.readTimeout = 30_000
        connection.getInputStream().use { input ->
            target.outputStream().use { output ->
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                while (true) {
                    cancellation?.throwIfCancelled()
                    val read = input.read(buffer)
                    if (read < 0) break
                    output.write(buffer, 0, read)
                }
            }
        }
    }

    private fun verifySha256(file: File, expected: String) {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        if (!actual.equals(expected, ignoreCase = true)) {
            throw IllegalStateException("Node.js checksum verification failed")
        }
    }

    private fun extractArchive(
        archive: File,
        targetDir: File,
        cancellation: AcpAdapterInstallCancellation?
    ) {
        val builder = if (AcpExecutionMode.isWindowsHost()) {
            ProcessBuilder(
                "powershell",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "\$ProgressPreference = 'SilentlyContinue'; Expand-Archive -Path '${archive.absolutePath}' -DestinationPath '${targetDir.absolutePath}' -Force"
            )
        } else {
            ProcessBuilder("tar", "-xJf", archive.absolutePath, "-C", targetDir.absolutePath)
        }
        val process = builder.redirectErrorStream(true).start()
        cancellation?.register(process)
        try {
            val finished = process.waitFor(NODE_INSTALL_TIMEOUT_MINUTES, TimeUnit.MINUTES)
            if (!finished) {
                process.destroyForcibly()
                throw IllegalStateException("Node.js extraction timed out")
            }
            if (process.exitValue() != 0) {
                throw IllegalStateException("Node.js extraction failed")
            }
        } finally {
            cancellation?.unregister(process)
        }
    }

    private fun smokeTest(runtime: AcpNodeRuntime): Boolean =
        versionCheck(runtime.node, runtime) && versionCheck(runtime.npm, runtime)

    private fun versionCheck(command: String, runtime: AcpNodeRuntime): Boolean {
        return runCatching {
            val processBuilder = ProcessBuilder(command, "--version").redirectErrorStream(true)
            applyTo(processBuilder, runtime)
            val process = processBuilder.start()
            val finished = process.waitFor(15, TimeUnit.SECONDS)
            if (!finished) process.destroyForcibly()
            finished && process.exitValue() == 0
        }.getOrDefault(false)
    }

    private fun commandName(base: String): String {
        return when {
            !AcpExecutionMode.isWindowsHost() -> base
            base == "node" -> "node.exe"
            else -> "$base.cmd"
        }
    }

    private fun executableIn(dir: File, base: String): File? {
        val names = if (AcpExecutionMode.isWindowsHost()) {
            listOf("$base.exe", "$base.cmd", base)
        } else {
            listOf(base)
        }
        return names.map { File(dir, it) }.firstOrNull { it.isFile }
    }

    private fun npmIn(root: File): File? =
        executableIn(root, "npm") ?: executableIn(File(root, "bin"), "npm")

    private fun npxIn(root: File): File? =
        executableIn(root, "npx") ?: executableIn(File(root, "bin"), "npx")

    private fun nodeIn(root: File): File? =
        executableIn(root, "node") ?: executableIn(File(root, "bin"), "node")

    private fun nvmdBinDir(): File? {
        val home = System.getProperty("user.home")?.takeIf { it.isNotBlank() } ?: return null
        return File(File(home, ".nvmd"), "bin")
    }

    private fun pathKey(env: Map<String, String>): String =
        env.keys.firstOrNull { it.equals("PATH", ignoreCase = true) } ?: "PATH"

    private fun mergedPath(extraEntries: List<File>, env: Map<String, String>): String {
        val key = pathKey(env)
        val existing = env[key].orEmpty()
        val prefix = extraEntries
            .filter { it.isDirectory }
            .joinToString(File.pathSeparator) { it.absolutePath }
        return when {
            prefix.isBlank() -> existing
            existing.isBlank() -> prefix
            else -> "$prefix${File.pathSeparator}$existing"
        }
    }
}
