@file:Suppress("UnstableApiUsage")

package agentdock.ui

import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.openapi.fileEditor.FileEditorProvider
import com.intellij.openapi.fileEditor.FileEditorState
import com.intellij.openapi.fileTypes.FileType
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.IconLoader
import com.intellij.openapi.util.UserDataHolderBase
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.testFramework.LightVirtualFile
import java.awt.BorderLayout
import java.beans.PropertyChangeListener
import javax.swing.Icon
import javax.swing.JComponent
import javax.swing.JPanel

object AgentDockFileType : FileType {
    override fun getName(): String = "Agent Dock"
    override fun getDescription(): String = "Agent Dock"
    override fun getDefaultExtension(): String = ""
    override fun getIcon(): Icon = IconLoader.getIcon("/icons/agent_dock_toolwindow.svg", javaClass)
    override fun isBinary(): Boolean = true
    override fun isReadOnly(): Boolean = true
}

class AgentDockVirtualFile : LightVirtualFile("Agent Dock", AgentDockFileType, "") {
    init {
        isWritable = false
    }
}

class AgentDockFileEditor(
    project: Project,
    private val file: VirtualFile,
) : UserDataHolderBase(), FileEditor {

    private val panel = JPanel(BorderLayout())
    private val host = AgentDockUiHost.getInstance(project)

    init {
        host.attachEditor(panel)
    }

    override fun getComponent(): JComponent = panel
    override fun getPreferredFocusedComponent(): JComponent = host.preferredFocusComponent()
    override fun getName(): String = "Agent Dock"
    override fun setState(state: FileEditorState) {}
    override fun isModified(): Boolean = false
    override fun isValid(): Boolean = true
    override fun addPropertyChangeListener(listener: PropertyChangeListener) {}
    override fun removePropertyChangeListener(listener: PropertyChangeListener) {}
    override fun dispose() {
        host.detachEditor(panel)
    }
    override fun getFile(): VirtualFile = file
}

class AgentDockFileEditorProvider : FileEditorProvider, DumbAware {
    override fun accept(project: Project, file: VirtualFile): Boolean = file is AgentDockVirtualFile
    override fun acceptRequiresReadAction(): Boolean = false
    override fun createEditor(project: Project, file: VirtualFile): FileEditor =
        AgentDockFileEditor(project, file)
    override fun getEditorTypeId(): String = EDITOR_TYPE_ID
    override fun getPolicy(): FileEditorPolicy = FileEditorPolicy.HIDE_DEFAULT_EDITOR

    companion object {
        const val EDITOR_TYPE_ID = "agent-dock-ui"
    }
}
