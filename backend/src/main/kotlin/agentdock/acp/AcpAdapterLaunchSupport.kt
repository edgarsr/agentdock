package agentdock.acp

import java.io.File

private const val DEFAULT_NPM_LAUNCH_PATH = "dist/index.js"

internal fun platformBinary(binary: AcpAdapterConfig.PlatformBinary?): String? {
    return when (AcpExecutionMode.hostPlatform()) {
        "windows" -> binary?.win
        "macos" -> binary?.macos ?: binary?.unix
        "linux" -> binary?.linux ?: binary?.unix
        else -> binary?.unix
    }
}

internal fun resolveDownloadPath(adapterInfo: AcpAdapterConfig.AdapterInfo): String {
    val customCommand = adapterInfo.customCommand
    if (customCommand != null) {
        return File(customCommand).absoluteFile.parentFile?.absolutePath
            ?: AcpAdapterPaths.getBaseRuntimeDir().absolutePath
    }
    return File(AcpAdapterPaths.getDependenciesDir(), adapterInfo.id).absolutePath
}

internal fun resolveAdapterLaunchFile(
    adapterRoot: File,
    adapterInfo: AcpAdapterConfig.AdapterInfo
): File? {
    return when (adapterInfo.distribution.type) {
        AcpAdapterConfig.DistributionType.ARCHIVE -> {
            val binName = platformBinary(adapterInfo.distribution.binaryName)
            if (binName.isNullOrBlank()) null else File(adapterRoot, binName)
        }
        AcpAdapterConfig.DistributionType.NPM -> {
            val launchPath = resolveNpmLaunchRelativePath(adapterInfo)
            File(adapterRoot, launchPath.replace("/", File.separator).replace("\\", File.separator))
        }
    }
}

internal fun resolveAdapterLaunchPath(
    adapterRootPath: String,
    adapterInfo: AcpAdapterConfig.AdapterInfo
): String? {
    return when (adapterInfo.distribution.type) {
        AcpAdapterConfig.DistributionType.ARCHIVE -> {
            val binName = platformBinary(adapterInfo.distribution.binaryName)
            binName?.takeIf { it.isNotBlank() }?.let { joinAdapterPath(adapterRootPath, it) }
        }
        AcpAdapterConfig.DistributionType.NPM -> {
            val launchPath = resolveNpmLaunchRelativePath(adapterInfo)
            joinAdapterPath(adapterRootPath, launchPath)
        }
    }
}

internal fun buildAdapterLaunchCommand(
    adapterRootPath: String,
    adapterInfo: AcpAdapterConfig.AdapterInfo
): List<String> {
    adapterInfo.customCommand?.let { command ->
        val resolvedCommand = resolveCustomWindowsCommand(command, adapterInfo.environment)
        val name = File(resolvedCommand).name.lowercase()
        val base = when {
            AcpExecutionMode.isWindowsHost() && (name.endsWith(".cmd") || name.endsWith(".bat")) ->
                mutableListOf("cmd.exe", "/c", resolvedCommand)
            AcpExecutionMode.isWindowsHost() && name.endsWith(".ps1") ->
                mutableListOf("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolvedCommand)
            else -> mutableListOf(resolvedCommand)
        }
        base.addAll(adapterInfo.args)
        return base
    }
    val launchPath = resolveAdapterLaunchPath(adapterRootPath, adapterInfo)
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
    environmentOverrides: Map<String, String>
): String {
    if (!AcpExecutionMode.isWindowsHost() || File(command).extension.isNotEmpty()) return command
    return findCommandFile(command, environmentOverrides)?.absolutePath ?: command
}

/**
 * Finds the file a command starts, searching PATH and, for a Windows command without an extension,
 * PATHEXT of the environment the process is launched with.
 */
internal fun findCommandFile(command: String, environmentOverrides: Map<String, String>): File? {
    val environment = AcpProcessEnvironment.baseEnvironment()
    val extensions = if (AcpExecutionMode.isWindowsHost() && File(command).extension.isEmpty()) {
        (environmentValue(environmentOverrides, "PATHEXT")
            ?: environmentValue(environment, "PATHEXT")
            ?: ".COM;.EXE;.BAT;.CMD")
            .split(';')
            .map(String::trim)
            .filter(String::isNotEmpty)
            .map { extension -> if (extension.startsWith('.')) extension else ".$extension" }
    } else {
        listOf("")
    }

    if (File(command).isAbsolute || command.contains('/') || command.contains('\\')) {
        return extensions.asSequence().map { extension -> File(command + extension) }.firstOrNull(File::isFile)
    }

    val path = environmentValue(environmentOverrides, "PATH")
        ?: environmentValue(environment, "PATH")
        ?: return null
    return path
        .split(File.pathSeparatorChar)
        .asSequence()
        .map(String::trim)
        .filter(String::isNotEmpty)
        .flatMap { directory ->
            val cleanDirectory = directory.removeSurrounding("\"")
            extensions.asSequence().map { extension -> File(cleanDirectory, command + extension) }
        }
        .firstOrNull(File::isFile)
}

private fun environmentValue(environment: Map<String, String>, name: String): String? =
    environment.entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value

internal fun resolvePatchRoot(adapterRoot: File, adapterInfo: AcpAdapterConfig.AdapterInfo): File {
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
    adapterInfo: AcpAdapterConfig.AdapterInfo
): String {
    val packageName = adapterInfo.distribution.packageName
        ?: throw IllegalStateException("Adapter '${adapterInfo.id}' missing distribution.packageName in configuration")
    return joinAdapterPath(adapterRootPath, "node_modules/$packageName")
}

private fun resolveNpmLaunchRelativePath(adapterInfo: AcpAdapterConfig.AdapterInfo): String {
    val launchBinary = platformBinary(adapterInfo.launchBinary).orEmpty().trim()
    if (launchBinary.isNotEmpty()) return launchBinary

    val launchPath = adapterInfo.launchPath.ifBlank { DEFAULT_NPM_LAUNCH_PATH }
    val packageName = adapterInfo.distribution.packageName
        ?: throw IllegalStateException("Adapter '${adapterInfo.id}' missing distribution.packageName in configuration")
    return "node_modules/$packageName/$launchPath"
}

private fun joinAdapterPath(base: String, relative: String): String {
    val separator = File.separator
    val normalizedRelative = relative.replace("/", File.separator).replace("\\", File.separator)
    return if (base.endsWith(separator)) base + normalizedRelative else base + separator + normalizedRelative
}
