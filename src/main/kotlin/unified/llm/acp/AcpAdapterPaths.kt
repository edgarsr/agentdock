package unified.llm.acp

import java.io.File
import java.util.concurrent.TimeUnit
import java.util.logging.Logger
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Adapter runtimes are downloaded at runtime to ~/.unified-llm/dependencies/<adapter-name>/.
 * Supported distribution types:
 * - archive: download and extract a platform archive into the adapter directory
 * - npm: install package into the adapter directory and run its launch path
 */
object AcpAdapterPaths {
    private const val ADAPTER_NAME_OVERRIDE_PROPERTY = "unified.llm.acp.adapter.name"
    private const val DEFAULT_NPM_LAUNCH_PATH = "dist/index.js"
    private const val ARCHIVE_COMMAND_TIMEOUT_MINUTES = 10L
    private const val INSTALL_METADATA_FILE = ".install-metadata.json"
    private val metadataJson = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val logger = Logger.getLogger(AcpAdapterPaths::class.java.name)

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

    fun getAdapterInfo(adapterName: String? = null): AcpAdapterConfig.AdapterInfo {
        val resolvedName = resolveAdapterName(adapterName)
        return try {
            AcpAdapterConfig.getAdapterInfo(resolvedName)
        } catch (e: Exception) {
            throw IllegalStateException("ACP adapter '$resolvedName' not found in configuration.", e)
        }
    }

    private fun currentTarget(): AcpExecutionTarget = AcpExecutionMode.currentTarget()

    fun getBaseRuntimeDir(): File {
        val dir = AcpExecutionMode.localBaseRuntimeDir()
        dir.mkdirs()
        return dir
    }

    fun getDependenciesDir(): File {
        val dir = AcpExecutionMode.localDependenciesDir()
        dir.mkdirs()
        return dir
    }

    internal fun getExecutionTarget(): AcpExecutionTarget = currentTarget()

    internal fun getTargetDependenciesPath(
        target: AcpExecutionTarget = currentTarget(),
        wslHomeDirOverride: String? = null
    ): String? {
        return when (target) {
            AcpExecutionTarget.LOCAL -> getDependenciesDir().absolutePath
            AcpExecutionTarget.WSL -> {
                val base = wslBaseRuntimeDir(wslHomeDirOverride) ?: return null
                "$base/dependencies"
            }
        }
    }

    internal fun getDownloadPath(
        adapterName: String? = null,
        target: AcpExecutionTarget = currentTarget(),
        wslHomeDirOverride: String? = null
    ): String {
        val adapterInfo = getAdapterInfo(adapterName)
        return when (target) {
            AcpExecutionTarget.LOCAL -> File(getDependenciesDir(), adapterInfo.id).absolutePath
            AcpExecutionTarget.WSL -> {
                val depsPath = getTargetDependenciesPath(target, wslHomeDirOverride)
                    ?: throw IllegalStateException("Unable to resolve WSL dependencies path for adapter '${adapterInfo.id}'")
                "$depsPath/${adapterInfo.id}"
            }
        }
    }

    internal fun installedVersion(
        adapterName: String? = null,
        target: AcpExecutionTarget = currentTarget(),
        wslHomeDirOverride: String? = null,
        distroNameOverride: String? = null
    ): String? {
        val adapterInfo = getAdapterInfo(adapterName)
        return when (target) {
            AcpExecutionTarget.LOCAL -> installedVersionFromRuntimeDir(
                runtimeDir = File(getDependenciesDir(), adapterInfo.id),
                adapterInfo = adapterInfo,
                target = target
            )
            AcpExecutionTarget.WSL -> {
                val runtimeDir = wslPathToWindowsFile(
                    getDownloadPath(adapterInfo.id, target, wslHomeDirOverride),
                    distroNameOverride
                ) ?: return null
                installedVersionFromRuntimeDir(runtimeDir, adapterInfo, target)
            }
        }
    }

    internal fun isDownloaded(
        adapterName: String? = null,
        target: AcpExecutionTarget = currentTarget(),
        wslHomeDirOverride: String? = null,
        distroNameOverride: String? = null
    ): Boolean {
        val adapterInfo = getAdapterInfo(adapterName)
        return when (target) {
            AcpExecutionTarget.LOCAL -> {
                val runtimeDir = File(getDependenciesDir(), adapterInfo.id)
                if (!runtimeDir.isDirectory) return false
                when (adapterInfo.distribution.type) {
                    AcpAdapterConfig.DistributionType.ARCHIVE -> resolveLaunchFile(runtimeDir, adapterInfo, target)?.isFile == true
                    AcpAdapterConfig.DistributionType.NPM -> {
                        File(runtimeDir, "node_modules").isDirectory && resolveLaunchFile(runtimeDir, adapterInfo, target)?.isFile == true
                    }
                }
            }
            AcpExecutionTarget.WSL -> {
                val runtimeDir = getDownloadPath(adapterInfo.id, target, wslHomeDirOverride)
                val runtimeDirFile = wslPathToWindowsFile(runtimeDir, distroNameOverride)
                if (runtimeDirFile == null) return false
                if (!runtimeDirFile.isDirectory) return false
                val launchPath = resolveLaunchPath(runtimeDir, adapterInfo, target)
                if (launchPath == null) return false
                val launchFile = wslPathToWindowsFile(launchPath, distroNameOverride)
                if (launchFile == null) return false
                when (adapterInfo.distribution.type) {
                    AcpAdapterConfig.DistributionType.ARCHIVE -> launchFile.isFile
                    AcpAdapterConfig.DistributionType.NPM -> File(runtimeDirFile, "node_modules").isDirectory && launchFile.isFile
                }
            }
        }
    }

    internal fun deleteAdapter(adapterName: String? = null, target: AcpExecutionTarget = currentTarget()): Boolean {
        val adapterInfo = getAdapterInfo(adapterName)
        return when (target) {
            AcpExecutionTarget.LOCAL -> {
                val runtimeDir = File(getDependenciesDir(), adapterInfo.id)
                try {
                    if (runtimeDir.exists()) runtimeDir.deleteRecursively()
                    true
                } catch (_: Exception) {
                    false
                }
            }
            AcpExecutionTarget.WSL -> {
                val runtimeDir = getDownloadPath(adapterInfo.id, target)
                AcpExecutionMode.runWslShell("rm -rf ${quoteUnixShellArg(runtimeDir)}")?.exitCode == 0
            }
        }
    }

    suspend fun getAdapterRoot(adapterName: String? = null): File? {
        val adapterInfo = getAdapterInfo(adapterName)
        val runtimeDir = File(getDependenciesDir(), adapterInfo.id)
        return if (isDownloaded(adapterName, AcpExecutionTarget.LOCAL)) runtimeDir else null
    }

    fun applyPatches(adapterRoot: File, adapterInfo: AcpAdapterConfig.AdapterInfo, statusCallback: ((String) -> Unit)? = null) {
        val patchRoot = resolvePatchRoot(adapterRoot, adapterInfo)
        for (patchContent in adapterInfo.patches) {
            statusCallback?.invoke("Applying patch...")
            AcpPatchService.applyPatch(patchRoot, patchContent)
        }
    }

    internal fun ensurePatched(adapterName: String? = null, target: AcpExecutionTarget = currentTarget()) {
        val adapterInfo = getAdapterInfo(adapterName)
        when (target) {
            AcpExecutionTarget.LOCAL -> {
                val runtimeDir = File(getDependenciesDir(), adapterInfo.id)
                if (runtimeDir.isDirectory) applyPatches(runtimeDir, adapterInfo)
            }
            AcpExecutionTarget.WSL -> {
                val runtimeDir = getDownloadPath(adapterInfo.id, target)
                if (isDownloaded(adapterInfo.id, target)) applyWslPatches(runtimeDir, adapterInfo)
            }
        }
    }

    internal fun installAdapterRuntime(
        targetDir: File,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        statusCallback: ((String) -> Unit)? = null,
        target: AcpExecutionTarget = currentTarget(),
        versionOverride: String? = null
    ): Boolean {
        val baseAdapterInfo = versionOverride?.trim()?.takeIf { it.isNotEmpty() }?.let {
            adapterInfo.withDistributionVersion(it)
        } ?: adapterInfo
        val resolvedAdapterInfo = resolveInstallAdapterInfo(baseAdapterInfo, statusCallback) ?: return false
        return when (target) {
            AcpExecutionTarget.LOCAL -> {
                prepareTargetDir(targetDir)
                val success = when (resolvedAdapterInfo.distribution.type) {
                    AcpAdapterConfig.DistributionType.ARCHIVE -> downloadArchiveDistribution(targetDir, resolvedAdapterInfo, statusCallback)
                    AcpAdapterConfig.DistributionType.NPM -> downloadFromNpm(targetDir, resolvedAdapterInfo, statusCallback)
                }
                if (!success) return false
                applyPatches(targetDir, resolvedAdapterInfo, statusCallback)
                val downloaded = isDownloaded(resolvedAdapterInfo.id, target)
                if (downloaded) writeInstallMetadata(targetDir, resolvedAdapterInfo.distribution.version)
                downloaded
            }
            AcpExecutionTarget.WSL -> {
                val runtimeDir = getDownloadPath(resolvedAdapterInfo.id, target)
                val success = when (resolvedAdapterInfo.distribution.type) {
                    AcpAdapterConfig.DistributionType.ARCHIVE -> downloadArchiveDistributionWsl(runtimeDir, resolvedAdapterInfo, statusCallback)
                    AcpAdapterConfig.DistributionType.NPM -> downloadFromNpmWsl(runtimeDir, resolvedAdapterInfo, statusCallback)
                }
                if (!success) return false
                applyWslPatches(runtimeDir, resolvedAdapterInfo, statusCallback)
                val downloaded = isDownloaded(resolvedAdapterInfo.id, target)
                if (downloaded) {
                    val runtimeDirFile = wslPathToWindowsFile(runtimeDir)
                        ?: throw IllegalStateException("Unable to resolve WSL runtime dir")
                    writeInstallMetadata(runtimeDirFile, resolvedAdapterInfo.distribution.version)
                }
                downloaded
            }
        }
    }

    private fun resolveInstallAdapterInfo(
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

    fun downloadFromNpm(targetDir: File, adapterInfo: AcpAdapterConfig.AdapterInfo, statusCallback: ((String) -> Unit)? = null): Boolean {
        return try {
            if (!requireLocalCommand("node", "Node.js is required", statusCallback)) return false
            if (!requireLocalCommand("npm", "Node.js is required", statusCallback)) return false

            val packageName = adapterInfo.distribution.packageName
                ?: throw IllegalStateException("Adapter '${adapterInfo.id}' missing distribution.packageName in configuration")
            val version = adapterInfo.distribution.version

            statusCallback?.invoke("Installing $packageName@$version via npm...")
            File(targetDir, "package.json").writeText("""{"name":"${adapterInfo.id}-runtime","private":true}""")

            val npm = if (System.getProperty("os.name").lowercase().contains("win")) "npm.cmd" else "npm"
            val installProc = ProcessBuilder(npm, "install", "$packageName@$version", "--no-save", "--no-package-lock")
                .directory(targetDir)
                .redirectErrorStream(true)
                .start()

            installProc.inputStream.bufferedReader().use { reader ->
                var line: String?
                while (reader.readLine().also { line = it } != null) {
                    if (line!!.contains("added", ignoreCase = true)
                        || line!!.contains("tarball", ignoreCase = true)
                        || line!!.contains("install", ignoreCase = true)
                    ) {
                        statusCallback?.invoke("NPM: $line")
                    }
                }
            }

            installProc.waitFor() == 0
        } catch (_: Exception) {
            false
        }
    }

    fun downloadFromNpmWsl(
        targetDir: String,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        statusCallback: ((String) -> Unit)? = null
    ): Boolean {
        if (!requireWslCommand("node --version", "Linux Node.js runtime is required in WSL", statusCallback)) return false
        if (!requireWslCommand("npm --version", "Linux npm is required in WSL", statusCallback)) return false

        val packageName = adapterInfo.distribution.packageName
            ?: throw IllegalStateException("Adapter '${adapterInfo.id}' missing distribution.packageName in configuration")
        val version = adapterInfo.distribution.version
        statusCallback?.invoke("Installing $packageName@$version via npm in WSL...")
        val script = """
            set -e
            rm -rf ${quoteUnixShellArg(targetDir)}
            mkdir -p ${quoteUnixShellArg(targetDir)}
            cd ${quoteUnixShellArg(targetDir)}
            cat > package.json <<EOF
            {"name":"${adapterInfo.id}-runtime","private":true}
            EOF
            npm install ${quoteUnixShellArg("$packageName@$version")} --no-save --no-package-lock
        """.trimIndent()
        val result = AcpExecutionMode.runWslShell(script, timeoutSeconds = ARCHIVE_COMMAND_TIMEOUT_MINUTES * 60)
        if (result?.exitCode != 0) {
            statusCallback?.invoke("Error: ${result?.stderr?.trim().orEmpty().ifBlank { result?.stdout?.trim().orEmpty().ifBlank { "npm install failed in WSL" } }}")
            return false
        }
        return true
    }

    fun downloadArchiveDistribution(
        targetDir: File,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        statusCallback: ((String) -> Unit)? = null
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

        try {
            statusCallback?.invoke("Downloading ${adapterInfo.name}...")

            if (runtime.platform == "windows") {
                statusCallback?.invoke("Downloading package...")
                val dlExitCode = runCommand(
                    ProcessBuilder(
                        "powershell",
                        "-NoProfile",
                        "-NonInteractive",
                        "-Command",
                        "\$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri '$downloadUrl' -OutFile '${tempFile.absolutePath}'"
                    ),
                    statusCallback
                )
                if (dlExitCode != 0) return false

                statusCallback?.invoke("Extracting package...")
                val extractExitCode = runCommand(
                    ProcessBuilder(
                        "powershell",
                        "-NoProfile",
                        "-NonInteractive",
                        "-Command",
                        "\$ProgressPreference = 'SilentlyContinue'; Expand-Archive -Path '${tempFile.absolutePath}' -DestinationPath '${targetDir.absolutePath}' -Force"
                    ),
                    statusCallback
                )
                if (extractExitCode != 0) return false
            } else {
                statusCallback?.invoke("Downloading and extracting package...")
                val exitCode = runCommand(
                    ProcessBuilder(
                        "sh",
                        "-c",
                        """
                        set -e
                        temp_file='${targetDir.absolutePath}/tool-download.${runtime.archiveExt}'
                        curl -fSL '$downloadUrl' -o "${'$'}temp_file"
                        first_entry=${'$'}(tar -tzf "${'$'}temp_file" | sed -n '1p')
                        case "${'$'}first_entry" in
                          */*) tar --strip-components=1 -xzf "${'$'}temp_file" -C '${targetDir.absolutePath}' ;;
                          *) tar -xzf "${'$'}temp_file" -C '${targetDir.absolutePath}' ;;
                        esac
                        rm -f "${'$'}temp_file"
                        """.trimIndent()
                    ),
                    statusCallback
                )
                if (exitCode != 0) return false

                statusCallback?.invoke("Ensuring executables...")
                targetDir.listFiles()?.filter { !it.isDirectory }?.forEach { it.setExecutable(true) }
            }

            flattenConfiguredExtractSubdir(targetDir, adapterInfo)
            tempFile.delete()
            statusCallback?.invoke("${adapterInfo.name} installed successfully.")
            return true
        } catch (e: Exception) {
            statusCallback?.invoke("Error: ${e.message}")
            return false
        }
    }

    fun downloadArchiveDistributionWsl(
        targetDir: String,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        statusCallback: ((String) -> Unit)? = null
    ): Boolean {
        val runtime = detectRuntimePlatform(AcpExecutionTarget.WSL)
        val rawUrl = adapterInfo.distribution.downloadUrl
        if (rawUrl == null) {
            statusCallback?.invoke("Error: Archive distribution for '${adapterInfo.id}' has no downloadUrl configured")
            return false
        }
        val downloadUrl = resolveArchiveDownloadUrl(rawUrl, adapterInfo, runtime)
        val tempFile = "$targetDir/tool-download.${runtime.archiveExt}"
        val script = """
            set -e
            rm -rf ${quoteUnixShellArg(targetDir)}
            mkdir -p ${quoteUnixShellArg(targetDir)}
            curl -fSL ${quoteUnixShellArg(downloadUrl)} -o ${quoteUnixShellArg(tempFile)}
            first_entry=${'$'}(tar -tzf ${quoteUnixShellArg(tempFile)} | sed -n '1p')
            case "${'$'}first_entry" in
              */*) tar --strip-components=1 -xzf ${quoteUnixShellArg(tempFile)} -C ${quoteUnixShellArg(targetDir)} ;;
              *) tar -xzf ${quoteUnixShellArg(tempFile)} -C ${quoteUnixShellArg(targetDir)} ;;
            esac
            ${buildFlattenExtractSubdirScript(targetDir, adapterInfo.distribution.extractSubdir)}
            rm -f ${quoteUnixShellArg(tempFile)}
        """.trimIndent()
        statusCallback?.invoke("Downloading ${adapterInfo.name} in WSL...")
        val result = AcpExecutionMode.runWslShell(script, timeoutSeconds = ARCHIVE_COMMAND_TIMEOUT_MINUTES * 60)
        if (result?.exitCode != 0) {
            statusCallback?.invoke("Error: ${result?.stderr?.trim().orEmpty().ifBlank { "Download failed" }}")
            return false
        }
        statusCallback?.invoke("${adapterInfo.name} installed successfully.")
        return true
    }

    fun resolveAdapterName(adapterName: String?): String {
        val explicit = adapterName?.trim().takeUnless { it.isNullOrEmpty() }
        if (explicit != null) return explicit
        val override = System.getProperty(ADAPTER_NAME_OVERRIDE_PROPERTY)?.trim()
        if (!override.isNullOrEmpty()) return override
        throw IllegalStateException("ACP adapter name is required. Provide it explicitly or set system property '$ADAPTER_NAME_OVERRIDE_PROPERTY'.")
    }

    internal fun resolveLaunchFile(
        adapterRoot: File,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        target: AcpExecutionTarget = currentTarget()
    ): File? {
        if (target == AcpExecutionTarget.WSL) return null
        return when (adapterInfo.distribution.type) {
            AcpAdapterConfig.DistributionType.ARCHIVE -> {
                val binName = adapterInfo.distribution.binaryName?.win
                if (binName.isNullOrBlank()) null else File(adapterRoot, binName)
            }
            AcpAdapterConfig.DistributionType.NPM -> {
                val launchPath = resolveNpmLaunchRelativePath(adapterInfo, target)
                File(adapterRoot, launchPath.replace("/", File.separator).replace("\\", File.separator))
            }
        }
    }

    internal fun resolveLaunchPath(
        adapterRootPath: String,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        target: AcpExecutionTarget = currentTarget()
    ): String? {
        return when (adapterInfo.distribution.type) {
            AcpAdapterConfig.DistributionType.ARCHIVE -> {
                val binName = if (target == AcpExecutionTarget.WSL) adapterInfo.distribution.binaryName?.unix else adapterInfo.distribution.binaryName?.win
                binName?.takeIf { it.isNotBlank() }?.let { joinPath(adapterRootPath, it, target) }
            }
            AcpAdapterConfig.DistributionType.NPM -> {
                val launchPath = resolveNpmLaunchRelativePath(adapterInfo, target)
                joinPath(adapterRootPath, launchPath, target)
            }
        }
    }

    internal fun buildLaunchCommand(
        adapterRootPath: String,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        projectPath: String? = null,
        target: AcpExecutionTarget = currentTarget()
    ): List<String> {
        val launchPath = resolveLaunchPath(adapterRootPath, adapterInfo, target)
            ?: throw IllegalStateException("Missing launch target for adapter '${adapterInfo.id}'")
        return when (target) {
            AcpExecutionTarget.LOCAL -> {
                val launchFile = File(launchPath)
                val name = launchFile.name.lowercase()
                val base = when {
                    name.endsWith(".cmd") || name.endsWith(".bat") -> mutableListOf("cmd.exe", "/c", launchFile.absolutePath)
                    name.endsWith(".ps1") -> mutableListOf("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", launchFile.absolutePath)
                    name.endsWith(".js") || name.endsWith(".mjs") -> mutableListOf("node.exe", launchFile.absolutePath)
                    else -> mutableListOf(launchFile.absolutePath)
                }
                base.addAll(adapterInfo.args)
                base
            }
            AcpExecutionTarget.WSL -> {
                val base = when {
                    launchPath.endsWith(".js") || launchPath.endsWith(".mjs") -> mutableListOf("node", launchPath)
                    else -> mutableListOf(launchPath)
                }
                base.addAll(adapterInfo.args)
                AcpExecutionMode.buildWslExecCommand(base, AcpExecutionMode.toWslPath(projectPath) ?: adapterRootPath)
            }
        }
    }

    private fun prepareTargetDir(targetDir: File) {
        if (targetDir.exists()) targetDir.deleteRecursively()
        targetDir.mkdirs()
    }

    private fun resolvePatchRoot(adapterRoot: File, adapterInfo: AcpAdapterConfig.AdapterInfo): File {
        return when (adapterInfo.distribution.type) {
            AcpAdapterConfig.DistributionType.ARCHIVE -> adapterRoot
            AcpAdapterConfig.DistributionType.NPM -> resolveNpmPackageRoot(adapterRoot, adapterInfo)
        }
    }

    private fun resolveNpmPackageRoot(adapterRoot: File, adapterInfo: AcpAdapterConfig.AdapterInfo): File {
        val packageName = adapterInfo.distribution.packageName
            ?: throw IllegalStateException("Adapter '${adapterInfo.id}' missing distribution.packageName in configuration")
        return File(adapterRoot, "node_modules${File.separator}$packageName")
    }

    private fun resolveNpmPackageRootPath(adapterRootPath: String, adapterInfo: AcpAdapterConfig.AdapterInfo, target: AcpExecutionTarget): String {
        val packageName = adapterInfo.distribution.packageName
            ?: throw IllegalStateException("Adapter '${adapterInfo.id}' missing distribution.packageName in configuration")
        return joinPath(adapterRootPath, "node_modules/$packageName", target)
    }

    private fun resolveNpmLaunchRelativePath(
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        target: AcpExecutionTarget
    ): String {
        val launchBinary = if (target == AcpExecutionTarget.WSL) {
            adapterInfo.launchBinary?.unix
        } else {
            adapterInfo.launchBinary?.win
        }?.trim().orEmpty()
        if (launchBinary.isNotEmpty()) return launchBinary

        val launchPath = adapterInfo.launchPath.ifBlank { DEFAULT_NPM_LAUNCH_PATH }
        val packageRoot = "node_modules/${adapterInfo.distribution.packageName ?: throw IllegalStateException("Adapter '${adapterInfo.id}' missing distribution.packageName in configuration")}"
        return "$packageRoot/$launchPath"
    }

    private fun detectRuntimePlatform(target: AcpExecutionTarget): RuntimePlatform {
        val os = if (target == AcpExecutionTarget.WSL) "linux" else System.getProperty("os.name").lowercase()
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

    private fun resolveArchiveDownloadUrl(template: String, adapterInfo: AcpAdapterConfig.AdapterInfo, runtime: RuntimePlatform): String {
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

    private fun runCommand(builder: ProcessBuilder, statusCallback: ((String) -> Unit)? = null): Int {
        val process = builder.redirectErrorStream(true).start()
        val outputDrainer = Thread {
            process.inputStream.bufferedReader().useLines { lines ->
                lines.forEach { line -> if (line.isNotBlank()) statusCallback?.invoke(line.trim()) }
            }
        }
        outputDrainer.isDaemon = true
        outputDrainer.start()

        val finished = process.waitFor(ARCHIVE_COMMAND_TIMEOUT_MINUTES, TimeUnit.MINUTES)
        if (!finished) {
            process.destroyForcibly()
            outputDrainer.join(1000)
            statusCallback?.invoke("Error: Command timed out")
            return -1
        }

        outputDrainer.join(1000)
        return process.exitValue()
    }

    private fun applyWslPatches(
        adapterRootPath: String,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        statusCallback: ((String) -> Unit)? = null
    ) {
        val patchRoot = when (adapterInfo.distribution.type) {
            AcpAdapterConfig.DistributionType.ARCHIVE -> adapterRootPath
            AcpAdapterConfig.DistributionType.NPM -> resolveNpmPackageRootPath(adapterRootPath, adapterInfo, AcpExecutionTarget.WSL)
        }
        val patchRootFile = wslPathToWindowsFile(patchRoot)
            ?: throw IllegalStateException("Unable to resolve WSL patch root")
        adapterInfo.patches.forEach { patchContent ->
            statusCallback?.invoke("Applying patch...")
            val applied = AcpPatchService.applyPatch(patchRootFile, patchContent)
            if (!applied) throw IllegalStateException("Failed to apply patch in WSL")
        }
    }

    private fun requireLocalCommand(commandName: String, errorMessage: String, statusCallback: ((String) -> Unit)? = null): Boolean {
        val executable = when {
            System.getProperty("os.name").lowercase().contains("win") && commandName.equals("npm", ignoreCase = true) -> "npm.cmd"
            System.getProperty("os.name").lowercase().contains("win") && commandName.equals("npx", ignoreCase = true) -> "npx.cmd"
            System.getProperty("os.name").lowercase().contains("win") && commandName.equals("node", ignoreCase = true) -> "node.exe"
            else -> commandName
        }
        return try {
            val process = ProcessBuilder(executable, "--version")
                .redirectErrorStream(true)
                .start()
            val finished = process.waitFor(15, TimeUnit.SECONDS)
            if (!finished) {
                process.destroyForcibly()
                statusCallback?.invoke("Error: $errorMessage")
                return false
            }
            if (process.exitValue() == 0) {
                true
            } else {
                statusCallback?.invoke("Error: $errorMessage")
                false
            }
        } catch (_: Exception) {
            statusCallback?.invoke("Error: $errorMessage")
            false
        }
    }

    private fun requireWslCommand(validationCommand: String, errorMessage: String, statusCallback: ((String) -> Unit)? = null): Boolean {
        val result = AcpExecutionMode.runWslShell(validationCommand, timeoutSeconds = 15)
        if (result?.exitCode == 0) return true
        val detail = result?.stderr?.trim().orEmpty().ifBlank { result?.stdout?.trim().orEmpty() }
        statusCallback?.invoke(if (detail.isBlank()) "Error: $errorMessage" else "Error: $errorMessage. $detail")
        return false
    }

    private fun buildFlattenExtractSubdirScript(targetDir: String, extractSubdir: String?): String {
        val normalized = extractSubdir?.trim()?.removePrefix("/")?.removeSuffix("/").orEmpty()
        if (normalized.isBlank()) return ":"
        val nestedDir = "${targetDir.trimEnd('/')}/$normalized"
        return """
            if [ -d ${quoteUnixShellArg(nestedDir)} ]; then
              find ${quoteUnixShellArg(nestedDir)} -mindepth 1 -maxdepth 1 -exec mv {} ${quoteUnixShellArg(targetDir)}/ \;
              rm -rf ${quoteUnixShellArg(nestedDir)}
            fi
        """.trimIndent()
    }

    private fun joinPath(base: String, relative: String, target: AcpExecutionTarget): String {
        val separator = if (target == AcpExecutionTarget.WSL) "/" else File.separator
        val normalizedRelative = if (target == AcpExecutionTarget.WSL) {
            relative.replace("\\", "/")
        } else {
            relative.replace("/", File.separator).replace("\\", File.separator)
        }
        return if (base.endsWith(separator)) base + normalizedRelative else base + separator + normalizedRelative
    }

    private fun wslBaseRuntimeDir(wslHomeDirOverride: String? = null): String? {
        val homeDir = wslHomeDirOverride ?: AcpExecutionMode.wslHomeDir() ?: return null
        return "${homeDir}/.unified-llm"
    }

    private fun wslPathToWindowsFile(wslPath: String, distroNameOverride: String? = null): File? {
        val uncPath = AcpExecutionMode.wslPathToWindowsUnc(wslPath, distroNameOverride) ?: return null
        return File(uncPath)
    }

    private fun installedVersionFromRuntimeDir(
        runtimeDir: File,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        target: AcpExecutionTarget
    ): String? {
        if (!runtimeDir.isDirectory) return null
        return when (adapterInfo.distribution.type) {
            AcpAdapterConfig.DistributionType.NPM -> {
                val packageJson = File(resolveNpmPackageRoot(runtimeDir, adapterInfo), "package.json")
                runCatching {
                    metadataJson.parseToJsonElement(packageJson.readText()).jsonObject["version"]?.toString()?.trim('"')
                }.getOrNull()?.takeIf { it.isNotBlank() }
            }
            AcpAdapterConfig.DistributionType.ARCHIVE -> {
                readInstallMetadata(runtimeDir)
            }
        }
    }

    private fun readInstallMetadata(runtimeDir: File): String? {
        val metadataFile = File(runtimeDir, INSTALL_METADATA_FILE)
        if (!metadataFile.isFile) return null
        return runCatching {
            metadataJson.decodeFromString<InstallMetadata>(metadataFile.readText()).version.trim()
        }.getOrNull()?.takeIf { it.isNotEmpty() }
    }

    private fun writeInstallMetadata(runtimeDir: File, version: String) {
        runtimeDir.mkdirs()
        File(runtimeDir, INSTALL_METADATA_FILE).writeText(
            metadataJson.encodeToString(InstallMetadata(version.trim()))
        )
    }
}
