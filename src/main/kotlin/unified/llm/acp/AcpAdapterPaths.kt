package unified.llm.acp

import com.intellij.openapi.diagnostic.Logger
import java.io.File
import java.util.concurrent.ConcurrentHashMap

private val log = Logger.getInstance("unified.llm.acp.AcpAdapterPaths")

/**
 * Adapters are downloaded from npm at runtime to ~/.unified-llm/adapters/<adapter-name>/.
 * On first run we download the adapter from npm and run npm install there;
 * node_modules is created on disk, so the adapter can run.
 * 
 * Each adapter gets its own directory under ~/.unified-llm/adapters/ to allow multiple
 * adapters to coexist with their own dependencies.
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
     * Directory for adapters. Each adapter gets its own subdirectory.
     */
    private val ADAPTERS_DIR = File(BASE_RUNTIME_DIR, "adapters")
    
    /**
     * Runtime directory for the current adapter.
     * Format: ~/.unified-llm/adapters/<adapter-resource-name>/
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
     * Returns the adapters directory (~/.unified-llm/adapters).
     */
    fun getAdaptersDir(): File {
        ADAPTERS_DIR.mkdirs()
        return ADAPTERS_DIR
    }
    
    /**
     * Returns the adapter root directory (dist/ + package.json + node_modules/).
     * Downloads adapter from npm to ~/.unified-llm/adapters/<adapter-name>/ if needed and runs npm install.
     */
    fun getAdapterRoot(adapterName: String? = null): File? {
        val adapterInfo = getAdapterInfo(adapterName)
        val runtimeDir = File(ADAPTERS_DIR, adapterInfo.resourceName)
        val cacheKey = runtimeDir.absolutePath
        cachedRoots[cacheKey]?.let { root ->
            if (root.isDirectory && File(root, "node_modules").isDirectory && File(root, adapterInfo.launchPath).isFile) {
                return root
            }
        }
        val root = ensureRuntimeDir(runtimeDir, adapterInfo)
        if (root != null) cachedRoots[cacheKey] = root
        return root
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

    private fun applyPatches(adapterRoot: File, adapterInfo: AcpAdapterConfig.AdapterInfo) {
        for (patchContent in adapterInfo.patches) {
            // Use AcpPatchService to apply unified diff, target path is read from patch header
            val success = AcpPatchService.applyPatch(adapterRoot, patchContent)
            if (!success) {
                log.warn("Failed to apply patch from configuration")
            }
        }
    }

    private fun downloadFromNpm(targetDir: File, adapterInfo: AcpAdapterConfig.AdapterInfo): Boolean {
        return try {
            val npmPackage = adapterInfo.npmPackage
                ?: throw IllegalStateException("Adapter '${adapterInfo.name}' missing npmPackage in configuration")
            val npmVersion = adapterInfo.npmVersion
                ?: throw IllegalStateException("Adapter '${adapterInfo.name}' missing npmVersion in configuration")
            
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

                // Read stdout before waitFor() to avoid deadlock when buffer fills up
                val output = installProc.inputStream.bufferedReader().readText()
                val installExitCode = installProc.waitFor()
                if (installExitCode != 0) {
                    log.error("npm install failed (exit $installExitCode): $output")
                    return false
                }
                
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
            false
        }
    }

    private fun resolveAdapterName(adapterName: String?): String {
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
                    "configure adapters in acp-adapters.properties file.",
                e
            )
        }
    }

    private fun runNpmInstall(cwd: File): Boolean {
        val npm = if (System.getProperty("os.name").lowercase().contains("win")) "npm.cmd" else "npm"
        return try {
            val proc = ProcessBuilder(npm, "install", "--ignore-scripts")
                .directory(cwd)
                .redirectErrorStream(true)
                .start()
            // Read stdout before waitFor() to avoid deadlock when buffer fills up
            val output = proc.inputStream.bufferedReader().readText()
            val exitCode = proc.waitFor()
            if (exitCode != 0) {
                log.warn("npm install failed (exit $exitCode): $output")
                return false
            }
            true
        } catch (e: Exception) {
            log.error("Failed to run npm install", e)
            false
        }
    }
}
