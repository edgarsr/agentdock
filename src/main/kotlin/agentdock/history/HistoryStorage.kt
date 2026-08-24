package agentdock.history

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import agentdock.acp.AcpAdapterPaths
import agentdock.utils.atomicWriteText
import java.io.File

internal object HistoryStorage {
    private val conversationIdPattern = Regex("[A-Za-z0-9_-]{1,256}")

    private data class StoredProjectIndex(
        val text: String,
        val conversations: MutableList<HistoryConversationIndexEntry>
    )

    val json = Json {
        ignoreUnknownKeys = true
        prettyPrint = true
        encodeDefaults = false
        explicitNulls = false
    }

    fun projectIndexFile(projectPath: String): File {
        val baseDir = File(AcpAdapterPaths.getBaseRuntimeDir(), "projects")
        val slug = agentDockProjectSlug(projectPath)
        return File(File(baseDir, slug), "index.json")
    }

    internal fun agentDockProjectSlug(projectPath: String): String {
        return historyProjectPathSlug(projectPath)
            .trim('-')
            .ifBlank { "project" }
    }

    fun projectConversationsDir(projectPath: String): File {
        return File(projectIndexFile(projectPath).parentFile, "conversations")
    }

    fun ephemeralSessionsFile(projectPath: String): File {
        return File(projectIndexFile(projectPath).parentFile, "ephemeral-sessions.json")
    }

    fun ensureProjectConversationsDir(projectPath: String): File {
        val dir = projectConversationsDir(projectPath)
        if (!dir.exists()) {
            dir.mkdirs()
        }
        return dir
    }

    fun conversationDataFile(projectPath: String, conversationId: String): File {
        val safeConversationId = requireSafeConversationId(conversationId)
        return File(ensureProjectConversationsDir(projectPath), "$safeConversationId.json")
    }

    fun conversationTranscriptFile(projectPath: String, conversationId: String): File {
        val safeConversationId = requireSafeConversationId(conversationId)
        return File(ensureProjectConversationsDir(projectPath), "$safeConversationId.transcript.txt")
    }

    internal fun requireSafeConversationId(conversationId: String): String {
        val clean = conversationId.trim()
        require(conversationIdPattern.matches(clean)) {
            "Invalid history conversation id"
        }
        return clean
    }

    fun ensureProjectIndexFile(projectPath: String): File {
        val indexFile = projectIndexFile(projectPath)
        if (!indexFile.parentFile.exists()) {
            indexFile.parentFile.mkdirs()
        }
        if (!indexFile.exists()) {
            if (recoverProjectIndexFromBackup(indexFile) == null) {
                indexFile.atomicWriteText("[]", forceToDisk = true)
            }
        }
        return indexFile
    }

    fun readProjectIndex(indexFile: File): MutableList<HistoryConversationIndexEntry> {
        return readValidProjectIndex(indexFile)?.conversations
            ?: recoverProjectIndexFromBackup(indexFile)
            ?: mutableListOf()
    }

    fun readExistingProjectIndex(projectPath: String): List<HistoryConversationIndexEntry> {
        if (projectPath.isBlank()) return emptyList()
        val indexFile = projectIndexFile(projectPath)
        if ((!indexFile.exists() || !indexFile.isFile) && !projectIndexBackupFile(indexFile).isFile) {
            return emptyList()
        }
        return readProjectIndex(indexFile)
    }

    fun writeProjectIndex(indexFile: File, conversations: List<HistoryConversationIndexEntry>) {
        readValidProjectIndex(indexFile)?.let { current ->
            runCatching {
                projectIndexBackupFile(indexFile).atomicWriteText(current.text, forceToDisk = true)
            }
        }
        indexFile.atomicWriteText(json.encodeToString(conversations), forceToDisk = true)
    }

    private fun projectIndexBackupFile(indexFile: File): File {
        return File(indexFile.parentFile, "${indexFile.name}.bak")
    }

    private fun readValidProjectIndex(file: File): StoredProjectIndex? {
        if (!file.isFile) return null
        return runCatching {
            val text = file.readText()
            StoredProjectIndex(
                text = text,
                conversations = json.decodeFromString<List<HistoryConversationIndexEntry>>(text).toMutableList()
            )
        }.getOrNull()
    }

    private fun recoverProjectIndexFromBackup(indexFile: File): MutableList<HistoryConversationIndexEntry>? {
        val backup = readValidProjectIndex(projectIndexBackupFile(indexFile)) ?: return null
        runCatching {
            indexFile.atomicWriteText(backup.text, forceToDisk = true)
        }
        return backup.conversations
    }

    fun readEphemeralSessions(projectPath: String): MutableList<EphemeralSessionEntry> {
        if (projectPath.isBlank()) return mutableListOf()
        val file = ephemeralSessionsFile(projectPath)
        if (!file.exists() || !file.isFile) return mutableListOf()
        return runCatching {
            json.decodeFromString<List<EphemeralSessionEntry>>(file.readText()).toMutableList()
        }.getOrElse { mutableListOf() }
    }

    fun writeEphemeralSessions(projectPath: String, entries: List<EphemeralSessionEntry>) {
        if (projectPath.isBlank()) return
        val file = ephemeralSessionsFile(projectPath)
        if (entries.isEmpty()) {
            deleteHistoryFileIfExists(file)
            return
        }
        val parent = file.parentFile
        if (!parent.exists()) parent.mkdirs()
        file.atomicWriteText(json.encodeToString(entries))
    }

    fun removeEphemeralSession(projectPath: String, adapterName: String, sessionId: String) {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        if (cleanProjectPath.isBlank() || adapterName.isBlank() || sessionId.isBlank()) return
        val remaining = readEphemeralSessions(cleanProjectPath)
            .filterNot { it.adapterName == adapterName && it.sessionId == sessionId }
        writeEphemeralSessions(cleanProjectPath, remaining)
    }
}
