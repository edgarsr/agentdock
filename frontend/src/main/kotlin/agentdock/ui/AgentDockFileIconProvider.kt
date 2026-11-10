package agentdock.ui

import com.intellij.ide.FileIconProvider
import com.intellij.openapi.components.serviceIfCreated
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import javax.swing.Icon

/** Shows the open chats' state on the editor tab icon; see [AgentDockUiHost.setAttention]. */
class AgentDockFileIconProvider : FileIconProvider {
    override fun getIcon(file: VirtualFile, flags: Int, project: Project?): Icon? {
        if (file !is AgentDockVirtualFile) return null
        return project?.serviceIfCreated<AgentDockUiHost>()?.attentionIcon
    }
}
