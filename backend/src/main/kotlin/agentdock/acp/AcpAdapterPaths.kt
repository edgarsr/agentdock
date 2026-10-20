package agentdock.acp

import agentdock.utils.AgentDockPaths
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

    fun getBaseRuntimeDir(): File {
        val dir = AgentDockPaths.baseRuntimeDir()
        dir.mkdirs()
        return dir
    }

    fun getDependenciesDir(): File {
        val dir = AgentDockPaths.dependenciesDir()
        dir.mkdirs()
        return dir
    }

    fun getProbeSessionDir(): File {
        val dir = File(getBaseRuntimeDir(), "probe-sessions")
        dir.mkdirs()
        return dir
    }

    internal fun getDownloadPath(adapterName: String? = null): String {
        val adapterInfo = getAdapterInfo(adapterName)
        return resolveDownloadPath(adapterInfo)
    }

    internal fun installedVersion(adapterName: String? = null): String? {
        val adapterInfo = getAdapterInfo(adapterName)
        if (adapterInfo.isCustom) return null
        val runtimeDir = File(getDependenciesDir(), adapterInfo.id)
        return installedVersionFromRuntimeDir(runtimeDir, adapterInfo)
    }

    internal fun isDownloaded(adapterName: String? = null): Boolean {
        val adapterInfo = getAdapterInfo(adapterName)
        if (adapterInfo.isCustom) return isCustomExecutableAvailable(adapterInfo)
        val runtimeDir = File(getDependenciesDir(), adapterInfo.id)
        return hasInstalledAdapterLaunch(runtimeDir, adapterInfo) &&
            isInstalledVersionSupported(adapterInfo, installedVersionFromRuntimeDir(runtimeDir, adapterInfo))
    }

    internal fun deleteAdapter(adapterName: String? = null): Boolean {
        val adapterInfo = getAdapterInfo(adapterName)
        return deleteAdapterRuntime(File(getDependenciesDir(), adapterInfo.id), adapterInfo.id)
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

    internal fun installAdapterRuntime(
        targetDir: File,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        statusCallback: ((String) -> Unit)? = null,
        versionOverride: String? = null,
        cancellation: AcpAdapterInstallCancellation? = null
    ): Boolean {
        check(!adapterInfo.isCustom) { "Custom ACP agents are configured externally and cannot be installed" }
        cancellation?.throwIfCancelled()
        val baseAdapterInfo = versionOverride?.trim()?.takeIf { it.isNotEmpty() }?.let {
            adapterInfo.withDistributionVersion(it)
        } ?: adapterInfo
        val resolvedAdapterInfo = resolveInstallAdapterInfo(baseAdapterInfo, statusCallback) ?: return false
        cancellation?.throwIfCancelled()
        prepareAdapterTargetDir(targetDir)
        val success = when (resolvedAdapterInfo.distribution.type) {
            AcpAdapterConfig.DistributionType.ARCHIVE ->
                downloadArchiveDistribution(targetDir, resolvedAdapterInfo, statusCallback, cancellation)
            AcpAdapterConfig.DistributionType.NPM ->
                AcpNpmInstaller.downloadFromNpm(targetDir, resolvedAdapterInfo, statusCallback, cancellation)
        }
        cancellation?.throwIfCancelled()
        if (!success) return false
        applyPatches(targetDir, resolvedAdapterInfo, statusCallback)
        cancellation?.throwIfCancelled()
        val installedVersionOverride = resolvedAdapterInfo.distribution.version
            .takeIf { resolvedAdapterInfo.distribution.type == AcpAdapterConfig.DistributionType.ARCHIVE }
        val hasLaunchExecutable = hasInstalledAdapterLaunch(targetDir, resolvedAdapterInfo)
        if (!hasLaunchExecutable) {
            statusCallback?.invoke(missingLaunchTargetError(targetDir.absolutePath, resolvedAdapterInfo))
        }
        val installedVersion = installedVersionOverride
            ?: installedVersionFromRuntimeDir(targetDir, resolvedAdapterInfo)
        val downloaded = hasLaunchExecutable &&
            isInstalledVersionSupported(resolvedAdapterInfo, installedVersion)
        if (downloaded && resolvedAdapterInfo.distribution.type == AcpAdapterConfig.DistributionType.ARCHIVE) {
            writeInstallMetadata(targetDir, resolvedAdapterInfo.distribution.version)
        }
        return downloaded
    }

    fun resolveAdapterName(adapterName: String?): String {
        val explicit = adapterName?.trim().takeUnless { it.isNullOrEmpty() }
        if (explicit != null) return explicit
        val override = System.getProperty(ADAPTER_NAME_OVERRIDE_PROPERTY)?.trim()
        if (!override.isNullOrEmpty()) return override
        throw IllegalStateException(
            "ACP adapter name is required. Provide it explicitly or set system property '$ADAPTER_NAME_OVERRIDE_PROPERTY'."
        )
    }

    internal fun hasInstalledAdapterLaunch(
        runtimeDir: File,
        adapterInfo: AcpAdapterConfig.AdapterInfo
    ): Boolean {
        if (adapterInfo.isCustom) return isCustomExecutableAvailable(adapterInfo)
        return runtimeDir.isDirectory &&
            (adapterInfo.distribution.type != AcpAdapterConfig.DistributionType.NPM ||
                File(runtimeDir, "node_modules").isDirectory) &&
            resolveAdapterLaunchFile(runtimeDir, adapterInfo)?.isFile == true
    }

    private fun isCustomExecutableAvailable(adapterInfo: AcpAdapterConfig.AdapterInfo): Boolean {
        val command = adapterInfo.customCommand.orEmpty().trim()
        return command.isNotEmpty() && findCommandFile(command, adapterInfo.environment) != null
    }

    private fun missingLaunchTargetError(
        runtimeDir: String,
        adapterInfo: AcpAdapterConfig.AdapterInfo
    ): String {
        val launchPath = resolveAdapterLaunchPath(runtimeDir, adapterInfo)
            ?: return "Error: ${adapterInfo.name} installed, but no launch executable is configured for this platform"
        return "Error: ${adapterInfo.name} installed, but launch executable was not found: $launchPath"
    }
}
