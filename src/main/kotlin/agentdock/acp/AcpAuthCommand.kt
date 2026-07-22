package agentdock.acp

import java.io.File

internal object AcpAuthCommand {
    fun build(
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        args: List<String>
    ): List<String>? {
        val authConfig = adapterInfo.authConfig ?: return null
        val baseCommand = resolveBaseCommand(adapterInfo, authConfig) ?: return null
        return baseCommand + args
    }

    fun buildAgentVersionCommand(adapterInfo: AcpAdapterConfig.AdapterInfo): List<String>? {
        val versionConfig = adapterInfo.agentVersionConfig ?: return null
        return build(adapterInfo, versionConfig.args)
    }

    fun workingDirectory(
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        projectPath: String? = null
    ): File? {
        val path = projectPath?.takeIf { it.isNotBlank() }
            ?: AcpAdapterPaths.getDownloadPath(adapterInfo.id, AcpExecutionTarget.LOCAL).takeIf { it.isNotBlank() }
        return path?.let(::File)
    }

    private fun resolveBaseCommand(
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        authConfig: AcpAdapterConfig.AuthConfig
    ): List<String>? {
        val target = AcpAdapterPaths.getExecutionTarget()
        if (authConfig.command.isNotEmpty()) {
            val runtime = AcpNodeRuntimeResolver.resolveAvailable()
            return authConfig.command.mapIndexed { index, value ->
                when {
                    index != 0 -> value
                    value == "node" -> runtime?.node ?: if (isWindowsLocalTarget(target)) "node.exe" else "node"
                    value == "npm" -> runtime?.npm ?: if (isWindowsLocalTarget(target)) "npm.cmd" else "npm"
                    value == "npx" -> runtime?.npx ?: if (isWindowsLocalTarget(target)) "npx.cmd" else "npx"
                    else -> value
                }
            }
        }

        authConfig.authNpmPackage?.takeIf { it.isNotBlank() }?.let { packageName ->
            val downloadPath = AcpAdapterPaths.getDownloadPath(adapterInfo.id, target)
            if (downloadPath.isEmpty()) return null
            val binaryName = packageName.substringAfterLast('/')
            val binaryPath = if (isWindowsLocalTarget(target)) {
                "$downloadPath${File.separator}node_modules${File.separator}.bin${File.separator}$binaryName.cmd"
            } else {
                File(downloadPath, "node_modules${File.separator}.bin${File.separator}$binaryName").absolutePath
            }
            return listOf(binaryPath)
        }

        val (scriptPath, useNode) = resolveScriptPath(adapterInfo, authConfig.authScript) ?: return null
        if (isWindowsLocalTarget(target) &&
            (scriptPath.endsWith(".cmd", true) || scriptPath.endsWith(".bat", true))
        ) {
            return listOf("cmd.exe", "/c", scriptPath)
        }
        return buildList {
            if (useNode) add(findNodeExecutable(target))
            add(scriptPath)
        }
    }

    private fun resolveScriptPath(
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        authScript: String?
    ): Pair<String, Boolean>? {
        val target = AcpAdapterPaths.getExecutionTarget()
        val downloadPath = AcpAdapterPaths.getDownloadPath(adapterInfo.id, target)
        if (downloadPath.isEmpty()) return null

        if (authScript.isNullOrBlank()) {
            val file = AcpAdapterPaths.resolveLaunchFile(File(downloadPath), adapterInfo, target) ?: return null
            if (!file.isFile) return null
            return file.absolutePath to file.isNodeScript()
        }

        var relativePath = authScript
        if ((relativePath.contains("node_modules/.bin/") || relativePath.contains("node_modules\\.bin\\")) &&
            isWindowsLocalTarget(target) &&
            !relativePath.endsWith(".cmd") &&
            !relativePath.endsWith(".bat")
        ) {
            relativePath += ".cmd"
        }

        val explicitFile = File(relativePath)
        val file = if (explicitFile.isAbsolute) explicitFile else File(downloadPath, relativePath)
        if (!file.isFile) return null
        return file.absolutePath to file.isNodeScript()
    }

    private fun File.isNodeScript(): Boolean =
        name.endsWith(".js", true) || name.endsWith(".mjs", true)

    private fun findNodeExecutable(target: AcpExecutionTarget): String =
        AcpNodeRuntimeResolver.resolveAvailable()?.node
            ?: if (isWindowsLocalTarget(target)) "node.exe" else "node"
}
