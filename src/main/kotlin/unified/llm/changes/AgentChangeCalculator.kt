package unified.llm.changes

import com.github.difflib.DiffUtils
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import java.io.File
import java.nio.charset.StandardCharsets

data class AgentFileSnapshot(
    val beforeContent: String,
    val afterContent: String
)

data class AgentLineStats(
    val additions: Int,
    val deletions: Int
)

data class AgentFileStats(
    val filePath: String,
    val additions: Int,
    val deletions: Int
)

object AgentChangeCalculator {

    fun buildSnapshot(
        project: Project,
        filePath: String,
        status: String,
        operations: List<UndoOperation>
    ): AgentFileSnapshot? {
        val resolvedPath = UndoFileHandler.resolveFilePath(project, filePath)
        if (!UndoFileHandler.isPathSafe(project, resolvedPath)) return null

        val file = File(resolvedPath)
        val currentContent = readCurrentFileContent(file)

        val originalContent = if (status == "A") "" else AgentDiffViewer.rebuildBeforeContent(currentContent, operations)
        return AgentFileSnapshot(beforeContent = originalContent, afterContent = currentContent)
    }

    fun computeFileStats(
        project: Project,
        filePath: String,
        status: String,
        operations: List<UndoOperation>
    ): AgentFileStats? {
        val snapshot = buildSnapshot(project, filePath, status, operations) ?: return null
        val lineStats = computeLineStats(snapshot.beforeContent, snapshot.afterContent)
        return AgentFileStats(
            filePath = filePath,
            additions = lineStats.additions,
            deletions = lineStats.deletions
        )
    }

    fun computeLineStats(beforeContent: String, afterContent: String): AgentLineStats {
        val beforeLines = toDiffLines(beforeContent)
        val afterLines = toDiffLines(afterContent)
        val patch = DiffUtils.diff(beforeLines, afterLines)

        var additions = 0
        var deletions = 0
        for (delta in patch.deltas) {
            additions += delta.target.lines.size
            deletions += delta.source.lines.size
        }

        return AgentLineStats(additions = additions, deletions = deletions)
    }

    private fun toDiffLines(text: String): List<String> {
        val normalized = text.replace("\r\n", "\n").replace("\r", "\n")
        if (normalized.isEmpty()) return emptyList()

        val lines = normalized.split('\n')
        return if (normalized.endsWith("\n")) lines.dropLast(1) else lines
    }

    private fun readCurrentFileContent(file: File): String {
        LocalFileSystem.getInstance().refreshIoFiles(listOf(file), false, false, null)
        if (!file.exists() || !file.isFile) return ""

        return try {
            file.readText(StandardCharsets.UTF_8)
        } catch (_: Exception) {
            val vf = LocalFileSystem.getInstance().refreshAndFindFileByIoFile(file)
            if (vf != null && vf.exists()) {
                try {
                    String(vf.contentsToByteArray(), vf.charset ?: StandardCharsets.UTF_8)
                } catch (_: Exception) {
                    ""
                }
            } else {
                ""
            }
        }
    }
}
