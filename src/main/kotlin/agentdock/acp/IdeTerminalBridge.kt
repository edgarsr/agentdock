package agentdock.acp

import agentdock.rpc.TerminalLaunchRequest
import com.intellij.openapi.project.Project

interface IdeTerminalBridge {
    fun open(request: TerminalLaunchRequest)

    fun resolveShellPath(): String?
}

internal fun Project.ideTerminalBridge(): IdeTerminalBridge? =
    getService(IdeTerminalBridge::class.java)
