package agentdock.changes

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import agentdock.utils.LocalFilePathPolicy
import java.io.File
import java.nio.charset.StandardCharsets

data class UndoOperation(val oldText: String, val newText: String)

data class UndoFileResult(val filePath: String, val success: Boolean, val message: String)

data class UndoResult(
    val success: Boolean,
    val message: String,
    val fileResults: List<UndoFileResult> = emptyList()
)

object UndoFileHandler {

    /**
     * Resolve a local file path. Absolute paths and relative traversal outside the project
     * are intentionally supported plugin behavior.
     */
    fun resolveFilePath(project: Project, filePath: String): String {
        return LocalFilePathPolicy.resolve(project, filePath).resolvedPath
    }

    /**
     * Undo a single file according to the same reconstructed "before agent" snapshot used by the diff view.
     */
    fun undoSingleFile(
        project: Project,
        filePath: String,
        status: String,
        operations: List<UndoOperation>
    ): UndoResult {
        val resolvedPath = resolveFilePath(project, filePath)
        if (!isRestorablePath(resolvedPath)) {
            return UndoResult(
                success = false,
                message = "Invalid file path: $filePath",
                fileResults = listOf(UndoFileResult(filePath = filePath, success = false, message = "Invalid file path"))
            )
        }

        val fileResult = try {
            restoreBeforeSnapshot(project, resolvedPath, status, operations)
        } catch (e: Exception) {
            UndoFileResult(filePath = filePath, success = false, message = "Error: ${e.message}")
        }
        return UndoResult(
            success = fileResult.success,
            message = fileResult.message,
            fileResults = listOf(fileResult)
        )
    }

    fun undoAllFiles(
        project: Project,
        files: List<Triple<String, String, List<UndoOperation>>>
    ): UndoResult {
        val fileResults = mutableListOf<UndoFileResult>()
        for ((path, status, ops) in files) {
            val resolvedPath = resolveFilePath(project, path)
            val result = try {
                if (!isRestorablePath(resolvedPath)) {
                    UndoFileResult(filePath = path, success = false, message = "Invalid file path")
                } else {
                    restoreBeforeSnapshot(project, resolvedPath, status, ops)
                }
            } catch (e: Exception) {
                UndoFileResult(filePath = path, success = false, message = "Error: ${e.message}")
            }
            fileResults += result.copy(filePath = path)
        }
        val failed = fileResults.filterNot { it.success }
        return UndoResult(
            success = failed.isEmpty(),
            message = if (failed.isEmpty()) {
                "All files reverted"
            } else {
                failed.joinToString("; ") { "${it.filePath}: ${it.message}" }
            },
            fileResults = fileResults
        )
    }

    private fun deleteFile(project: Project, filePath: String): UndoFileResult {
        val file = File(filePath)
        if (!file.exists()) return UndoFileResult(filePath = filePath, success = true, message = "Already deleted")

        if (ApplicationManager.getApplication() == null) {
            return if (file.delete()) {
                UndoFileResult(filePath = filePath, success = true, message = "Deleted $filePath")
            } else {
                UndoFileResult(filePath = filePath, success = false, message = "Unable to delete $filePath")
            }
        }

        WriteCommandAction.runWriteCommandAction(project) {
            val vf = LocalFileSystem.getInstance().refreshAndFindFileByIoFile(file)
            if (vf != null) {
                vf.delete(this)
            } else {
                file.delete()
            }
        }
        return if (!file.exists()) {
            UndoFileResult(filePath = filePath, success = true, message = "Deleted $filePath")
        } else {
            UndoFileResult(filePath = filePath, success = false, message = "Unable to delete $filePath")
        }
    }

    private fun restoreBeforeSnapshot(
        project: Project,
        filePath: String,
        status: String,
        operations: List<UndoOperation>
    ): UndoFileResult {
        val snapshot = AgentChangeCalculator.buildSnapshot(project, filePath, status, operations)
            ?: return UndoFileResult(filePath = filePath, success = false, message = "Could not rebuild diff snapshot")

        if (status == "A" && snapshot.beforeContent.isEmpty()) {
            return deleteFile(project, filePath)
        }

        val file = File(filePath)
        val restored = snapshot.beforeContent.replace("\r\n", "\n").replace("\r", "\n")

        if (ApplicationManager.getApplication() == null) {
            file.writeText(restored, StandardCharsets.UTF_8)
            return UndoFileResult(filePath = filePath, success = true, message = "Reverted $filePath")
        }

        val vf = LocalFileSystem.getInstance().refreshAndFindFileByIoFile(file)

        WriteCommandAction.runWriteCommandAction(project) {
            val doc = vf?.let { FileDocumentManager.getInstance().getDocument(it) }
            if (vf != null && doc != null) {
                doc.setText(restored)
                FileDocumentManager.getInstance().saveDocument(doc)
            } else if (vf != null) {
                vf.setBinaryContent(restored.toByteArray(StandardCharsets.UTF_8))
            } else {
                file.writeText(restored, StandardCharsets.UTF_8)
                LocalFileSystem.getInstance().refreshAndFindFileByIoFile(file)
            }
        }
        return UndoFileResult(filePath = filePath, success = true, message = "Reverted $filePath")
    }

    /** Map (start index, length) in normalized string back to (start, length) in original. */
    fun normalizedToOriginalRange(original: String, normStart: Int, normLen: Int): Pair<Int, Int> {
        var normPos = 0
        var origStart = -1
        var origEnd = -1
        var i = 0
        while (i < original.length) {
            if (original[i] == '\r' && i + 1 < original.length && original[i + 1] == '\n') {
                if (normPos == normStart) origStart = i
                normPos++
                i += 2
                if (normPos == normStart + normLen) {
                    origEnd = i
                    break
                }
                continue
            }
            if (original[i] == '\r' || original[i] == '\n') {
                if (normPos == normStart) origStart = i
                normPos++
            } else {
                if (normPos == normStart) origStart = i
                normPos++
            }
            if (normPos == normStart + normLen) origEnd = i + 1
            i++
        }
        if (origStart < 0 || origEnd < 0) return -1 to 0
        return origStart to (origEnd - origStart)
    }

    internal fun isRestorablePath(filePath: String): Boolean {
        return LocalFilePathPolicy.isRestorableLocalPath(filePath)
    }
}
