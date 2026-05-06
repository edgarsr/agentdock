package agentdock

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.wm.ToolWindowManager
import org.jetbrains.annotations.NotNull
import agentdock.utils.toProjectRelativePath

class AddFileReferenceToChatAction : AnAction(), DumbAware {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun update(e: @NotNull AnActionEvent) {
        val project = e.project
        val virtualFile = e.getData(CommonDataKeys.VIRTUAL_FILE)
        val isUsableReference = virtualFile != null &&
            (virtualFile.isDirectory || FileDocumentManager.getInstance().getDocument(virtualFile) != null)
        e.presentation.isEnabledAndVisible = project != null && isUsableReference
    }

    override fun actionPerformed(e: @NotNull AnActionEvent) {
        val project = e.project ?: return
        val virtualFile = e.getData(CommonDataKeys.VIRTUAL_FILE) ?: return
        if (!virtualFile.isDirectory && FileDocumentManager.getInstance().getDocument(virtualFile) == null) return

        val reference = ExternalCodeReference(
            path = toProjectRelativePath(project, virtualFile.path),
            fileName = virtualFile.name
        )

        ToolWindowManager.getInstance(project).getToolWindow("Agent Dock")?.activate(
            { ExternalCodeReferenceDispatcher.dispatch(project, reference) },
            true
        )
    }
}
