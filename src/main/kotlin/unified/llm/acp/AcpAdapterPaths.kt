package unified.llm.acp

import java.io.File

/**
 * Adapter runtimes are downloaded at runtime to ~/.unified-llm/dependencies/<adapter-name>/.
 * Supported distribution types:
 * - archive: download and extract a platform archive into the adapter directory
 * - npm: install package into the adapter directory and run its launch path
 *
 * System property "unified.llm.acp.adapter.name" can provide the adapter when
 * an explicit adapter name is not provided.
 */
object AcpAdapterPaths {
    private const val ADAPTER_NAME_OVERRIDE_PROPERTY = "unified.llm.acp.adapter.name"
    private const val DEFAULT_NPM_LAUNCH_PATH = "dist/index.js"

    private data class RuntimePlatform(
        val platform: String,
        val archiveArch: String,
        val archiveExt: String,
        val target: String,
        val libc: String,
        val libcSuffix: String
    )

    /**
     * Gets adapter metadata from configuration.
     * Explicit adapter name wins; otherwise a system property override may provide the adapter.
     */
    fun getAdapterInfo(adapterName: String? = null): AcpAdapterConfig.AdapterInfo {
        val resolvedName = resolveAdapterName(adapterName)
        return try {
            AcpAdapterConfig.getAdapterInfo(resolvedName)
        } catch (e: Exception) {
            throw IllegalStateException("ACP adapter '$resolvedName' not found in configuration.", e)
        }
    }

    /**
     * Base directory for all unified-llm runtime data.
     */
    private val BASE_RUNTIME_DIR = File(System.getProperty("user.home"), ".unified-llm")

    /**
     * Directory for dependencies (adapters and CLI tools). Each dependency gets its own subdirectory.
     */
    private val DEPENDENCIES_DIR = File(BASE_RUNTIME_DIR, "dependencies")

    /**
     * Returns the base runtime directory (~/.unified-llm).
     * Can be used for storing other plugin data.
     */
    fun getBaseRuntimeDir(): File {
        BASE_RUNTIME_DIR.mkdirs()
        return BASE_RUNTIME_DIR
    }

    /**
     * Returns the dependencies directory (~/.unified-llm/dependencies).
     */
    fun getDependenciesDir(): File {
        DEPENDENCIES_DIR.mkdirs()
        return DEPENDENCIES_DIR
    }

    /**
     * Returns the absolute path where the adapter is installed.
     */
    fun getDownloadPath(adapterName: String? = null): String {
        val adapterInfo = getAdapterInfo(adapterName)
        return File(DEPENDENCIES_DIR, adapterInfo.id).absolutePath
    }

    /**
     * Checks if the adapter runtime is currently installed and launchable.
     */
    fun isDownloaded(adapterName: String? = null): Boolean {
        val adapterInfo = getAdapterInfo(adapterName)
        val runtimeDir = File(DEPENDENCIES_DIR, adapterInfo.id)
        if (!runtimeDir.isDirectory) return false

        return when (adapterInfo.distribution.type) {
            AcpAdapterConfig.DistributionType.ARCHIVE -> resolveLaunchFile(runtimeDir, adapterInfo)?.isFile == true
            AcpAdapterConfig.DistributionType.NPM -> {
                File(runtimeDir, "node_modules").isDirectory && resolveLaunchFile(runtimeDir, adapterInfo)?.isFile == true
            }
        }
    }

    /**
     * Deletes the adapter directory from disk.
     */
    fun deleteAdapter(adapterName: String? = null): Boolean {
        val adapterInfo = getAdapterInfo(adapterName)
        val runtimeDir = File(DEPENDENCIES_DIR, adapterInfo.id)

        return try {
            if (runtimeDir.exists()) {
                runtimeDir.deleteRecursively()
            }
            true
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Returns the adapter root directory.
     * Does not download automatically.
     */
    suspend fun getAdapterRoot(adapterName: String? = null): File? {
        val adapterInfo = getAdapterInfo(adapterName)
        val runtimeDir = File(DEPENDENCIES_DIR, adapterInfo.id)
        return if (isDownloaded(adapterName)) runtimeDir else null
    }

    fun applyPatches(adapterRoot: File, adapterInfo: AcpAdapterConfig.AdapterInfo, statusCallback: ((String) -> Unit)? = null) {
        val patchRoot = resolvePatchRoot(adapterRoot, adapterInfo)
        for (patchContent in adapterInfo.patches) {
            statusCallback?.invoke("Applying patch...")
            AcpPatchService.applyPatch(patchRoot, patchContent)
        }
    }

    fun installAdapterRuntime(
        targetDir: File,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        statusCallback: ((String) -> Unit)? = null
    ): Boolean {
        prepareTargetDir(targetDir)

        val success = when (adapterInfo.distribution.type) {
            AcpAdapterConfig.DistributionType.ARCHIVE -> downloadArchiveDistribution(targetDir, adapterInfo, statusCallback)
            AcpAdapterConfig.DistributionType.NPM -> downloadFromNpm(targetDir, adapterInfo, statusCallback)
        }

        if (!success) {
            return false
        }

        applyPatches(targetDir, adapterInfo, statusCallback)
        return isDownloaded(adapterInfo.id)
    }

    fun downloadFromNpm(targetDir: File, adapterInfo: AcpAdapterConfig.AdapterInfo, statusCallback: ((String) -> Unit)? = null): Boolean {
        return try {
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

    fun downloadArchiveDistribution(
        targetDir: File,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        statusCallback: ((String) -> Unit)? = null
    ): Boolean {
        val runtime = detectRuntimePlatform()
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
                val dlExitCode = ProcessBuilder(
                    "powershell",
                    "-Command",
                    "Invoke-WebRequest -Uri '$downloadUrl' -OutFile '${tempFile.absolutePath}'"
                ).start().waitFor()
                if (dlExitCode != 0) {
                    return false
                }

                statusCallback?.invoke("Extracting package...")
                val extractExitCode = ProcessBuilder(
                    "powershell",
                    "-Command",
                    "Expand-Archive -Path '${tempFile.absolutePath}' -DestinationPath '${targetDir.absolutePath}' -Force"
                ).start().waitFor()
                if (extractExitCode != 0) {
                    return false
                }
            } else {
                statusCallback?.invoke("Downloading and extracting package...")
                val exitCode = ProcessBuilder(
                    "sh",
                    "-c",
                    "curl -fSL '$downloadUrl' | tar --strip-components=1 -xzf - -C '${targetDir.absolutePath}' || curl -fSL '$downloadUrl' | tar -xzf - -C '${targetDir.absolutePath}'"
                ).start().waitFor()
                if (exitCode != 0) {
                    return false
                }

                statusCallback?.invoke("Ensuring executables...")
                targetDir.listFiles()?.filter { !it.isDirectory }?.forEach {
                    it.setExecutable(true)
                }
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

    fun resolveAdapterName(adapterName: String?): String {
        val explicit = adapterName?.trim().takeUnless { it.isNullOrEmpty() }
        if (explicit != null) return explicit
        val override = System.getProperty(ADAPTER_NAME_OVERRIDE_PROPERTY)?.trim()
        if (!override.isNullOrEmpty()) return override
        throw IllegalStateException(
            "ACP adapter name is required. " +
                "Provide it explicitly or set system property '$ADAPTER_NAME_OVERRIDE_PROPERTY'."
        )
    }

    fun resolveLaunchFile(adapterRoot: File, adapterInfo: AcpAdapterConfig.AdapterInfo): File? {
        return when (adapterInfo.distribution.type) {
            AcpAdapterConfig.DistributionType.ARCHIVE -> {
                val os = System.getProperty("os.name").lowercase()
                val binName = if (os.contains("win")) {
                    adapterInfo.distribution.binaryName?.win
                } else {
                    adapterInfo.distribution.binaryName?.unix
                }
                if (binName.isNullOrBlank()) null else File(adapterRoot, binName)
            }
            AcpAdapterConfig.DistributionType.NPM -> {
                val launchPath = adapterInfo.launchPath.ifBlank { DEFAULT_NPM_LAUNCH_PATH }
                File(resolveNpmPackageRoot(adapterRoot, adapterInfo), launchPath)
            }
        }
    }

    fun buildLaunchCommand(adapterRoot: File, adapterInfo: AcpAdapterConfig.AdapterInfo): List<String> {
        val launchFile = resolveLaunchFile(adapterRoot, adapterInfo)
            ?: throw IllegalStateException("Missing launch target for adapter '${adapterInfo.id}'")
        val os = System.getProperty("os.name").lowercase()
        val name = launchFile.name.lowercase()

        return when {
            os.contains("win") && (name.endsWith(".cmd") || name.endsWith(".bat")) ->
                listOf("cmd.exe", "/c", launchFile.absolutePath)
            os.contains("win") && name.endsWith(".ps1") ->
                listOf("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", launchFile.absolutePath)
            name.endsWith(".js") || name.endsWith(".mjs") -> {
                val nodeCmd = if (os.contains("win")) "node.exe" else "node"
                listOf(nodeCmd, launchFile.absolutePath)
            }
            else -> listOf(launchFile.absolutePath)
        }
    }

    private fun prepareTargetDir(targetDir: File) {
        if (targetDir.exists()) {
            targetDir.deleteRecursively()
        }
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

    private fun detectRuntimePlatform(): RuntimePlatform {
        val os = System.getProperty("os.name").lowercase()
        val arch = System.getProperty("os.arch").lowercase()

        val isArm64 = arch.contains("aarch64") || arch.contains("arm64")
        val archiveArch = if (isArm64) "arm64" else "x64"
        val targetArch = if (isArm64) "aarch64" else "x86_64"

        return when {
            os.contains("win") -> RuntimePlatform(
                platform = "windows",
                archiveArch = archiveArch,
                archiveExt = "zip",
                target = "$targetArch-pc-windows-msvc",
                libc = "msvc",
                libcSuffix = ""
            )
            os.contains("mac") -> RuntimePlatform(
                platform = "darwin",
                archiveArch = archiveArch,
                archiveExt = "tar.gz",
                target = "$targetArch-apple-darwin",
                libc = "",
                libcSuffix = ""
            )
            else -> RuntimePlatform(
                platform = "linux",
                archiveArch = archiveArch,
                archiveExt = "tar.gz",
                target = "$targetArch-unknown-linux-gnu",
                libc = "gnu",
                libcSuffix = ""
            )
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
}
