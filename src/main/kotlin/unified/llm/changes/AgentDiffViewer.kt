package unified.llm.changes

import com.intellij.diff.DiffContentFactory
import com.intellij.diff.DiffManager
import com.intellij.diff.requests.SimpleDiffRequest
import com.intellij.openapi.fileTypes.FileTypeManager
import com.intellij.openapi.fileTypes.FileTypes
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import java.io.File

/**
 * Shows a read-only diff of what the agent changed: left = before agent, right = after agent.
 * Uses operations to rebuild "before" content (no git diff).
 */
object AgentDiffViewer {

    /**
     * Rebuild content before edits by reverse-applying operations (last to first).
     */
    fun rebuildBeforeContent(currentContent: String, operations: List<UndoOperation>): String {
        var content = currentContent
        for (op in operations.reversed()) {
            if (op.newText.isEmpty()) continue
            val idx = content.indexOf(op.newText)
            if (idx >= 0) {
                content = content.substring(0, idx) + op.oldText + content.substring(idx + op.newText.length)
            } else {
                val normalizedNew = op.newText.replace("\r\n", "\n").replace("\r", "\n")
                val normalizedContent = content.replace("\r\n", "\n").replace("\r", "\n")
                val normIdx = normalizedContent.indexOf(normalizedNew)
                if (normIdx >= 0) {
                    val (start, len) = UndoFileHandler.normalizedToOriginalRange(content, normIdx, normalizedNew.length)
                    if (start >= 0 && len > 0) {
                        content = content.substring(0, start) + op.oldText + content.substring(start + len)
                    }
                }
            }
        }
        return content
    }

    /**
     * Show agent diff (before vs after) in IDE diff viewer.
     * NOTE: Must be called on EDT (callers use runOnEdt).
     */
    fun showAgentDiff(
        project: Project,
        filePath: String,
        status: String,
        operations: List<UndoOperation>
    ) {
        val resolvedPath = UndoFileHandler.resolveFilePath(project, filePath)
        if (!UndoFileHandler.isPathSafe(project, resolvedPath)) return

        try {
            val file = File(resolvedPath)
            val vf = LocalFileSystem.getInstance().refreshAndFindFileByIoFile(file)
            val snapshot = AgentChangeCalculator.buildSnapshot(project, filePath, status, operations) ?: return

            val fileName = file.name
            val fileType = (if (vf != null && vf.exists()) vf.fileType else null)?.takeIf { it != FileTypes.UNKNOWN }
                ?: FileTypeManager.getInstance().getFileTypeByFileName(fileName)

            val contentFactory = DiffContentFactory.getInstance()
            val leftContent = contentFactory.create(project, snapshot.beforeContent, fileType)
            val rightContent = contentFactory.create(project, snapshot.afterContent, fileType)
            val leftTitle = if (status == "A") "(empty)" else "Before (agent edit)"
            val rightTitle = "After (agent edit)"
            val request = SimpleDiffRequest("Agent changes: $fileName", leftContent, rightContent, leftTitle, rightTitle)
            DiffManager.getInstance().showDiff(project, request)
        } catch (e: Exception) {
        }
    }
}
