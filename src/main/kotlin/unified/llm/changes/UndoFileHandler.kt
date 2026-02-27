package unified.llm.changes

import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import java.io.File
import java.nio.charset.StandardCharsets

data class UndoOperation(val oldText: String, val newText: String)

data class UndoResult(val success: Boolean, val message: String)

object UndoFileHandler {

    /**
     * Resolve path to absolute path under project (handles relative paths from agent).
     */
    fun resolveFilePath(project: Project, filePath: String): String {
        val base = project.basePath ?: return filePath
        val baseFile = File(base)
        val f = File(filePath)
        return if (f.isAbsolute) {
            try {
                f.canonicalPath
            } catch (_: Exception) {
                filePath
            }
        } else {
            try {
                File(baseFile, filePath.replace('\\', '/')).canonicalPath
            } catch (_: Exception) {
                File(baseFile, filePath).absolutePath
            }
        }
    }

    /**
     * Undo a single file: for status='A' delete it; for status='M' reverse-apply edits.
     */
    fun undoSingleFile(
        project: Project,
        filePath: String,
        status: String,
        operations: List<UndoOperation>
    ): UndoResult {
        val resolvedPath = resolveFilePath(project, filePath)
        if (!isPathSafe(project, resolvedPath)) {
            return UndoResult(false, "Path outside project: $filePath")
        }

        return try {
            if (status == "A") {
                deleteFile(project, resolvedPath)
            } else {
                reverseEdits(project, resolvedPath, operations)
            }
        } catch (e: Exception) {
            UndoResult(false, "Error: ${e.message}")
        }
    }

    fun undoAllFiles(
        project: Project,
        files: List<Triple<String, String, List<UndoOperation>>>
    ): UndoResult {
        val errors = mutableListOf<String>()
        for ((path, status, ops) in files) {
            val result = undoSingleFile(project, path, status, ops)
            if (!result.success) errors.add("$path: ${result.message}")
        }
        return if (errors.isEmpty()) {
            UndoResult(true, "All files reverted")
        } else {
            UndoResult(false, errors.joinToString("; "))
        }
    }

    private fun deleteFile(project: Project, filePath: String): UndoResult {
        val file = File(filePath)
        if (!file.exists()) return UndoResult(true, "Already deleted")

        WriteCommandAction.runWriteCommandAction(project) {
            val vf = LocalFileSystem.getInstance().refreshAndFindFileByIoFile(file)
            vf?.delete(this)
        }
        return UndoResult(true, "Deleted $filePath")
    }

    private fun reverseEdits(
        project: Project,
        filePath: String,
        operations: List<UndoOperation>
    ): UndoResult {
        val file = File(filePath)
        val vf = LocalFileSystem.getInstance().refreshAndFindFileByIoFile(file)
            ?: return UndoResult(false, "File not found: $filePath")

        // Always use current content from disk (VFS), not in-memory document which may be stale or null
        val currentText = String(vf.contentsToByteArray(), vf.charset ?: StandardCharsets.UTF_8)
        val reverted = applyReverseEditsInMemory(currentText, operations)
            ?: return UndoResult(false, "Could not match content to revert")

        WriteCommandAction.runWriteCommandAction(project) {
            val doc = FileDocumentManager.getInstance().getDocument(vf)
            if (doc != null) {
                // Normalize line separators to LF for IntelliJ document
                val normalizedReverted = reverted.replace("\r\n", "\n").replace("\r", "\n")
                doc.setText(normalizedReverted)
                FileDocumentManager.getInstance().saveDocument(doc)
            } else {
                vf.setBinaryContent(reverted.toByteArray(StandardCharsets.UTF_8))
            }
        }
        return UndoResult(true, "Reverted $filePath")
    }

    /** Apply reverse of operations in memory. Returns null if any operation could not be applied. */
    private fun applyReverseEditsInMemory(
        text: String,
        operations: List<UndoOperation>
    ): String? {
        var current = text
        for (op in operations.reversed()) {
            if (op.newText.isEmpty()) continue
            val idx = current.indexOf(op.newText)
            if (idx >= 0) {
                current = current.substring(0, idx) + op.oldText + current.substring(idx + op.newText.length)
            } else {
                // Try with normalized line separators
                val normalizedNew = op.newText.replace("\r\n", "\n").replace("\r", "\n")
                val normalizedCurrent = current.replace("\r\n", "\n").replace("\r", "\n")
                val normIdx = normalizedCurrent.indexOf(normalizedNew)
                if (normIdx < 0) return null
                val (start, len) = normalizedToOriginalRange(current, normIdx, normalizedNew.length)
                if (start < 0 || len <= 0) return null
                current = current.substring(0, start) + op.oldText + current.substring(start + len)
            }
        }
        return current
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

    fun isPathSafe(project: Project, filePath: String): Boolean {
        val projectBase = project.basePath ?: return false
        return try {
            val canonical = File(filePath).canonicalPath
            val baseCanonical = File(projectBase).canonicalPath
            canonical.lowercase().startsWith(baseCanonical.lowercase())
        } catch (_: Exception) {
            false
        }
    }
}
