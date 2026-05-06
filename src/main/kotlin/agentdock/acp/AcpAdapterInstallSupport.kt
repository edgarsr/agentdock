package agentdock.acp

import java.io.File
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject

private const val ARCHIVE_COMMAND_TIMEOUT_MINUTES = 10L
private const val INSTALL_METADATA_FILE = ".install-metadata.json"
private val adapterMetadataJson = Json { ignoreUnknownKeys = true; encodeDefaults = true }

@Serializable
private data class InstallMetadata(
    val version: String
)

private data class RuntimePlatform(
    val platform: String,
    val archiveArch: String,
    val archiveExt: String,
    val target: String,
    val libc: String,
    val libcSuffix: String
)

internal fun resolveInstallAdapterInfo(
    adapterInfo: AcpAdapterConfig.AdapterInfo,
    statusCallback: ((String) -> Unit)? = null
): AcpAdapterConfig.AdapterInfo? {
    if (adapterInfo.distribution.type != AcpAdapterConfig.DistributionType.ARCHIVE) {
        return adapterInfo
    }
    val configuredVersion = adapterInfo.distribution.version.trim()
    if (!configuredVersion.equals("latest", ignoreCase = true)) {
        return adapterInfo
    }

    statusCallback?.invoke("Resolving latest ${adapterInfo.name} version...")
    val resolvedVersion = AcpAdapterUpdates.latestAvailableVersion(adapterInfo)?.trim()?.takeIf { it.isNotEmpty() }
    if (resolvedVersion == null) {
        statusCallback?.invoke("Error: Unable to resolve latest version for ${adapterInfo.name}")
        return null
    }
    return adapterInfo.withDistributionVersion(resolvedVersion)
}

internal fun downloadArchiveDistributionLocal(
    targetDir: File,
    adapterInfo: AcpAdapterConfig.AdapterInfo,
    statusCallback: ((String) -> Unit)? = null,
    cancellation: AcpAdapterInstallCancellation? = null
): Boolean {
    val runtime = detectRuntimePlatform(AcpExecutionTarget.LOCAL)
    targetDir.mkdirs()

    val rawUrl = adapterInfo.distribution.downloadUrl
    if (rawUrl == null) {
        statusCallback?.invoke("Error: Archive distribution for '${adapterInfo.id}' has no downloadUrl configured")
        return false
    }
    val downloadUrl = resolveArchiveDownloadUrl(rawUrl, adapterInfo, runtime)
    val tempFile = File(targetDir, "tool-download.${runtime.archiveExt}")

    return try {
        cancellation?.throwIfCancelled()
        statusCallback?.invoke("Downloading ${adapterInfo.name}...")
        if (runtime.platform == "windows") {
            statusCallback?.invoke("Downloading package...")
            val downloadExitCode = runArchiveCommand(
                ProcessBuilder(
                    "powershell",
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "\$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri '$downloadUrl' -OutFile '${tempFile.absolutePath}'"
                ),
                statusCallback,
                cancellation
            )
            if (downloadExitCode != 0) return false

            statusCallback?.invoke("Extracting package...")
            val extractExitCode = runArchiveCommand(
                ProcessBuilder(
                    "powershell",
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "\$ProgressPreference = 'SilentlyContinue'; Expand-Archive -Path '${tempFile.absolutePath}' -DestinationPath '${targetDir.absolutePath}' -Force"
                ),
                statusCallback,
                cancellation
            )
            if (extractExitCode != 0) return false
        } else {
            statusCallback?.invoke("Downloading and extracting package...")
            val exitCode = runArchiveCommand(
                ProcessBuilder(
                    "sh",
                    "-c",
                    """
                    set -e
                    temp_file=${quoteUnixShellArg("${targetDir.absolutePath}/tool-download.${runtime.archiveExt}")}
                    curl -fsSL ${quoteUnixShellArg(downloadUrl)} -o "${'$'}temp_file"
                    first_entry=${'$'}(tar -tzf "${'$'}temp_file" | sed -n '1p')
                    case "${'$'}first_entry" in
                      */*) tar --strip-components=1 -xzf "${'$'}temp_file" -C ${quoteUnixShellArg(targetDir.absolutePath)} ;;
                      *) tar -xzf "${'$'}temp_file" -C ${quoteUnixShellArg(targetDir.absolutePath)} ;;
                    esac
                    rm -f "${'$'}temp_file"
                    """.trimIndent()
                ),
                statusCallback,
                cancellation
            )
            if (exitCode != 0) return false

        }

        cancellation?.throwIfCancelled()
        flattenConfiguredExtractSubdir(targetDir, adapterInfo)
        if (runtime.platform != "windows") {
            statusCallback?.invoke("Ensuring executables...")
            ensureExtractedFilesExecutable(targetDir)
        }
        tempFile.delete()
        val authNpmPackage = adapterInfo.authConfig?.authNpmPackage
        if (!authNpmPackage.isNullOrBlank()) {
            cancellation?.throwIfCancelled()
            statusCallback?.invoke("Installing auth tools...")
            val nodeRuntime = AcpNodeRuntimeResolver.resolveOrInstall(statusCallback, cancellation)
            if (nodeRuntime == null) {
                statusCallback?.invoke("Error: Node.js is required")
                return false
            }
            val builder = ProcessBuilder(nodeRuntime.npm, "install", "--prefix", targetDir.absolutePath, "$authNpmPackage@latest")
                .directory(targetDir)
            AcpNodeRuntimeResolver.applyTo(builder, nodeRuntime)
            val authInstallExitCode = runArchiveCommand(
                builder,
                statusCallback,
                cancellation
            )
            if (authInstallExitCode != 0) {
                statusCallback?.invoke("Error: Auth tools installation failed")
                return false
            }
        }
        statusCallback?.invoke("${adapterInfo.name} installed successfully.")
        true
    } catch (e: CancellationException) {
        tempFile.delete()
        throw e
    } catch (e: Exception) {
        statusCallback?.invoke("Error: ${e.message}")
        false
    }
}

internal fun prepareAdapterTargetDir(targetDir: File) {
    if (targetDir.exists()) targetDir.deleteRecursively()
    targetDir.mkdirs()
}

internal fun deleteLocalAdapterRuntime(
    runtimeDir: File,
    adapterId: String,
    target: AcpExecutionTarget
): Boolean {
    return runCatching {
        AcpProcessUtils.stopProcessesUsingAdapterRoot(adapterId, target)
        deleteDirectoryWithRetries(runtimeDir)
    }.getOrDefault(false)
}

internal fun installedVersionFromRuntimeDir(
    runtimeDir: File,
    adapterInfo: AcpAdapterConfig.AdapterInfo
): String? {
    if (!runtimeDir.isDirectory) return null
    return when (adapterInfo.distribution.type) {
        AcpAdapterConfig.DistributionType.NPM -> {
            val packageJson = File(resolveNpmPackageRootPath(runtimeDir.absolutePath, adapterInfo, AcpExecutionTarget.LOCAL), "package.json")
            runCatching {
                adapterMetadataJson.parseToJsonElement(packageJson.readText()).jsonObject["version"]?.toString()?.trim('"')
            }.getOrNull()?.takeIf { it.isNotBlank() }
        }
        AcpAdapterConfig.DistributionType.ARCHIVE -> readInstallMetadata(runtimeDir)
    }
}

internal fun writeInstallMetadata(runtimeDir: File, version: String) {
    runtimeDir.mkdirs()
    File(runtimeDir, INSTALL_METADATA_FILE).writeText(
        adapterMetadataJson.encodeToString(InstallMetadata(version.trim()))
    )
}

private fun detectRuntimePlatform(target: AcpExecutionTarget): RuntimePlatform {
    val os = System.getProperty("os.name").lowercase()
    val arch = System.getProperty("os.arch").lowercase()
    val isArm64 = arch.contains("aarch64") || arch.contains("arm64")
    val archiveArch = if (isArm64) "arm64" else "x64"
    val targetArch = if (isArm64) "aarch64" else "x86_64"

    return when {
        os.contains("win") -> RuntimePlatform("windows", archiveArch, "zip", "$targetArch-pc-windows-msvc", "msvc", "")
        os.contains("mac") -> RuntimePlatform("darwin", archiveArch, "tar.gz", "$targetArch-apple-darwin", "", "")
        else -> RuntimePlatform("linux", archiveArch, "tar.gz", "$targetArch-unknown-linux-gnu", "gnu", "")
    }
}

private fun resolveArchiveDownloadUrl(
    template: String,
    adapterInfo: AcpAdapterConfig.AdapterInfo,
    runtime: RuntimePlatform
): String {
    return template
        .replace("{platform}", runtime.platform)
        .replace("{arch}", runtime.archiveArch)
        .replace("{ext}", runtime.archiveExt)
        .replace("{target}", runtime.target)
        .replace("{libc}", runtime.libc)
        .replace("{libcSuffix}", runtime.libcSuffix)
        .replace("{version}", adapterInfo.distribution.version)
}

private fun flattenConfiguredExtractSubdir(targetDir: File, adapterInfo: AcpAdapterConfig.AdapterInfo) {
    val extractSubdir = adapterInfo.distribution.extractSubdir?.trim().orEmpty()
    if (extractSubdir.isEmpty()) return
    val nestedDir = File(targetDir, extractSubdir)
    if (!nestedDir.isDirectory) return
    nestedDir.listFiles()?.forEach { child ->
        child.copyRecursively(File(targetDir, child.name), overwrite = true)
    }
    nestedDir.deleteRecursively()
}

private fun ensureExtractedFilesExecutable(targetDir: File) {
    targetDir.walkTopDown()
        .filter { it.isFile }
        .forEach { it.setExecutable(true) }
}

private fun runArchiveCommand(
    builder: ProcessBuilder,
    statusCallback: ((String) -> Unit)? = null,
    cancellation: AcpAdapterInstallCancellation? = null
): Int {
    cancellation?.throwIfCancelled()
    val process = builder.redirectErrorStream(true).start()
    cancellation?.register(process)
    val recentOutput = java.util.Collections.synchronizedList(mutableListOf<String>())
    val outputDrainer = Thread {
        process.inputStream.bufferedReader().useLines { lines ->
            lines.forEach { line ->
                val trimmed = line.trim()
                if (trimmed.isNotBlank()) {
                    recentOutput.add(trimmed)
                    if (recentOutput.size > 8) recentOutput.removeAt(0)
                    statusCallback?.invoke(trimmed)
                }
            }
        }
    }
    outputDrainer.isDaemon = true
    outputDrainer.start()

    try {
        val deadlineNanos = System.nanoTime() + TimeUnit.MINUTES.toNanos(ARCHIVE_COMMAND_TIMEOUT_MINUTES)
        while (true) {
            cancellation?.throwIfCancelled()
            if (process.waitFor(250, TimeUnit.MILLISECONDS)) break
            if (System.nanoTime() >= deadlineNanos) {
                process.destroyForcibly()
                outputDrainer.join(1000)
                statusCallback?.invoke("Error: Command timed out")
                return -1
            }
        }
    } catch (e: CancellationException) {
        process.destroyForcibly()
        outputDrainer.join(1000)
        throw e
    } finally {
        cancellation?.unregister(process)
    }

    cancellation?.throwIfCancelled()
    outputDrainer.join(1000)
    val exitCode = process.exitValue()
    if (exitCode != 0) {
        val detail = recentOutput.joinToString("\n").takeIf { it.isNotBlank() }
        statusCallback?.invoke(
            if (detail == null) {
                "Error: Command failed with exit code $exitCode"
            } else {
                "Error: Command failed with exit code $exitCode\n$detail"
            }
        )
    }
    return exitCode
}

private fun readInstallMetadata(runtimeDir: File): String? {
    val metadataFile = File(runtimeDir, INSTALL_METADATA_FILE)
    if (!metadataFile.isFile) return null
    return runCatching {
        adapterMetadataJson.decodeFromString<InstallMetadata>(metadataFile.readText()).version.trim()
    }.getOrNull()?.takeIf { it.isNotEmpty() }
}

private fun deleteDirectoryWithRetries(dir: File, attempts: Int = 3): Boolean {
    repeat(attempts) { attempt ->
        if (!dir.exists()) return true
        if (dir.deleteRecursively() && !dir.exists()) return true
        if (attempt < attempts - 1) Thread.sleep(250)
    }
    return !dir.exists()
}
