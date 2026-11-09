package agentdock.history

import agentdock.acp.AcpAdapterConfig
import agentdock.acp.AcpAdapterPaths
import agentdock.acp.AcpClientService
import agentdock.acp.listHistorySessions
import agentdock.acp.canListHistorySessions
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import kotlin.time.Duration.Companion.seconds

private val SESSION_LIST_TIMEOUT = 30.seconds

internal object HistorySyncService {
    private val log = Logger.getInstance(HistorySyncService::class.java)
    private val backgroundScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val ephemeralDeletionJobs = ConcurrentHashMap<String, Boolean>()
    private val projectSyncMutexes = ConcurrentHashMap<String, Mutex>()
    private val backgroundSyncCompleted = MutableSharedFlow<String>()
    val backgroundSyncCompletions = backgroundSyncCompleted.asSharedFlow()

    fun startBackgroundHistorySync(projectPath: String?) {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        if (cleanProjectPath.isBlank()) return
        backgroundScope.launch {
            try {
                syncProjectIndex(cleanProjectPath)
                backgroundSyncCompleted.emit(cleanProjectPath)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                log.warn("Background history sync failed for '$cleanProjectPath'", error)
            }
        }
    }

    fun getHistoryList(projectPath: String?): List<SessionMeta> {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        return buildHistoryList(cleanProjectPath, HistoryStorage.readExistingProjectIndex(cleanProjectPath))
    }

    suspend fun syncAndGetHistoryList(projectPath: String?): List<SessionMeta> {
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
        val usedAdapterNames = HistoryConversationIndexService.adapterNamesForConversation(conversation)
        return conversation.sessions.map { session ->
            SessionMeta(
                sessionId = session.sessionId,
                adapterName = session.adapterName,
                configOptions = session.configOptions,
                conversationId = conversation.id,
                sessionCount = conversation.sessions.size,
                promptCount = conversation.promptCount,
                projectPath = cleanProjectPath,
                title = title,
                filePath = session.sourceFilePath.orEmpty(),
                createdAt = session.createdAt,
                updatedAt = session.updatedAt,
                allAdapterNames = usedAdapterNames
            )
        }
    }

    private suspend fun syncProjectIndex(projectPath: String): List<HistoryConversationIndexEntry> {
        if (projectPath.isBlank()) return emptyList()
        val mutex = projectSyncMutexes.computeIfAbsent(projectPath) { Mutex() }
        return mutex.withLock {
            syncProjectIndexLocked(projectPath)
        }
    }

    private suspend fun syncProjectIndexLocked(projectPath: String): List<HistoryConversationIndexEntry> {
        // Listing can take up to SESSION_LIST_TIMEOUT, so the index is read only afterwards, under the index lock.
        val availableSessionResult = collectSyncedAvailableSessionMeta(projectPath)
        return synchronized(HistoryConversationIndexService) {
            applyAvailableSessions(projectPath, availableSessionResult)
        }
    }

    private fun applyAvailableSessions(
        projectPath: String,
        availableSessionResult: AvailableSessionMetaResult
    ): List<HistoryConversationIndexEntry> {
        val indexFile = HistoryStorage.ensureProjectIndexFile(projectPath)
        val rawExisting = HistoryStorage.readProjectIndex(indexFile)
        val existing = rawExisting.filter { conversation ->
            runCatching { HistoryStorage.requireSafeConversationId(conversation.id) }.isSuccess
        }
        val availableSessions = availableSessionResult.sessions
        val scannedAdapters = availableSessionResult.scannedAdapters

        val availableByKey = availableSessions.associateBy { "${it.adapterName}:${it.sessionId}" }
        val discoveredAt = System.currentTimeMillis()
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
                    createdAt = resolveSyncedCreatedAt(session.createdAt, meta.createdAt).orDiscovered(discoveredAt),
                    updatedAt = resolveSyncedUpdatedAt(session.updatedAt, meta.updatedAt).orDiscovered(discoveredAt),
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
                    && !conversation.titleUserSet
                    && syncedTitle != conversation.title
                val normalizedUsedAdapterNames = HistoryConversationIndexService.adapterNamesForConversation(conversation)
                if (normalizedUsedAdapterNames != conversation.usedAdapterNames) {
                    changed = true
                }
                val updatedConversation = if (needsTitleUpdate) {
                    changed = true
                    conversation.copy(
                        title = syncedTitle,
                        usedAdapterNames = normalizedUsedAdapterNames,
                        sessions = keptSessions
                    )
                } else {
                    conversation.copy(
                        usedAdapterNames = normalizedUsedAdapterNames,
                        sessions = keptSessions
                    )
                }
                updatedConversation
            }
        }

        val newConversations = availableSessions
            .filter { keptKeys.add("${it.adapterName}:${it.sessionId}") }
            .map { meta ->
                HistoryConversationIndexEntry(
                    id = HistoryEnvironment.conversationId(meta.adapterName, meta.sessionId),
                    title = meta.title,
                    promptCount = meta.promptCount,
                    sessions = listOf(
                        HistorySessionIndexEntry(
                            sessionId = meta.sessionId,
                            adapterName = meta.adapterName,
                            configOptions = meta.configOptions,
                            createdAt = meta.createdAt.orDiscovered(discoveredAt),
                            updatedAt = meta.updatedAt.orDiscovered(discoveredAt),
                            sourceFilePath = meta.filePath.takeIf { it.isNotBlank() },
                            changes = null
                        )
                    ),
                    usedAdapterNames = listOf(meta.adapterName)
                )
            }

        val combinedConversations = syncedExisting + newConversations
        if (newConversations.isNotEmpty()) {
            changed = true
        }
        if (changed) {
            HistoryStorage.writeProjectIndex(indexFile, combinedConversations)
        }
        deleteOrphanedConversationFiles(projectPath, combinedConversations)
        return combinedConversations
    }

    private suspend fun collectSyncedAvailableSessionMeta(projectPath: String): AvailableSessionMetaResult {
        val result = mutableListOf<SessionMeta>()
        val scannedAdapters = linkedSetOf<String>()
        val ephemeralEntries = HistoryStorage.readEphemeralSessions(projectPath)
        val ephemeralKeys = ephemeralEntries.associateBy { "${it.adapterName}:${it.sessionId}" }

        val acpSessions = collectSessionListMeta(projectPath)
        result.addAll(acpSessions.sessions)
        scannedAdapters.addAll(acpSessions.scannedAdapters)

        triggerEphemeralSessionDeletion(projectPath, ephemeralEntries, result)

        val visibleSessions = result
            .filterNot { meta ->
                val key = "${meta.adapterName}:${meta.sessionId}"
                if (ephemeralKeys[key] == null) return@filterNot false
                true
            }
            .sortedByDescending { it.updatedAt }
            .distinctBy { "${it.adapterName}:${it.sessionId}" }

        return AvailableSessionMetaResult(visibleSessions, scannedAdapters)
    }

    private suspend fun collectSessionListMeta(projectPath: String): AvailableSessionMetaResult = coroutineScope {
        val project = findOpenProject(projectPath)
            ?: return@coroutineScope AvailableSessionMetaResult(emptyList(), emptySet())
        val service = AcpClientService.getInstance(project)
        val adapters = AcpAdapterConfig.getAllAdapters().values
            .filter { it.supportsSessionList }
            .filter { adapterInfo ->
                try {
                    AcpAdapterPaths.isDownloaded(adapterInfo.id)
                } catch (error: Exception) {
                    log.warn("Unable to inspect installation state for adapter '${adapterInfo.id}'", error)
                    false
                }
            }
            .filter { service.isAdapterReady(it.id) }
            .filter(service::canListHistorySessions)

        val scans = adapters.map { adapterInfo ->
            async(Dispatchers.IO) {
                try {
                    val sessions = withTimeout(SESSION_LIST_TIMEOUT) {
                        service.listHistorySessions(adapterInfo, projectPath)
                    }
                    AdapterSessionScan(adapterInfo.id, sessions)
                } catch (error: TimeoutCancellationException) {
                    log.warn(
                        "Session list timed out for adapter '${adapterInfo.id}' after ${SESSION_LIST_TIMEOUT.inWholeMilliseconds}ms",
                        error
                    )
                    null
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    log.warn("Session list failed for adapter '${adapterInfo.id}'", error)
                    null
                }
            }
        }.awaitAll().filterNotNull()

        AvailableSessionMetaResult(
            sessions = scans.flatMap { it.sessions },
            scannedAdapters = scans.mapTo(linkedSetOf()) { it.adapterId }
        )
    }

    private fun findOpenProject(projectPath: String): Project? {
        val cleanProjectPath = canonicalHistoryProjectPath(projectPath)
        if (cleanProjectPath.isBlank()) return null
        return ProjectManager.getInstance().openProjects.firstOrNull { project ->
            canonicalHistoryProjectPath(project.basePath) == cleanProjectPath
        }
    }

    private fun triggerEphemeralSessionDeletion(
        projectPath: String,
        ephemeralEntries: List<EphemeralSessionEntry>,
        availableSessions: List<SessionMeta>
    ) {
        if (ephemeralEntries.isEmpty()) return

        val sessionsByKey = availableSessions.associateBy { "${it.adapterName}:${it.sessionId}" }
        ephemeralEntries.forEach { entry ->
            val key = "${entry.adapterName}:${entry.sessionId}"
            val sourceFilePath = sessionsByKey[key]?.filePath?.takeIf { it.isNotBlank() }
            scheduleEphemeralSessionDeletion(projectPath, entry.adapterName, entry.sessionId, sourceFilePath)
        }
    }

    private fun scheduleEphemeralSessionDeletion(
        projectPath: String,
        adapterName: String,
        sessionId: String,
        sourceFilePath: String?
    ) {
        val jobKey = "$projectPath||$adapterName:$sessionId"
        if (ephemeralDeletionJobs.putIfAbsent(jobKey, true) != null) return

        backgroundScope.launch {
            try {
                val deleted = runCatching {
                    SessionListDeleteSupport.deleteSession(
                        projectPath = projectPath,
                        adapterName = adapterName,
                        sessionId = sessionId,
                        sourceFilePath = sourceFilePath
                    )
                }.getOrDefault(false)
                // A session that cannot be deleted yet, e.g. while its agent is not running, stays listed for the next sync.
                if (deleted) {
                    HistoryStorage.removeEphemeralSession(projectPath, adapterName, sessionId)
                }
            } finally {
                ephemeralDeletionJobs.remove(jobKey)
            }
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
            val name = file.name
            val conversationId = when {
                file.isDirectory && name.endsWith(HistoryStorage.CONVERSATION_IMAGES_DIR_SUFFIX) ->
                    name.removeSuffix(HistoryStorage.CONVERSATION_IMAGES_DIR_SUFFIX)
                !file.isFile -> return@forEach
                name.endsWith(".json") -> name.removeSuffix(".json")
                name.endsWith(".transcript.txt") -> name.removeSuffix(".transcript.txt")
                name.endsWith(".search.txt") -> name.removeSuffix(".search.txt")
                else -> return@forEach
            }
            if (conversationId !in referencedIds) {
                runCatching { file.deleteRecursively() }
            }
        }
    }

    private fun buildHistoryList(
        projectPath: String,
        conversations: List<HistoryConversationIndexEntry>
    ): List<SessionMeta> {
        // One listing instead of a file check per conversation.
        val conversationsDir = HistoryStorage.projectConversationsDir(projectPath)
        val conversationFileNames = conversationsDir.list().orEmpty().toHashSet()
        return conversations
            .filter { runCatching { HistoryStorage.requireSafeConversationId(it.id) }.isSuccess }
            .mapNotNull { conversation ->
                val visibleSessions = conversation.sessions.filter { session ->
                    runCatching { AcpAdapterPaths.isDownloaded(session.adapterName) }.getOrDefault(false)
                }
                val latestSession = visibleSessions.maxByOrNull { it.updatedAt } ?: return@mapNotNull null
                val visibleAdapterNames = HistoryConversationIndexService.adapterNamesForConversation(conversation)
                    .filter { adapterName ->
                        runCatching { AcpAdapterPaths.isDownloaded(adapterName) }.getOrDefault(false)
                    }
                SessionMeta(
                    sessionId = latestSession.sessionId,
                    adapterName = latestSession.adapterName,
                    configOptions = latestSession.configOptions,
                    conversationId = conversation.id,
                    sessionCount = visibleSessions.size,
                    promptCount = conversation.promptCount,
                    projectPath = projectPath,
                    title = conversation.title.ifBlank { "Untitled" },
                    filePath = latestSession.sourceFilePath.orEmpty(),
                    dataFilePath = "${conversation.id}.json".takeIf { it in conversationFileNames }
                        ?.let { File(conversationsDir, it).path },
                    createdAt = latestSession.createdAt,
                    updatedAt = latestSession.updatedAt,
                    deletable = conversation.sessions.all { session ->
                        SessionListDeleteSupport.canDeleteSession(session.adapterName)
                    },
                    allAdapterNames = visibleAdapterNames.ifEmpty {
                        visibleSessions.map { it.adapterName }.distinct()
                    },
                    pinned = conversation.pinned,
                    archived = conversation.archived,
                    group = conversation.group
                )
            }.sortedWith(compareByDescending<SessionMeta> { it.pinned }.thenByDescending { it.updatedAt })
    }

    private data class AdapterSessionScan(
        val adapterId: String,
        val sessions: List<SessionMeta>
    )
}

/** Agents that omit session timestamps are pinned to the moment the plugin first saw the session. */
private fun Long.orDiscovered(discoveredAt: Long): Long = if (this > 0L) this else discoveredAt

internal fun resolveSyncedCreatedAt(currentCreatedAt: Long, discoveredCreatedAt: Long): Long {
    return when {
        currentCreatedAt > 0L && discoveredCreatedAt > 0L -> minOf(currentCreatedAt, discoveredCreatedAt)
        currentCreatedAt > 0L -> currentCreatedAt
        else -> discoveredCreatedAt
    }
}

internal fun resolveSyncedUpdatedAt(currentUpdatedAt: Long, discoveredUpdatedAt: Long): Long {
    return when {
        currentUpdatedAt > 0L && discoveredUpdatedAt > 0L -> maxOf(currentUpdatedAt, discoveredUpdatedAt)
        currentUpdatedAt > 0L -> currentUpdatedAt
        else -> discoveredUpdatedAt
    }
}
