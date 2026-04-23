package agentdock.acp

import java.io.File

/**
 * Adapter runtimes are downloaded at runtime to ~/.agent-dock/dependencies/<adapter-name>/.
 * Supported distribution types:
 * - archive: download and extract a platform archive into the adapter directory
 * - npm: install package into the adapter directory and run its launch path
 */
object AcpAdapterPaths {
    private const val ADAPTER_NAME_OVERRIDE_PROPERTY = "agentdock.acp.adapter.name"

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
        target: AcpExecutionTarget = currentTarget()
    ): String = resolveTargetDependenciesPath(target)

    internal fun getDownloadPath(
        adapterName: String? = null,
        target: AcpExecutionTarget = currentTarget()
    ): String {
        val adapterInfo = getAdapterInfo(adapterName)
        return resolveDownloadPath(adapterInfo, target)
    }

    internal fun installedVersion(
        adapterName: String? = null,
        target: AcpExecutionTarget = currentTarget()
    ): String? {
        val adapterInfo = getAdapterInfo(adapterName)
        val runtimeDir = File(getDependenciesDir(), adapterInfo.id)
        return installedVersionFromRuntimeDir(runtimeDir, adapterInfo)
    }

    internal fun isDownloaded(
        adapterName: String? = null,
        target: AcpExecutionTarget = currentTarget()
    ): Boolean {
        val adapterInfo = getAdapterInfo(adapterName)
        val runtimeDir = File(getDependenciesDir(), adapterInfo.id)
        return runtimeDir.isDirectory &&
            when (adapterInfo.distribution.type) {
                AcpAdapterConfig.DistributionType.ARCHIVE -> resolveAdapterLaunchFile(runtimeDir, adapterInfo, target)?.isFile == true
                AcpAdapterConfig.DistributionType.NPM -> {
                    File(runtimeDir, "node_modules").isDirectory &&
                        resolveAdapterLaunchFile(runtimeDir, adapterInfo, target)?.isFile == true
                }
            }
    }

    internal fun deleteAdapter(adapterName: String? = null, target: AcpExecutionTarget = currentTarget()): Boolean {
        val adapterInfo = getAdapterInfo(adapterName)
        return deleteLocalAdapterRuntime(File(getDependenciesDir(), adapterInfo.id), adapterInfo.id, target)
    }

    suspend fun getAdapterRoot(adapterName: String? = null): File? {
        val adapterInfo = getAdapterInfo(adapterName)
        val runtimeDir = File(getDependenciesDir(), adapterInfo.id)
        return if (isDownloaded(adapterName, AcpExecutionTarget.LOCAL)) runtimeDir else null
    }

    fun applyPatches(
        adapterRoot: File,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        statusCallback: ((String) -> Unit)? = null
    ) {
        val patchRoot = resolvePatchRoot(adapterRoot, adapterInfo)
        adapterInfo.patches.forEach { patchContent ->
            statusCallback?.invoke("Applying patch...")
            AcpPatchService.applyPatch(patchRoot, patchContent)
        }
    }

    internal fun ensurePatched(adapterName: String? = null, target: AcpExecutionTarget = currentTarget()) {
        val adapterInfo = getAdapterInfo(adapterName)
        val runtimeDir = File(getDependenciesDir(), adapterInfo.id)
        if (runtimeDir.isDirectory) {
            applyPatches(runtimeDir, adapterInfo)
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
        prepareAdapterTargetDir(targetDir)
        val success = when (resolvedAdapterInfo.distribution.type) {
            AcpAdapterConfig.DistributionType.ARCHIVE ->
                downloadArchiveDistribution(targetDir, resolvedAdapterInfo, statusCallback)
            AcpAdapterConfig.DistributionType.NPM ->
                AcpNpmInstaller.downloadFromNpm(targetDir, resolvedAdapterInfo, statusCallback)
        }
        if (!success) return false
        applyPatches(targetDir, resolvedAdapterInfo, statusCallback)
        val downloaded = isDownloaded(resolvedAdapterInfo.id, target)
        if (!downloaded) {
            statusCallback?.invoke(missingLaunchTargetError(targetDir.absolutePath, resolvedAdapterInfo, target))
        }
        if (downloaded) writeInstallMetadata(targetDir, resolvedAdapterInfo.distribution.version)
        return downloaded
    }

    fun downloadArchiveDistribution(
        targetDir: File,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        statusCallback: ((String) -> Unit)? = null
    ): Boolean = downloadArchiveDistributionLocal(targetDir, adapterInfo, statusCallback)

    fun resolveAdapterName(adapterName: String?): String {
        val explicit = adapterName?.trim().takeUnless { it.isNullOrEmpty() }
        if (explicit != null) return explicit
        val override = System.getProperty(ADAPTER_NAME_OVERRIDE_PROPERTY)?.trim()
        if (!override.isNullOrEmpty()) return override
        throw IllegalStateException(
            "ACP adapter name is required. Provide it explicitly or set system property '$ADAPTER_NAME_OVERRIDE_PROPERTY'."
        )
    }

    internal fun resolveLaunchFile(
        adapterRoot: File,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        target: AcpExecutionTarget = currentTarget()
    ): File? = resolveAdapterLaunchFile(adapterRoot, adapterInfo, target)

    internal fun resolveLaunchPath(
        adapterRootPath: String,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        target: AcpExecutionTarget = currentTarget()
    ): String? = resolveAdapterLaunchPath(adapterRootPath, adapterInfo, target)

    internal fun buildLaunchCommand(
        adapterRootPath: String,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        projectPath: String? = null,
        target: AcpExecutionTarget = currentTarget()
    ): List<String> = buildAdapterLaunchCommand(adapterRootPath, adapterInfo, projectPath, target)

    private fun missingLaunchTargetError(
        runtimeDir: String,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        target: AcpExecutionTarget
    ): String {
        val launchPath = resolveAdapterLaunchPath(runtimeDir, adapterInfo, target)
            ?: return "Error: ${adapterInfo.name} installed, but no launch executable is configured for this platform"
        return "Error: ${adapterInfo.name} installed, but launch executable was not found: $launchPath"
    }
}
