package agentdock.gitcommit

import agentdock.bridge.frontend.FrontendSettings
import agentdock.bridge.frontend.FrontendNativeStateService
import agentdock.rpc.AgentDockRpcApi
import agentdock.rpc.LocalBridgeHost
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.vcs.CheckinProjectPanel
import com.intellij.openapi.vcs.CommitMessageI
import com.intellij.openapi.vcs.VcsDataKeys
import com.intellij.openapi.vcs.changes.Change
import com.intellij.vcs.commit.CommitMessageUi
import com.intellij.platform.project.projectId
import org.jetbrains.annotations.NotNull

class GenerateGitCommitMessageAction : AnAction(), DumbAware {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun update(e: @NotNull AnActionEvent) {
        val project = e.project
        e.presentation.text = "Generate Commit Message"
        e.presentation.description = "Generate a commit message with the configured AI agent"
        e.presentation.isEnabledAndVisible = project != null && FrontendSettings.current.gitCommitGeneration.enabled
    }

    override fun actionPerformed(e: @NotNull AnActionEvent) {
        val project = e.project ?: return
        val settings = FrontendSettings.current.gitCommitGeneration
        if (!settings.enabled) {
            return
        }
        val commitContext = resolveCommitContext(e)
        val commitMessageTarget = commitContext.commitMessageTarget
        if (commitMessageTarget == null) {
            showWarning(project, "Git Commit Generation", "Unable to access the commit message field.")
            return
        }
        if (commitContext.changes.isEmpty()) {
            showWarning(project, "Git Commit Generation", "Select changes in the commit view first.")
            return
        }

        val previousMessage = commitMessageTarget.read()
        commitMessageTarget.startLoading()
        commitMessageTarget.write("Generating commit message...")

        project.getService(FrontendNativeStateService::class.java).launch {
            val result = runCatching {
                val selectedPaths = commitContext.changes.flatMap { change ->
                    listOfNotNull(change.beforeRevision?.file?.path, change.afterRevision?.file?.path)
                }.distinct()
                val local = LocalBridgeHost.getInstanceOrNull(project)
                if (local != null) {
                    local.generateGitCommitMessage(selectedPaths)
                } else {
                    AgentDockRpcApi.getInstance().generateGitCommitMessage(project.projectId(), selectedPaths)
                }
            }

            ApplicationManager.getApplication().invokeLater {
                result.onSuccess { message ->
                    commitMessageTarget.write(message)
                    commitMessageTarget.stopLoading()
                }.onFailure { error ->
                    commitMessageTarget.write(previousMessage)
                    commitMessageTarget.stopLoading()
                    Messages.showErrorDialog(
                        project,
                        error.message ?: error.toString(),
                        "Git Commit Generation"
                    )
                }
            }
        }
    }

    private fun resolveCommitContext(e: AnActionEvent): CommitActionContext {
        var commitMessageTarget: CommitMessageTarget? = null
        var changes: Collection<Change> = emptyList()

        val workflowUi = e.getData(VcsDataKeys.COMMIT_WORKFLOW_UI)
        if (workflowUi != null) {
            commitMessageTarget = WorkflowUiCommitMessageTarget(workflowUi.commitMessageUi)
            changes = workflowUi.getIncludedChanges()
        }

        val workflowHandler = e.getData(VcsDataKeys.COMMIT_WORKFLOW_HANDLER)
        if (commitMessageTarget == null && workflowHandler is CommitMessageI) {
            commitMessageTarget = LegacyCommitMessageTarget(workflowHandler)
        }

        val messageControl = e.getData(VcsDataKeys.COMMIT_MESSAGE_CONTROL)
        if (messageControl is CheckinProjectPanel) {
            if (changes.isEmpty()) {
                changes = messageControl.selectedChanges
            }
            if (commitMessageTarget == null) {
                commitMessageTarget = LegacyCommitMessageTarget(messageControl)
            }
        }

        if (commitMessageTarget == null && messageControl is CommitMessageI) {
            commitMessageTarget = LegacyCommitMessageTarget(messageControl)
        }

        if (changes.isEmpty()) {
            val selectedChanges = e.getData(VcsDataKeys.SELECTED_CHANGES)
            if (!selectedChanges.isNullOrEmpty()) {
                changes = selectedChanges.toList()
            }
        }

        if (changes.isEmpty()) {
            val selectedChanges = e.getData(VcsDataKeys.CHANGES)
            if (!selectedChanges.isNullOrEmpty()) {
                changes = selectedChanges.toList()
            }
        }

        return CommitActionContext(commitMessageTarget = commitMessageTarget, changes = changes)
    }

    private fun showWarning(project: com.intellij.openapi.project.Project, title: String, message: String) {
        ApplicationManager.getApplication().invokeLater {
            Messages.showWarningDialog(project, message, title)
        }
    }

    // CommitMessageI declares only setCommitMessage, so a bare implementation offers no way to read the
    // current text back. Reflection is the only option left for that case; every other commit UI the action
    // touches is reached through a typed interface instead.
    private fun readCommitMessage(panel: CommitMessageI): String {
        val methodNames = listOf("getCommitMessage", "getComment", "getText")
        methodNames.forEach { methodName ->
            val value = runCatching {
                panel.javaClass.getMethod(methodName).invoke(panel) as? String
            }.getOrNull()
            if (value != null) {
                return value
            }
        }
        return ""
    }

    private data class CommitActionContext(
        val commitMessageTarget: CommitMessageTarget?,
        val changes: Collection<Change>
    )

    private interface CommitMessageTarget {
        fun read(): String
        fun write(message: String)
        fun startLoading() {}
        fun stopLoading() {}
    }

    private inner class LegacyCommitMessageTarget(
        private val panel: CommitMessageI
    ) : CommitMessageTarget {
        override fun read(): String =
            (panel as? CheckinProjectPanel)?.commitMessage ?: readCommitMessage(panel)

        override fun write(message: String) {
            panel.setCommitMessage(message)
        }
    }

    private class WorkflowUiCommitMessageTarget(
        private val messageUi: CommitMessageUi
    ) : CommitMessageTarget {
        override fun read(): String = messageUi.getText()

        override fun write(message: String) {
            messageUi.setText(message)
        }

        override fun startLoading() = messageUi.startLoading()

        override fun stopLoading() = messageUi.stopLoading()
    }
}
