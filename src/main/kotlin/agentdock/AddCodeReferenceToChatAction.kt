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

class AddCodeReferenceToChatAction : AnAction(), DumbAware {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun update(e: @NotNull AnActionEvent) {
        val editor = e.getData(CommonDataKeys.EDITOR)
        val hasSelection = editor?.selectionModel?.hasSelection() == true
        e.presentation.isEnabledAndVisible = e.project != null && hasSelection
    }

    override fun actionPerformed(e: @NotNull AnActionEvent) {
        val project = e.project ?: return
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        val virtualFile = FileDocumentManager.getInstance().getFile(editor.document) ?: return
        val selectionModel = editor.selectionModel
        if (!selectionModel.hasSelection()) return

        val startLine = editor.document.getLineNumber(selectionModel.selectionStart) + 1
        val endLine = editor.document.getLineNumber(selectionModel.selectionEnd) + 1
        val path = toProjectRelativePath(project, virtualFile.path)

        val reference = ExternalCodeReference(
            path = path,
            fileName = virtualFile.name,
            startLine = startLine,
            endLine = endLine
        )

        ToolWindowManager.getInstance(project).getToolWindow("Agent Dock")?.activate(
            { ExternalCodeReferenceDispatcher.dispatch(project, reference) },
            true
        )
    }
}
