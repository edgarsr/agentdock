package agentdock.acp

internal object AcpAgentVersionCommand {
    fun buildAgentVersionCommand(adapterInfo: AcpAdapterConfig.AdapterInfo): List<String>? {
        val versionConfig = adapterInfo.agentVersionConfig ?: return null
        val target = AcpAdapterPaths.getExecutionTarget()
        val downloadPath = AcpAdapterPaths.getDownloadPath(adapterInfo.id, target)
        if (downloadPath.isEmpty()) return null
        val baseCommand = when (versionConfig.command) {
            "adapter" -> AcpAdapterPaths.buildLaunchCommand(
                adapterRootPath = downloadPath,
                adapterInfo = adapterInfo.copy(args = emptyList()),
                target = target
            )
            "cli" -> buildAdapterCliCommandParts(adapterInfo.id)?.second ?: return null
            else -> return null
        }
        return baseCommand + versionConfig.args
    }
}
