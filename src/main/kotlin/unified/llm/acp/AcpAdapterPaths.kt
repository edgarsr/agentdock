package unified.llm.acp

import com.intellij.openapi.diagnostic.Logger
import java.io.File
import java.util.concurrent.ConcurrentHashMap

private val log = Logger.getInstance("unified.llm.acp.AcpAdapterPaths")

/**
 * Dependencies are downloaded from npm at runtime to ~/.unified-llm/dependencies/<dependency-name>/.
 * On first run we download the dependency from npm and run npm install there;
 * node_modules is created on disk, so the dependency can run.
 * 
 * Each dependency gets its own directory under ~/.unified-llm/dependencies/ to allow multiple
 * dependencies to coexist with their own dependencies.
 * 
 * The adapter is configured via acp-adapters.properties file with npmPackage and npmVersion.
 * System property "unified.llm.acp.adapter.name" can override the default adapter when
 * an explicit adapter name is not provided.
 */
object AcpAdapterPaths {
    private const val ADAPTER_NAME_OVERRIDE_PROPERTY = "unified.llm.acp.adapter.name"

    /**
     * Gets the adapter resource prefix from configuration.
     * First checks system property (for runtime override), then falls back to config file.
     * This ensures the ACP client is completely agnostic of which adapter is used.
     */
    fun getAdapterInfo(adapterName: String? = null): AcpAdapterConfig.AdapterInfo {
        val resolvedName = resolveAdapterName(adapterName)
        return try {
            AcpAdapterConfig.getAdapterInfo(resolvedName)
        } catch (e: Exception) {
            log.error("Failed to resolve adapter '$resolvedName' from configuration", e)
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
     * Runtime directory for the current adapter.
     * Format: ~/.unified-llm/dependencies/<adapter-resource-name>/
     */
    private val cachedRoots = ConcurrentHashMap<String, File>()

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
        return File(DEPENDENCIES_DIR, adapterInfo.resourceName).absolutePath
    }

    /**
     * Checks if the adapter is currently downloaded (dist, package.json, and node_modules exist).
     */
    fun isDownloaded(adapterName: String? = null): Boolean {
        val adapterInfo = getAdapterInfo(adapterName)
        val runtimeDir = File(DEPENDENCIES_DIR, adapterInfo.resourceName)
        return runtimeDir.isDirectory && 
               File(runtimeDir, "node_modules").isDirectory && 
               File(runtimeDir, adapterInfo.launchPath).isFile
    }

    /**
     * Deletes the adapter directory from disk.
     */
    fun deleteAdapter(adapterName: String? = null): Boolean {
        val adapterInfo = getAdapterInfo(adapterName)
        val runtimeDir = File(DEPENDENCIES_DIR, adapterInfo.resourceName)
        val cacheKey = runtimeDir.absolutePath
        
        return try {
            if (runtimeDir.exists()) {
                runtimeDir.deleteRecursively()
            }
            cachedRoots.remove(cacheKey)
            true
        } catch (e: Exception) {
            log.error("Failed to delete adapter at ${runtimeDir.absolutePath}", e)
            false
        }
    }

    /**
     * Returns the adapter root directory.
     * Re-applies patches if already downloaded.
     * Does NOT download automatically anymore.
     */
    suspend fun getAdapterRoot(adapterName: String? = null): File? {
        val adapterInfo = getAdapterInfo(adapterName)
        val runtimeDir = File(DEPENDENCIES_DIR, adapterInfo.resourceName)
        val cacheKey = runtimeDir.absolutePath
        
        if (isDownloaded(adapterName)) {
            cachedRoots[cacheKey] = runtimeDir
            return runtimeDir
        }
        
        return null
    }

    private fun ensureRuntimeDir(runtimeDir: File, adapterInfo: AcpAdapterConfig.AdapterInfo): File? {
        runtimeDir.mkdirs()
        val needInstall = !File(runtimeDir, "node_modules").isDirectory ||
            !File(runtimeDir, adapterInfo.launchPath).isFile
        if (needInstall) {
            if (!downloadFromNpm(runtimeDir, adapterInfo)) return null
            if (!runNpmInstall(runtimeDir)) return null
        }
        // Re-apply patches on each startup so config changes are picked up
        // without forcing a re-install of the adapter runtime directory.
        applyPatches(runtimeDir, adapterInfo)
        return runtimeDir.takeIf {
            File(it, adapterInfo.launchPath).isFile && File(it, "node_modules").isDirectory
        }
    }

    fun applyPatches(adapterRoot: File, adapterInfo: AcpAdapterConfig.AdapterInfo, statusCallback: ((String) -> Unit)? = null) {
        for (patchContent in adapterInfo.patches) {
            statusCallback?.invoke("Applying patch...")
            // Use AcpPatchService to apply unified diff, target path is read from patch header
            val success = AcpPatchService.applyPatch(adapterRoot, patchContent)
            if (!success) {
                log.warn("Failed to apply patch from configuration")
            }
        }
    }

    fun downloadFromNpm(targetDir: File, adapterInfo: AcpAdapterConfig.AdapterInfo, statusCallback: ((String) -> Unit)? = null): Boolean {
        return try {
            val npmPackage = adapterInfo.npmPackage
                ?: throw IllegalStateException("Adapter '${adapterInfo.name}' missing npmPackage in configuration")
            val npmVersion = adapterInfo.npmVersion
                ?: throw IllegalStateException("Adapter '${adapterInfo.name}' missing npmVersion in configuration")
            
            statusCallback?.invoke("Downloading $npmPackage@$npmVersion via npm...")
            log.info("Downloading adapter $npmPackage@$npmVersion to ${targetDir.absolutePath}")
            
            // Create temporary directory for npm install
            val tempDir = File(System.getProperty("java.io.tmpdir"), "unified-llm-adapter-${System.currentTimeMillis()}")
            tempDir.mkdirs()
            
            try {
                // Create minimal package.json for npm install
                val tempPackageJson = File(tempDir, "package.json")
                tempPackageJson.writeText("""{"name":"temp-adapter-install","version":"1.0.0"}""")
                
                // Install npm package
                val npm = if (System.getProperty("os.name").lowercase().contains("win")) "npm.cmd" else "npm"
                val installProc = ProcessBuilder(npm, "install", "$npmPackage@$npmVersion", "--no-save", "--no-package-lock")
                    .directory(tempDir)
                    .redirectErrorStream(true)
                    .start()

                // Read stdout to keep buffer clear and potentially report progress
                installProc.inputStream.bufferedReader().use { reader ->
                    var line: String?
                    while (reader.readLine().also { line = it } != null) {
                        if (line!!.contains("added", ignoreCase = true) || line!!.contains("tarball", ignoreCase = true)) {
                            statusCallback?.invoke("NPM: $line")
                        }
                    }
                }

                val installExitCode = installProc.waitFor()
                if (installExitCode != 0) {
                    log.error("npm install failed (exit $installExitCode)")
                    return false
                }
                
                statusCallback?.invoke("Copying files to dependencies directory...")
                // Copy adapter files from node_modules to target directory
                val installedPackageDir = File(tempDir, "node_modules/$npmPackage")
                if (!installedPackageDir.exists()) {
                    log.error("Adapter package not found at ${installedPackageDir.absolutePath}")
                    return false
                }
                
                // Copy dist/ and package.json
                val distDir = File(installedPackageDir, "dist")
                if (distDir.exists() && distDir.isDirectory) {
                    distDir.copyRecursively(File(targetDir, "dist"), overwrite = true)
                } else {
                    log.error("Adapter dist directory not found")
                    return false
                }
                
                val packageJson = File(installedPackageDir, "package.json")
                if (packageJson.exists()) {
                    packageJson.copyTo(File(targetDir, "package.json"), overwrite = true)
                }
                
                val packageLockJson = File(installedPackageDir, "package-lock.json")
                if (packageLockJson.exists()) {
                    packageLockJson.copyTo(File(targetDir, "package-lock.json"), overwrite = true)
                }
                
                log.info("Adapter downloaded successfully")
                true
            } finally {
                // Cleanup temporary directory
                try {
                    tempDir.deleteRecursively()
                } catch (e: Exception) {
                    log.warn("Failed to cleanup temp directory: ${tempDir.absolutePath}", e)
                }
            }
        } catch (e: Exception) {
            log.error("Failed to download adapter from npm", e)
            return false
        }
    }

    fun runNpmInstall(cwd: File, statusCallback: ((String) -> Unit)? = null): Boolean {
        statusCallback?.invoke("Running local npm install (dependencies)...")
        val npm = if (System.getProperty("os.name").lowercase().contains("win")) "npm.cmd" else "npm"
        return try {
            val proc = ProcessBuilder(npm, "install", "--ignore-scripts")
                .directory(cwd)
                .redirectErrorStream(true)
                .start()
            
            proc.inputStream.bufferedReader().use { reader ->
                var line: String?
                while (reader.readLine().also { line = it } != null) {
                   if (line!!.contains("added", ignoreCase = true) || line!!.contains("pkg", ignoreCase = true)) {
                       statusCallback?.invoke("NPM: $line")
                   }
                }
            }

            val exitCode = proc.waitFor()
            if (exitCode != 0) {
                log.warn("npm install failed (exit $exitCode)")
                return false
            }
            true
        } catch (e: Exception) {
            log.error("Failed to run npm install", e)
            false
        }
    }

    fun downloadSupportingTool(tool: AcpAdapterConfig.SupportingTool, statusCallback: ((String) -> Unit)? = null): Boolean {
        val os = System.getProperty("os.name").lowercase()
        val arch = System.getProperty("os.arch").lowercase()
        
        val targetDirName = tool.targetDir ?: tool.id
        val targetDir = File(getDependenciesDir(), targetDirName)
        targetDir.mkdirs()
        
        val (platform, ext) = when {
            os.contains("win") -> "windows" to "zip"
            os.contains("mac") -> "darwin" to "tar.gz"
            else -> "linux" to "tar.gz"
        }
        
        val resolvedArch = when {
            arch.contains("aarch64") || arch.contains("arm64") -> "arm64"
            else -> "x64"
        }
        
        val rawUrl = tool.downloadUrl ?: return true // If no URL, nothing to download
        val downloadUrl = rawUrl
            .replace("{platform}", platform)
            .replace("{arch}", resolvedArch)
            .replace("{ext}", ext)
            
        val tempFile = File(targetDir, "tool-download.$ext")
        
        try {
            statusCallback?.invoke("Downloading ${tool.name}...")
            log.info("Downloading ${tool.name} from $downloadUrl")
            
            if (os.contains("win")) {
                statusCallback?.invoke("Downloading package...")
                val dlExitCode = ProcessBuilder("powershell", "-Command", "Invoke-WebRequest -Uri '$downloadUrl' -OutFile '${tempFile.absolutePath}'").start().waitFor()
                if (dlExitCode != 0) {
                    log.error("Download failed for ${tool.name} (exit $dlExitCode)")
                    return false
                }

                statusCallback?.invoke("Extracting package...")
                val extractExitCode = ProcessBuilder("powershell", "-Command", "Expand-Archive -Path '${tempFile.absolutePath}' -DestinationPath '${targetDir.absolutePath}' -Force").start().waitFor()
                if (extractExitCode != 0) {
                    log.error("Extraction failed for ${tool.name} (exit $extractExitCode)")
                    return false
                }

                // Finalize directory structure if it extracted into a subdirectory
                // (Common for Cursor CLI which puts everything in 'dist-package')
                val distPackage = File(targetDir, "dist-package")
                if (distPackage.exists()) {
                    distPackage.listFiles()?.forEach { it.copyRecursively(File(targetDir, it.name), overwrite = true) }
                    distPackage.deleteRecursively()
                }
            } else {
                statusCallback?.invoke("Downloading and extracting package...")
                val exitCode = ProcessBuilder("sh", "-c", "curl -fSL '$downloadUrl' | tar --strip-components=1 -xzf - -C '${targetDir.absolutePath}' || curl -fSL '$downloadUrl' | tar -xzf - -C '${targetDir.absolutePath}'").start().waitFor()
                if (exitCode != 0) {
                    log.error("Download/extraction failed for ${tool.name} (exit $exitCode)")
                    return false
                }

                // Ensure binaries are executable
                statusCallback?.invoke("Ensuring executables...")
                targetDir.listFiles()?.filter { !it.isDirectory }?.forEach {
                    it.setExecutable(true)
                }
            }
            
            // Handle aliases if binaryName is provided
            tool.binaryName?.let { bin ->
                val sourceName = if (os.contains("win")) bin.win else bin.unix
                if (sourceName != null) {
                    val sourceFile = File(targetDir, sourceName)
                    if (sourceFile.exists()) {
                        // Create Consistency binaries/aliases
                        if (os.contains("win")) {
                            sourceFile.copyTo(File(targetDir, "agent.exe"), overwrite = true)
                            // Also copy associated .cmd if it exists
                            val cmdName = sourceName.replace(".exe", ".cmd")
                            File(targetDir, cmdName).takeIf { it.exists() }?.copyTo(File(targetDir, "agent.cmd"), overwrite = true)
                        } else {
                            val agentLink = File(targetDir, "agent")
                            if (!agentLink.exists()) {
                                ProcessBuilder("ln", "-s", sourceName, agentLink.absolutePath).start().waitFor()
                            }
                        }
                    }
                }
            }
            
            tempFile.delete()
            statusCallback?.invoke("${tool.name} installed successfully.")
            return true
        } catch (e: Exception) {
            log.error("Failed to download ${tool.name}", e)
            statusCallback?.invoke("Error: ${e.message}")
            return false
        }
    }

    fun resolveAdapterName(adapterName: String?): String {
        val explicit = adapterName?.trim().takeUnless { it.isNullOrEmpty() }
        if (explicit != null) return explicit
        val override = System.getProperty(ADAPTER_NAME_OVERRIDE_PROPERTY)?.trim()
        if (!override.isNullOrEmpty()) return override
        return try {
            AcpAdapterConfig.getDefaultAdapterName()
        } catch (e: Exception) {
            log.error("Failed to load adapter configuration", e)
            throw IllegalStateException(
                "ACP adapter not configured. " +
                    "Either set system property '$ADAPTER_NAME_OVERRIDE_PROPERTY' or " +
                    "configure adapters in acp-adapters.json file.",
                e
            )
        }
    }
}
