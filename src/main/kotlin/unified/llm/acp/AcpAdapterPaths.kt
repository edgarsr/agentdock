package unified.llm.acp

import com.intellij.openapi.diagnostic.Logger
import java.io.File

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
 * System property "unified.llm.acp.adapter.name" can override the default adapter.
 */
object AcpAdapterPaths {
    private val ADAPTER_NAME: String = System.getProperty("unified.llm.acp.adapter.name")
        ?: try {
            AcpAdapterConfig.getDefaultAdapterName()
        } catch (e: Exception) {
            log.error("Failed to load adapter configuration", e)
            throw IllegalStateException(
                "ACP adapter not configured. " +
                    "Either set system property 'unified.llm.acp.adapter.name' or " +
                    "configure adapters in acp-adapters.properties file.",
                e
            )
        }

    private val ADAPTER_INFO: AcpAdapterConfig.AdapterInfo = try {
        AcpAdapterConfig.getAdapterInfo(ADAPTER_NAME)
    } catch (e: Exception) {
        log.error("Failed to resolve adapter '$ADAPTER_NAME' from configuration", e)
        throw IllegalStateException("ACP adapter '$ADAPTER_NAME' not found in configuration.", e)
    }

    /**
     * Gets the adapter resource prefix from configuration.
     * First checks system property (for runtime override), then falls back to config file.
     * This ensures the ACP client is completely agnostic of which adapter is used.
     */
    private val RESOURCE_PREFIX: String = ADAPTER_INFO.resourceName
    private val LAUNCH_PATH: String = ADAPTER_INFO.launchPath

    fun getAdapterInfo(): AcpAdapterConfig.AdapterInfo = ADAPTER_INFO
    
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
    private val RUNTIME_DIR = File(ADAPTERS_DIR, RESOURCE_PREFIX)

    @Volatile
    private var cachedRoot: File? = null

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
    fun getAdapterRoot(): File? {
        cachedRoot?.let { root ->
            if (root.isDirectory && File(root, "node_modules").isDirectory && File(root, LAUNCH_PATH).isFile) {
                return root
            }
        }
        val root = ensureRuntimeDir()
        if (root != null) cachedRoot = root
        return root
    }

    private fun ensureRuntimeDir(): File? {
        RUNTIME_DIR.mkdirs()
        val needInstall = !File(RUNTIME_DIR, "node_modules").isDirectory ||
            !File(RUNTIME_DIR, LAUNCH_PATH).isFile
        if (needInstall) {
            if (!downloadFromNpm(RUNTIME_DIR)) return null
            if (!runNpmInstall(RUNTIME_DIR)) return null
            applyPatches(RUNTIME_DIR)
        }
        return RUNTIME_DIR.takeIf { File(it, LAUNCH_PATH).isFile && File(it, "node_modules").isDirectory }
    }

    private fun applyPatches(adapterRoot: File) {
        for (patch in ADAPTER_INFO.patches) {
            val target = File(adapterRoot, patch.file)
            if (!target.isFile) {
                log.warn("Patch target not found: ${target.absolutePath}")
                continue
            }
            val original = target.readText()
            val patched = original.replace(patch.find, patch.replace)
            if (patched != original) {
                target.writeText(patched)
                log.info("Applied patch to ${patch.file}")
            } else {
                log.warn("Patch had no effect on ${patch.file} (find string not found)")
            }
        }
    }

    private fun downloadFromNpm(targetDir: File): Boolean {
        return try {
            val npmPackage = ADAPTER_INFO.npmPackage
                ?: throw IllegalStateException("Adapter '${ADAPTER_INFO.name}' missing npmPackage in configuration")
            val npmVersion = ADAPTER_INFO.npmVersion
                ?: throw IllegalStateException("Adapter '${ADAPTER_INFO.name}' missing npmVersion in configuration")
            
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
