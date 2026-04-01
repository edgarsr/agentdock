package unified.llm.history

import java.io.File

internal object CursorCliHistory : AdapterHistory {
    override val adapterId: String = "cursor-cli"

    private const val SESSIONS_TEMPLATE = "~/.cursor/chats/{projectHashMd5}/*/store.db"

    override fun collectSessions(projectPath: String): List<SessionMeta> {
        val files = findMatchingHistoryFiles(resolveHistoryPathTemplate(SESSIONS_TEMPLATE, projectPath))
        return files.mapNotNull { file ->
            val sessionDir = file.parentFile ?: return@mapNotNull null
            val sessionId = sessionDir.name.takeIf { it.isNotBlank() } ?: return@mapNotNull null
            val updatedAt = listOf(
                file.lastModified(),
                File(sessionDir, "store.db-shm").takeIf { it.isFile }?.lastModified() ?: 0L,
                File(sessionDir, "store.db-wal").takeIf { it.isFile }?.lastModified() ?: 0L,
                sessionDir.lastModified()
            ).maxOrNull() ?: file.lastModified()

            SessionMeta(
                sessionId = sessionId,
                adapterName = adapterId,
                projectPath = projectPath,
                title = "Untitled Session",
                filePath = file.absolutePath,
                createdAt = updatedAt,
                updatedAt = updatedAt
            )
        }
    }

    override fun deleteSession(projectPath: String, sessionId: String, sourceFilePath: String?): Boolean {
        val sessionDir = sourceFilePath?.takeIf { it.isNotBlank() }?.let { File(it).parentFile } ?: return false
        return deleteHistoryDirectoryIfExists(sessionDir)
    }
}
