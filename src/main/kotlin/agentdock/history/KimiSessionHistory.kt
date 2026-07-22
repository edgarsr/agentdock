package agentdock.history

import agentdock.utils.atomicWriteText
import kotlinx.serialization.json.jsonObject
import java.io.File
import java.io.IOException
import java.nio.file.FileVisitResult
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import java.nio.file.SimpleFileVisitor
import java.nio.file.attribute.BasicFileAttributes

internal object KimiSessionHistory {
    private const val INDEX_FILE_NAME = "session_index.jsonl"
    private const val SESSIONS_DIRECTORY_NAME = "sessions"

    @Synchronized
    fun kimiCodeSessionDelete(projectPath: String, sessionId: String): Boolean {
        val kimiDataDirectory = File(System.getProperty("user.home"), ".kimi-code")
        return deleteSession(kimiDataDirectory, projectPath, sessionId)
    }

    internal fun deleteSession(kimiDataDirectory: File, projectPath: String, sessionId: String): Boolean {
        val cleanSessionId = sessionId.trim()
        val expectedProjectPath = historyComparablePath(projectPath)
        if (cleanSessionId.isBlank() || expectedProjectPath.isBlank()) return false

        val indexFile = File(kimiDataDirectory, INDEX_FILE_NAME)
        if (!indexFile.isFile) return false

        return runCatching {
            val lines = indexFile.readLines()
            val matches = lines.mapIndexedNotNull { index, line ->
                val entry = runCatching { historyJson.parseToJsonElement(line).jsonObject }.getOrNull()
                    ?: return@mapIndexedNotNull null
                val entrySessionId = entry.stringOrNull("sessionId")?.trim()
                val entryProjectPath = historyComparablePath(entry.stringOrNull("workDir"))
                val sessionDirectory = entry.stringOrNull("sessionDir")?.trim()
                if (
                    entrySessionId == cleanSessionId &&
                    entryProjectPath == expectedProjectPath &&
                    !sessionDirectory.isNullOrBlank()
                ) {
                    IndexedSessionDirectory(index, sessionDirectory)
                } else {
                    null
                }
            }
            if (matches.isEmpty()) return false

            val sessionsRoot = File(kimiDataDirectory, SESSIONS_DIRECTORY_NAME).canonicalFile.toPath()
            val sessionDirectories = matches.map { match ->
                validatedSessionDirectory(sessionsRoot, cleanSessionId, match.sessionDirectory)
                    ?: return false
            }.distinct()
            if (sessionDirectories.size != 1) return false

            if (!deleteDirectoryWithoutFollowingLinks(sessionDirectories.single())) return false

            val matchedIndexes = matches.mapTo(hashSetOf()) { it.lineIndex }
            val remainingLines = lines.filterIndexed { index, _ -> index !in matchedIndexes }
            val updatedIndex = if (remainingLines.isEmpty()) {
                ""
            } else {
                remainingLines.joinToString(separator = "\n", postfix = "\n")
            }
            indexFile.atomicWriteText(updatedIndex)
            true
        }.getOrDefault(false)
    }

    private fun validatedSessionDirectory(sessionsRoot: Path, sessionId: String, rawPath: String): Path? {
        val sessionDirectory = runCatching { File(rawPath).canonicalFile.toPath() }.getOrNull() ?: return null
        if (sessionDirectory == sessionsRoot || !sessionDirectory.startsWith(sessionsRoot)) return null
        if (sessionDirectory.fileName?.toString() != sessionId) return null
        if (Files.isSymbolicLink(File(rawPath).toPath())) return null
        return sessionDirectory
    }

    private fun deleteDirectoryWithoutFollowingLinks(directory: Path): Boolean {
        if (!Files.exists(directory, LinkOption.NOFOLLOW_LINKS)) return true
        if (!Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS)) return false

        Files.walkFileTree(directory, object : SimpleFileVisitor<Path>() {
            override fun visitFile(file: Path, attrs: BasicFileAttributes): FileVisitResult {
                Files.delete(file)
                return FileVisitResult.CONTINUE
            }

            override fun postVisitDirectory(dir: Path, error: IOException?): FileVisitResult {
                if (error != null) throw error
                Files.delete(dir)
                return FileVisitResult.CONTINUE
            }
        })
        return true
    }

    private data class IndexedSessionDirectory(
        val lineIndex: Int,
        val sessionDirectory: String
    )
}
