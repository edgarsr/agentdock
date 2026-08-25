package agentdock.gitcommit

import com.intellij.openapi.project.Project
import com.intellij.openapi.vcs.FilePath
import com.intellij.openapi.vcs.VcsException
import com.intellij.openapi.vcs.changes.Change
import com.intellij.openapi.vcs.changes.ChangesUtil
import java.io.Reader

internal object GitCommitPromptBuilder {
    private const val MAX_TOTAL_DIFF_CHARS = 12_000
    private const val MAX_NEW_FILE_CHARS = 1_200
    private const val MAX_CHANGED_LINES = 80

    fun build(
        project: Project,
        changes: Collection<Change>,
        unversionedFiles: Collection<FilePath>,
        instructions: String,
    ): String {
        if (changes.isEmpty() && unversionedFiles.isEmpty()) {
            throw IllegalStateException("The selected changes and unversioned files are no longer available.")
        }

        val diffText = buildDiffSummary(project, changes, unversionedFiles)
        val promptPaths = changes.mapNotNull { change ->
            runCatching { ChangesUtil.getFilePath(change).path }.getOrNull()
        } + unversionedFiles.map(FilePath::getPath)
        val prompt = buildString {
            appendLine("You generate Git commit messages from IDE commit changes.")
            appendLine("Return only the final commit message wrapped in <commit_message> and </commit_message> tags.")
            appendLine("Do not include explanations, analysis, XML outside the tags, or markdown fences.")
            appendLine()
            appendLine("Requirements:")
            appendLine("- Base the message only on the provided changes.")
            appendLine("- Prefer a concise, high-signal message.")
            appendLine("- If a body is useful, include it after a blank line.")
            appendLine("- Keep the subject line imperative.")
            appendLine("- You may inspect the changed files and nearby project files if you need more context.")
            appendLine("- Stay read-only.")
            appendLine("- Do not modify files, apply patches, run shell or terminal commands, or request permissions.")
            appendLine("- If an action would require approval, do not attempt it.")
            appendLine()
            if (instructions.isNotBlank()) {
                appendLine("Additional project instructions:")
                appendLine(instructions)
                appendLine()
            }
            appendLine("Selected file paths:")
            if (promptPaths.isEmpty()) {
                appendLine("(no files)")
            } else {
                promptPaths.forEach { path ->
                    appendLine("- $path")
                }
            }
            appendLine()
            appendLine("Selected changes:")
            appendLine(diffText)
            appendLine()
            appendLine("Output format:")
            appendLine("<commit_message>")
            appendLine("your commit message")
            appendLine("</commit_message>")
        }
        return prompt.trim()
    }

    private fun buildDiffSummary(
        project: Project,
        changes: Collection<Change>,
        unversionedFiles: Collection<FilePath>,
    ): String {
        if (changes.isEmpty() && unversionedFiles.isEmpty()) {
            return "(no changes)"
        }

        val diff = StringBuilder()
        changes.forEach { change ->
            if (diff.length >= MAX_TOTAL_DIFF_CHARS) {
                return@forEach
            }

            val filePath = ChangesUtil.getFilePath(change)
            diff.appendLine("=== ${change.type.name}: ${filePath.path} ===")
            diff.appendLine(renderChange(change, filePath))
            diff.appendLine()
        }

        unversionedFiles.forEach { filePath ->
            if (diff.length >= MAX_TOTAL_DIFF_CHARS) {
                return@forEach
            }

            diff.appendLine("=== NEW: ${filePath.path} ===")
            diff.appendLine(renderUnversionedFile(project, filePath))
            diff.appendLine()
        }

        if (diff.length > MAX_TOTAL_DIFF_CHARS) {
            return diff.substring(0, MAX_TOTAL_DIFF_CHARS) + "\n...[truncated]"
        }
        return diff.toString().trim()
    }

    private fun renderChange(change: Change, filePath: FilePath): String {
        return try {
            when (change.type) {
                Change.Type.NEW -> renderNewFile(change)
                Change.Type.DELETED -> "File deleted: ${filePath.path}"
                Change.Type.MOVED -> buildMovedFileMessage(change, filePath)
                Change.Type.MODIFICATION -> renderModifiedFile(change)
            }
        } catch (_: VcsException) {
            "Unable to inspect file content."
        }
    }

    private fun buildMovedFileMessage(change: Change, filePath: FilePath): String {
        val beforePath = change.beforeRevision?.file?.path?.takeIf { it.isNotBlank() }
        return if (beforePath != null && beforePath != filePath.path) {
            "File moved from $beforePath to ${filePath.path}"
        } else {
            "File moved: ${filePath.path}"
        }
    }

    private fun renderNewFile(change: Change): String {
        val content = change.afterRevision?.content.orEmpty()
        if (content.isBlank()) {
            return "New file."
        }
        return buildString {
            appendLine("New file content excerpt:")
            append(content.take(MAX_NEW_FILE_CHARS))
            if (content.length > MAX_NEW_FILE_CHARS) {
                appendLine()
                append("...[truncated]")
            }
        }
    }

    private fun renderUnversionedFile(project: Project, filePath: FilePath): String {
        if (filePath.isDirectory) {
            return "New directory."
        }
        if (filePath.fileType.isBinary) {
            return "New binary file."
        }

        return runCatching {
            filePath.ioFile.reader(filePath.getCharset(project)).use(::readExcerpt)
        }.getOrElse {
            "Unable to inspect file content."
        }
    }

    private fun readExcerpt(reader: Reader): String {
        val buffer = CharArray(MAX_NEW_FILE_CHARS + 1)
        var length = 0
        while (length < buffer.size) {
            val count = reader.read(buffer, length, buffer.size - length)
            if (count < 0) {
                break
            }
            length += count
        }

        if (length == 0) {
            return "New empty file."
        }

        return buildString {
            appendLine("New file content excerpt:")
            append(buffer, 0, minOf(length, MAX_NEW_FILE_CHARS))
            if (length > MAX_NEW_FILE_CHARS) {
                appendLine()
                append("...[truncated]")
            }
        }
    }

    private fun renderModifiedFile(change: Change): String {
        val before = change.beforeRevision?.content.orEmpty()
        val after = change.afterRevision?.content.orEmpty()
        if (before.isBlank() && after.isBlank()) {
            return "Modified file."
        }

        val beforeLines = before.lines()
        val afterLines = after.lines()
        val maxLines = maxOf(beforeLines.size, afterLines.size)
        val diff = StringBuilder()
        var changedLines = 0

        for (index in 0 until maxLines) {
            if (changedLines >= MAX_CHANGED_LINES) {
                break
            }
            val beforeLine = beforeLines.getOrNull(index).orEmpty()
            val afterLine = afterLines.getOrNull(index).orEmpty()
            if (beforeLine == afterLine) {
                continue
            }
            if (beforeLine.isNotEmpty()) {
                diff.append("- ").appendLine(beforeLine)
                changedLines++
            }
            if (afterLine.isNotEmpty() && changedLines < MAX_CHANGED_LINES) {
                diff.append("+ ").appendLine(afterLine)
                changedLines++
            }
        }

        if (diff.isEmpty()) {
            return "Modified file."
        }
        if (changedLines >= MAX_CHANGED_LINES && maxLines > MAX_CHANGED_LINES) {
            diff.append("...[truncated]")
        }
        return diff.toString().trim()
    }
}
