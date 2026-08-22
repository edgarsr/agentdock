package agentdock.gitcommit

import com.intellij.openapi.project.Project
import com.intellij.openapi.util.io.FileUtil
import com.intellij.openapi.vcs.FilePath
import com.intellij.openapi.vcs.VcsException
import com.intellij.openapi.vcs.changes.Change
import com.intellij.openapi.vcs.changes.ChangeListManager
import com.intellij.openapi.vcs.changes.ChangesUtil

internal object GitCommitPromptBuilder {
    private const val MAX_TOTAL_DIFF_CHARS = 12_000
    private const val MAX_NEW_FILE_CHARS = 1_200
    private const val MAX_CHANGED_LINES = 80

    fun build(project: Project, selectedPaths: Collection<String>, instructions: String): String {
        val requestedPaths = selectedPaths
            .flatMap { path -> pathVariants(project.basePath, path) }
            .toSet()
        val changes = ChangeListManager.getInstance(project).allChanges.filter { change ->
            sequenceOf(change.beforeRevision?.file?.path, change.afterRevision?.file?.path)
                .filterNotNull()
                .flatMap { path -> pathVariants(project.basePath, path).asSequence() }
                .any(requestedPaths::contains)
        }
        if (changes.isEmpty()) {
            throw IllegalStateException("The selected changes are no longer available.")
        }

        val diffText = buildDiffSummary(changes)
        val promptPaths = changes.mapNotNull { change ->
            runCatching { ChangesUtil.getFilePath(change).path }.getOrNull()
        }
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

    private fun pathVariants(basePath: String?, path: String): Set<String> {
        val normalized = FileUtil.toSystemIndependentName(path)
        val variants = mutableSetOf(normalized)
        if (!basePath.isNullOrBlank()) {
            FileUtil.getRelativePath(
                FileUtil.toSystemIndependentName(basePath),
                normalized,
                '/',
            )?.let(variants::add)
        }
        return variants
    }

    private fun buildDiffSummary(changes: Collection<Change>): String {
        if (changes.isEmpty()) {
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
