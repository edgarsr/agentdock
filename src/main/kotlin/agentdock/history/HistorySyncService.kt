package agentdock.history

import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import agentdock.acp.AcpAdapterConfig
import agentdock.acp.AcpAdapterPaths
import agentdock.acp.AcpClientService
import agentdock.acp.listHistorySessions
import java.util.concurrent.ConcurrentHashMap

internal object HistorySyncService {
    private val backgroundScope = CoroutineScope(Dispatchers.IO)
    private val ephemeralDeletionJobs = ConcurrentHashMap<String, Boolean>()

    fun startBackgroundHistorySync(projectPath: String?) {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        if (cleanProjectPath.isBlank()) return
        backgroundScope.launch {
            syncProjectIndex(cleanProjectPath)
        }
    }

    fun syncHistoryIndex(projectPath: String?): Boolean {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        if (cleanProjectPath.isBlank()) return false
        syncProjectIndex(cleanProjectPath)
        return true
    }

    fun getHistoryList(projectPath: String?): List<SessionMeta> {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        return buildHistoryList(cleanProjectPath, HistoryStorage.readExistingProjectIndex(cleanProjectPath))
    }

    fun syncAndGetHistoryList(projectPath: String?): List<SessionMeta> {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        return buildHistoryList(cleanProjectPath, syncProjectIndex(cleanProjectPath))
    }

    fun getConversationSessions(projectPath: String?, conversationId: String?): List<SessionMeta> {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        val cleanConversationId = runCatching {
            HistoryStorage.requireSafeConversationId(conversationId.orEmpty())
        }.getOrElse { return emptyList() }
        if (cleanProjectPath.isBlank() || cleanConversationId.isBlank()) return emptyList()

        val conversation = HistoryStorage.readExistingProjectIndex(cleanProjectPath)
            .firstOrNull { it.id == cleanConversationId }
            ?: return emptyList()

        val title = conversation.title.ifBlank { "Untitled" }
        return conversation.sessions.map { session ->
            SessionMeta(
                sessionId = session.sessionId,
                adapterName = session.adapterName,
                conversationId = conversation.id,
                sessionCount = conversation.sessions.size,
                promptCount = conversation.promptCount,
                projectPath = cleanProjectPath,
                title = title,
                filePath = session.sourceFilePath.orEmpty(),
                createdAt = session.createdAt,
                updatedAt = session.updatedAt,
                allAdapterNames = conversation.sessions.map { it.adapterName }.distinct()
            )
        }
    }

    private fun syncProjectIndex(projectPath: String): List<HistoryConversationIndexEntry> {
        if (projectPath.isBlank()) return emptyList()

        val indexFile = HistoryStorage.ensureProjectIndexFile(projectPath)
        val rawExisting = HistoryStorage.readProjectIndex(indexFile)
        val existing = rawExisting.filter { conversation ->
            runCatching { HistoryStorage.requireSafeConversationId(conversation.id) }.isSuccess
        }
        val availableSessionResult = collectSyncedAvailableSessionMeta(projectPath)
        val availableSessions = availableSessionResult.sessions
        val scannedAdapters = availableSessionResult.scannedAdapters

        val availableByKey = availableSessions.associateBy { "${it.adapterName}:${it.sessionId}" }
        val keptKeys = linkedSetOf<String>()
        var changed = existing.size != rawExisting.size

        val syncedExisting = existing.mapNotNull { conversation ->
            val keptSessions = conversation.sessions.mapNotNull { session ->
                val key = "${session.adapterName}:${session.sessionId}"
                val meta = availableByKey[key]
                if (meta == null) {
                    if (session.adapterName in scannedAdapters) return@mapNotNull null
                    if (!keptKeys.add(key)) return@mapNotNull null
                    return@mapNotNull session
                }
                if (!keptKeys.add(key)) return@mapNotNull null
                val syncedSession = session.copy(
                    createdAt = if (session.createdAt > 0) minOf(session.createdAt, meta.createdAt) else meta.createdAt,
                    updatedAt = resolveSyncedUpdatedAt(session.updatedAt, meta.updatedAt),
                    sourceFilePath = meta.filePath.takeIf { it.isNotBlank() } ?: session.sourceFilePath
                )
                if (syncedSession != session) {
                    changed = true
                }
                syncedSession
            }

            if (keptSessions.isEmpty()) {
                changed = true
                HistoryReplayStore.deleteConversationReplay(projectPath, conversation.id)
                null
            } else {
                if (keptSessions.size != conversation.sessions.size) {
                    changed = true
                    val latestOriginalSession = conversation.sessions.maxByOrNull { it.updatedAt }
                    if (latestOriginalSession != null && keptSessions.none {
                        it.sessionId == latestOriginalSession.sessionId && it.adapterName == latestOriginalSession.adapterName
                    }) {
                        HistoryReplayStore.deleteConversationReplay(projectPath, conversation.id)
                    }
                }
                val syncedTitle = keptSessions.firstNotNullOfOrNull { session ->
                    val key = "${session.adapterName}:${session.sessionId}"
                    availableByKey[key]?.title?.takeIf { it.isNotBlank() }
                }
                val needsTitleUpdate = syncedTitle != null
                    && (conversation.title.isBlank() || conversation.title == "Untitled Session")
                    && syncedTitle != conversation.title
                val updatedConversation = if (needsTitleUpdate) {
                    changed = true
                    conversation.copy(title = syncedTitle, sessions = keptSessions)
                } else {
                    conversation.copy(sessions = keptSessions)
                }
                updatedConversation
            }
        }.toMutableList()

        val newConversations = availableSessions
            .filter { keptKeys.add("${it.adapterName}:${it.sessionId}") }
            .map { meta ->
                HistoryConversationIndexEntry(
                    id = HistoryEnvironment.conversationId(meta.adapterName, meta.sessionId),
                    title = meta.title,
                    sessions = listOf(
                        HistorySessionIndexEntry(
                            sessionId = meta.sessionId,
                            adapterName = meta.adapterName,
                            createdAt = meta.createdAt,
                            updatedAt = meta.updatedAt,
                            sourceFilePath = meta.filePath.takeIf { it.isNotBlank() },
                            changes = null
                        )
                    )
                )
            }

        val combinedConversations = syncedExisting + newConversations
        syncedExisting.addAll(newConversations)
        if (newConversations.isNotEmpty()) {
            changed = true
        }
        if (changed) {
            HistoryStorage.writeProjectIndex(indexFile, combinedConversations)
        }
        deleteOrphanedConversationFiles(projectPath, combinedConversations)
        return combinedConversations
    }

    private fun collectSyncedAvailableSessionMeta(projectPath: String): AvailableSessionMetaResult {
        val result = mutableListOf<SessionMeta>()
        val scannedAdapters = linkedSetOf<String>()
        val ephemeralKeys = HistoryStorage.readEphemeralSessions(projectPath)
            .associateBy { "${it.adapterName}:${it.sessionId}" }

        val acpSessions = collectSessionListMeta(projectPath)
        result.addAll(acpSessions.sessions)
        scannedAdapters.addAll(acpSessions.scannedAdapters)

        AdapterHistoryRegistry.all().forEach { history ->
            if (runCatching { AcpAdapterConfig.getAdapterInfo(history.adapterId).supportsSessionList }.getOrDefault(true)) {
                return@forEach
            }
            if (!AcpAdapterPaths.isDownloaded(history.adapterId)) return@forEach
            runCatching {
                history.collectSessions(projectPath)
            }.onSuccess { sessions ->
                result.addAll(sessions)
                scannedAdapters.add(history.adapterId)
            }
        }

        val availableKeys = result.mapTo(hashSetOf()) { "${it.adapterName}:${it.sessionId}" }
        pruneStaleEphemeralSessions(projectPath, scannedAdapters, availableKeys)

        val visibleSessions = result
            .filterNot { meta ->
                val key = "${meta.adapterName}:${meta.sessionId}"
                if (ephemeralKeys[key] == null) return@filterNot false
                scheduleEphemeralSessionDeletion(projectPath, meta)
                true
            }
            .sortedByDescending { it.updatedAt }
            .distinctBy { "${it.adapterName}:${it.sessionId}" }

        return AvailableSessionMetaResult(visibleSessions, scannedAdapters)
    }

    private fun collectSessionListMeta(projectPath: String): AvailableSessionMetaResult {
        val project = findOpenProject(projectPath) ?: return AvailableSessionMetaResult(emptyList(), emptySet())
        val service = AcpClientService.getInstance(project)
        val adapters = AcpAdapterConfig.getAllAdapters().values
            .filter { it.supportsSessionList }
            .filter { AcpAdapterPaths.isDownloaded(it.id) }

        return runBlocking {
            val sessions = mutableListOf<SessionMeta>()
            val scannedAdapters = linkedSetOf<String>()
            adapters.forEach { adapterInfo ->
                if (!service.isAdapterReady(adapterInfo.id)) return@forEach
                runCatching {
                    service.listHistorySessions(adapterInfo, projectPath)
                }.onSuccess { adapterSessions ->
                    sessions.addAll(adapterSessions)
                    scannedAdapters.add(adapterInfo.id)
                }
            }
            AvailableSessionMetaResult(sessions, scannedAdapters)
        }
    }

    private fun findOpenProject(projectPath: String): Project? {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        if (cleanProjectPath.isBlank()) return null
        return ProjectManager.getInstance().openProjects.firstOrNull { project ->
            canonicalHistoryProjectPath(project.basePath) == cleanProjectPath
        }
    }

    private fun pruneStaleEphemeralSessions(
        projectPath: String,
        scannedAdapters: Set<String>,
        availableKeys: Set<String>
    ) {
        if (scannedAdapters.isEmpty()) return
        val existing = HistoryStorage.readEphemeralSessions(projectPath)
        val remaining = existing.filter { entry ->
            entry.adapterName !in scannedAdapters || "${entry.adapterName}:${entry.sessionId}" in availableKeys
        }
        if (remaining.size != existing.size) {
            HistoryStorage.writeEphemeralSessions(projectPath, remaining)
        }
    }

    private fun scheduleEphemeralSessionDeletion(projectPath: String, session: SessionMeta) {
        val jobKey = HistoryEnvironment.historySyncKey(projectPath) + "||${session.adapterName}:${session.sessionId}"
        if (ephemeralDeletionJobs.putIfAbsent(jobKey, true) != null) return

        backgroundScope.launch {
            try {
                val deleted = SessionListDeleteSupport.deleteSession(
                    projectPath = projectPath,
                    adapterName = session.adapterName,
                    sessionId = session.sessionId,
                    sourceFilePath = session.filePath.takeIf { it.isNotBlank() }
                )
                if (deleted) {
                    HistoryStorage.removeEphemeralSession(projectPath, session.adapterName, session.sessionId)
                }
            } finally {
                ephemeralDeletionJobs.remove(jobKey)
            }
        }
    }

    private fun resolveSyncedUpdatedAt(currentUpdatedAt: Long, discoveredUpdatedAt: Long): Long {
        return when {
            currentUpdatedAt > 0L && discoveredUpdatedAt > 0L -> maxOf(currentUpdatedAt, discoveredUpdatedAt)
            currentUpdatedAt > 0L -> currentUpdatedAt
            else -> discoveredUpdatedAt
        }
    }

    private fun deleteOrphanedConversationFiles(
        projectPath: String,
        conversations: List<HistoryConversationIndexEntry>
    ) {
        val conversationsDir = HistoryStorage.projectConversationsDir(projectPath)
        if (!conversationsDir.exists() || !conversationsDir.isDirectory) return
        val referencedIds = conversations.mapTo(hashSetOf()) { it.id }
        conversationsDir.listFiles()?.forEach { file ->
            if (!file.isFile) return@forEach
            val name = file.name
            val conversationId = when {
                name.endsWith(".json") -> name.removeSuffix(".json")
                name.endsWith(".transcript.txt") -> name.removeSuffix(".transcript.txt")
                else -> return@forEach
            }
            if (conversationId !in referencedIds) {
                runCatching { file.delete() }
            }
        }
    }

    private fun buildHistoryList(
        projectPath: String,
        conversations: List<HistoryConversationIndexEntry>
    ): List<SessionMeta> {
        return conversations
            .filter { runCatching { HistoryStorage.requireSafeConversationId(it.id) }.isSuccess }
            .mapNotNull { conversation ->
                val visibleSessions = conversation.sessions.filter { session ->
                    runCatching { AcpAdapterPaths.isDownloaded(session.adapterName) }.getOrDefault(false)
                }
                val latestSession = visibleSessions.maxByOrNull { it.updatedAt } ?: return@mapNotNull null
                SessionMeta(
                    sessionId = latestSession.sessionId,
                    adapterName = latestSession.adapterName,
                    conversationId = conversation.id,
                    sessionCount = visibleSessions.size,
                    promptCount = conversation.promptCount,
                    projectPath = projectPath,
                    title = conversation.title.ifBlank { "Untitled" },
                    filePath = latestSession.sourceFilePath.orEmpty(),
                    createdAt = latestSession.createdAt,
                    updatedAt = latestSession.updatedAt,
                    allAdapterNames = visibleSessions.map { it.adapterName }.distinct()
                )
            }.sortedByDescending { it.updatedAt }
    }
}
