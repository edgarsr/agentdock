package agentdock.acp

import java.io.File

private const val DEFAULT_NPM_LAUNCH_PATH = "dist/index.js"

internal fun isWindowsLocalTarget(target: AcpExecutionTarget): Boolean =
    target == AcpExecutionTarget.LOCAL && AcpExecutionMode.isWindowsHost()

internal fun platformBinaryForTarget(
    binary: AcpAdapterConfig.PlatformBinary?,
    target: AcpExecutionTarget
): String? {
    if (isWindowsLocalTarget(target)) return binary?.win
    return when (AcpExecutionMode.hostPlatform()) {
        "macos" -> binary?.macos ?: binary?.unix
        "linux" -> binary?.linux ?: binary?.unix
        else -> binary?.unix
    }
}

internal fun resolveDownloadPath(
    adapterInfo: AcpAdapterConfig.AdapterInfo,
    target: AcpExecutionTarget
): String {
    val customCommand = adapterInfo.customCommand
    if (customCommand != null) {
        return File(customCommand).absoluteFile.parentFile?.absolutePath
            ?: AcpAdapterPaths.getBaseRuntimeDir().absolutePath
    }
    return File(AcpAdapterPaths.getDependenciesDir(), adapterInfo.id).absolutePath
}

internal fun resolveAdapterLaunchFile(
    adapterRoot: File,
    adapterInfo: AcpAdapterConfig.AdapterInfo,
    target: AcpExecutionTarget
): File? {
    return when (adapterInfo.distribution.type) {
        AcpAdapterConfig.DistributionType.ARCHIVE -> {
            val binName = platformBinaryForTarget(adapterInfo.distribution.binaryName, target)
            if (binName.isNullOrBlank()) null else File(adapterRoot, binName)
        }
        AcpAdapterConfig.DistributionType.NPM -> {
            val launchPath = resolveNpmLaunchRelativePath(adapterInfo, target)
            File(adapterRoot, launchPath.replace("/", File.separator).replace("\\", File.separator))
        }
    }
}

internal fun resolveAdapterLaunchPath(
    adapterRootPath: String,
    adapterInfo: AcpAdapterConfig.AdapterInfo,
    target: AcpExecutionTarget
): String? {
    return when (adapterInfo.distribution.type) {
        AcpAdapterConfig.DistributionType.ARCHIVE -> {
            val binName = platformBinaryForTarget(adapterInfo.distribution.binaryName, target)
            binName?.takeIf { it.isNotBlank() }?.let { joinAdapterPath(adapterRootPath, it, target) }
        }
        AcpAdapterConfig.DistributionType.NPM -> {
            val launchPath = resolveNpmLaunchRelativePath(adapterInfo, target)
            joinAdapterPath(adapterRootPath, launchPath, target)
        }
    }
}

internal fun buildAdapterLaunchCommand(
    adapterRootPath: String,
    adapterInfo: AcpAdapterConfig.AdapterInfo,
    projectPath: String?,
    target: AcpExecutionTarget
): List<String> {
    adapterInfo.customCommand?.let { command ->
        val resolvedCommand = resolveCustomWindowsCommand(command, adapterInfo.environment, target)
        val name = File(resolvedCommand).name.lowercase()
        val base = when {
            isWindowsLocalTarget(target) && (name.endsWith(".cmd") || name.endsWith(".bat")) ->
                mutableListOf("cmd.exe", "/c", resolvedCommand)
            isWindowsLocalTarget(target) && name.endsWith(".ps1") ->
                mutableListOf("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolvedCommand)
            else -> mutableListOf(resolvedCommand)
        }
        base.addAll(adapterInfo.args)
        return base
    }
    val launchPath = resolveAdapterLaunchPath(adapterRootPath, adapterInfo, target)
        ?: throw IllegalStateException("Missing launch target for adapter '${adapterInfo.id}'")
    val launchFile = File(launchPath)
    val name = launchFile.name.lowercase()
    val base = when {
        name.endsWith(".cmd") || name.endsWith(".bat") -> mutableListOf("cmd.exe", "/c", launchFile.absolutePath)
        name.endsWith(".ps1") -> mutableListOf(
            "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", launchFile.absolutePath
        )
        name.endsWith(".js") || name.endsWith(".mjs") -> {
            val node = AcpNodeRuntimeResolver.resolveAvailable()?.node
                ?: if (AcpExecutionMode.isWindowsHost()) "node.exe" else "node"
            mutableListOf(node, launchFile.absolutePath)
        }
        else -> mutableListOf(launchFile.absolutePath)
    }
    base.addAll(adapterInfo.args)
    base.addAll(adapterInfo.platformArgs[AcpExecutionMode.hostPlatform()].orEmpty())
    return base
}

private fun resolveCustomWindowsCommand(
    command: String,
    environmentOverrides: Map<String, String>,
    target: AcpExecutionTarget
): String {
    if (!isWindowsLocalTarget(target)) return command

    val commandFile = File(command)
    if (commandFile.extension.isNotEmpty()) return command

    val environment = AcpProcessEnvironment.baseEnvironment()
    val pathExtensions = environmentValue(environmentOverrides, "PATHEXT")
        ?: environmentValue(environment, "PATHEXT")
        ?: ".COM;.EXE;.BAT;.CMD"
    val candidates = pathExtensions
        .split(';')
        .map(String::trim)
        .filter(String::isNotEmpty)
        .map { extension -> if (extension.startsWith('.')) extension else ".$extension" }

    if (commandFile.isAbsolute || command.contains('/') || command.contains('\\')) {
        return candidates
            .asSequence()
            .map { extension -> File(command + extension) }
            .firstOrNull(File::isFile)
            ?.absolutePath
            ?: command
    }

    val path = environmentValue(environmentOverrides, "PATH")
        ?: environmentValue(environment, "PATH")
        ?: return command
    return path
        .split(File.pathSeparatorChar)
        .asSequence()
        .map(String::trim)
        .filter(String::isNotEmpty)
        .flatMap { directory ->
            val cleanDirectory = directory.removeSurrounding("\"")
            candidates.asSequence().map { extension -> File(cleanDirectory, command + extension) }
        }
        .firstOrNull(File::isFile)
        ?.absolutePath
        ?: command
}

private fun environmentValue(environment: Map<String, String>, name: String): String? =
    environment.entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value

internal fun resolvePatchRoot(adapterRoot: File, adapterInfo: AcpAdapterConfig.AdapterInfo): File {
    if (adapterInfo.patchRoot == AcpAdapterConfig.PatchRoot.RUNTIME) {
        return adapterRoot
    }
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

internal fun resolveNpmPackageRootPath(
    adapterRootPath: String,
    adapterInfo: AcpAdapterConfig.AdapterInfo,
    target: AcpExecutionTarget
): String {
    val packageName = adapterInfo.distribution.packageName
        ?: throw IllegalStateException("Adapter '${adapterInfo.id}' missing distribution.packageName in configuration")
    return joinAdapterPath(adapterRootPath, "node_modules/$packageName", target)
}

private fun resolveNpmLaunchRelativePath(
    adapterInfo: AcpAdapterConfig.AdapterInfo,
    target: AcpExecutionTarget
): String {
    val launchBinary = platformBinaryForTarget(adapterInfo.launchBinary, target).orEmpty().trim()
    if (launchBinary.isNotEmpty()) return launchBinary

    val launchPath = adapterInfo.launchPath.ifBlank { DEFAULT_NPM_LAUNCH_PATH }
    val packageName = adapterInfo.distribution.packageName
        ?: throw IllegalStateException("Adapter '${adapterInfo.id}' missing distribution.packageName in configuration")
    return "node_modules/$packageName/$launchPath"
}

private fun joinAdapterPath(base: String, relative: String, target: AcpExecutionTarget): String {
    val separator = File.separator
    val normalizedRelative = relative.replace("/", File.separator).replace("\\", File.separator)
    return if (base.endsWith(separator)) base + normalizedRelative else base + separator + normalizedRelative
}
