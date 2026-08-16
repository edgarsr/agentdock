package agentdock.changes

import kotlinx.serialization.Serializable
import agentdock.history.ProcessedFileState
import agentdock.history.AgentDockHistoryService
import java.time.Instant

@Serializable
data class ChangesState(
    val sessionId: String,
    val adapterName: String,
    val keptToolCallIds: List<String> = emptyList(),
    val processedFileStates: List<ProcessedFileState> = emptyList(),
    val updatedAt: Long = Instant.now().toEpochMilli()
)

object ChangesStateService {
    /**
     * Check if two file paths refer to the same file.
     * Handles relative vs absolute paths across Windows, Linux, and MacOS.
     */
    private fun pathsMatch(path1: String, path2: String): Boolean {
        val p1 = path1.replace("\\", "/")
        val p2 = path2.replace("\\", "/")

        if (p1 == p2) return true

        // Check if one path ends with the other (handles absolute vs relative)
        if (p1.endsWith("/$p2")) return true
        if (p2.endsWith("/$p1")) return true

        return false
    }
    fun hasState(projectPath: String, sessionId: String, adapterName: String): Boolean {
        return loadState(projectPath, sessionId, adapterName) != null
    }

    fun loadState(projectPath: String, sessionId: String, adapterName: String): ChangesState? {
        val current = AgentDockHistoryService.loadSessionChanges(projectPath, sessionId, adapterName)
        if (current != null) {
            return ChangesState(
                sessionId = sessionId,
                adapterName = adapterName,
                keptToolCallIds = current.keptToolCallIds,
                processedFileStates = current.processedFileStates,
                updatedAt = current.updatedAt
            )
        }
        return null
    }

    fun saveState(projectPath: String, state: ChangesState) {
        AgentDockHistoryService.saveSessionChanges(
            projectPath = projectPath,
            sessionId = state.sessionId,
            adapterName = state.adapterName,
            keptToolCallIds = state.keptToolCallIds,
            processedFileStates = state.processedFileStates
        )
    }

    fun ensureState(projectPath: String, sessionId: String, adapterName: String): ChangesState {
        val existing = loadState(projectPath, sessionId, adapterName)
        if (existing != null) return existing
        val created = ChangesState(sessionId, adapterName)
        saveState(projectPath, created)
        return created
    }

    fun markFileProcessed(
        projectPath: String,
        sessionId: String,
        adapterName: String,
        filePath: String,
        toolCallIds: List<String>
    ) {
        val current = loadState(projectPath, sessionId, adapterName) ?: ChangesState(sessionId, adapterName)
        val previous = current.processedFileStates.firstOrNull { pathsMatch(it.filePath, filePath) }
        val updated = current.processedFileStates
            .filterNot { pathsMatch(it.filePath, filePath) } + ProcessedFileState(
                filePath = filePath,
                toolCallIds = (previous?.toolCallIds.orEmpty() + toolCallIds).distinct()
            )
        saveState(projectPath, current.copy(processedFileStates = updated))
    }

    fun markAllProcessed(projectPath: String, sessionId: String, adapterName: String, toolCallIds: List<String>) {
        val current = loadState(projectPath, sessionId, adapterName) ?: ChangesState(sessionId, adapterName)
        saveState(projectPath, current.copy(
            keptToolCallIds = (
                current.keptToolCallIds
                    + current.processedFileStates.flatMap { it.toolCallIds }
                    + toolCallIds
                ).distinct(),
            processedFileStates = emptyList()
        ))
    }
}
