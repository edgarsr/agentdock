package agentdock.acp

import agentdock.history.AgentDockHistoryService
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

internal fun AcpClientService.initializeDownloadedAdaptersInBackground() {
    if (!startupInitializationStarted.compareAndSet(false, true)) return

    AcpAdapterConfig.getAllAdapters().values.forEach { adapterInfo ->
        val downloaded = runCatching { AcpAdapterPaths.isDownloaded(adapterInfo.id) }.getOrDefault(false)
        if (downloaded) initializeAdapterInBackground(adapterInfo.id)
    }
}

internal fun AcpClientService.initializeAdapterInBackground(adapterName: String) {
    val adapterInfo = AcpAdapterPaths.getAdapterInfo(adapterName)
    val adapterId = adapterInfo.id
    val downloaded = runCatching { AcpAdapterPaths.isDownloaded(adapterId) }.getOrDefault(false)
    if (!downloaded) return

    updateAdapterInitializationState(
        adapterId,
        AcpClientService.AdapterInitializationStatus.Initializing,
        detail = "Queued for startup..."
    )

    val job = scope.launch(start = CoroutineStart.LAZY) {
        val currentJob = coroutineContext[Job] ?: return@launch
        var ownedSharedProcess: AcpClientService.SharedProcess? = null
        try {
            AcpAdapterPaths.ensurePatched(adapterId)
            val sharedProcess = replaceSharedProcess(adapterId)
            ownedSharedProcess = sharedProcess
            startAndInitializeSharedProcess(sharedProcess, adapterInfo)

            if (adapterInitializationJobs[adapterId] !== currentJob) {
                stopOwnedSharedProcess(adapterId, sharedProcess)
                return@launch
            }

            updateAdapterInitializationState(adapterId, AcpClientService.AdapterInitializationStatus.Ready)
        } catch (_: CancellationException) {
            stopOwnedSharedProcess(adapterId, ownedSharedProcess)
            if (adapterInitializationJobs[adapterId] === currentJob) {
                updateAdapterInitializationState(adapterId, AcpClientService.AdapterInitializationStatus.NotStarted)
            }
        } catch (error: Exception) {
            if (adapterInitializationJobs[adapterId] === currentJob) {
                updateAdapterInitializationState(
                    adapterId,
                    AcpClientService.AdapterInitializationStatus.Failed,
                    formatAcpError(error)
                )
            }
        } finally {
            if (adapterInitializationJobs.remove(adapterId, currentJob)) {
                triggerBackgroundHistorySyncIfInitializationsSettled()
            }
        }
    }

    adapterInitializationJobs.put(adapterId, job)?.cancel()
    job.start()
}

private fun AcpClientService.stopOwnedSharedProcess(
    adapterId: String,
    sharedProcess: AcpClientService.SharedProcess?
) {
    if (sharedProcess != null && activeProcesses.remove(processKey(adapterId), sharedProcess)) {
        sharedProcess.stop()
    }
}

private fun AcpClientService.triggerBackgroundHistorySyncIfInitializationsSettled() {
    val projectPath = project.basePath?.takeIf { it.isNotBlank() } ?: return
    val downloadedAdapters = AcpAdapterConfig.getAllAdapters().values
        .filter { runCatching { AcpAdapterPaths.isDownloaded(it.id) }.getOrDefault(false) }
    if (downloadedAdapters.isEmpty()) return

    val hasPendingInitialization = downloadedAdapters.any { adapterInfo ->
        adapterInitializationState[adapterInfo.id] == AcpClientService.AdapterInitializationStatus.Initializing ||
            adapterInitializationJobs[adapterInfo.id]?.isActive == true
    }
    if (hasPendingInitialization) return
    if (!historySyncAfterInitializationInFlight.compareAndSet(false, true)) return

    scope.launch {
        try {
            AgentDockHistoryService.startBackgroundHistorySync(projectPath)
        } finally {
            historySyncAfterInitializationInFlight.set(false)
        }
    }
}

internal fun AcpClientService.resolveModelToApply(
    pref: String?,
    available: List<AcpAdapterConfig.ModelInfo>,
    default: String?
): String? {
    if (available.isEmpty()) return null
    val preference = pref?.trim().takeUnless { it.isNullOrEmpty() }
    return if (preference != null && available.any { it.modelId == preference }) {
        preference
    } else {
        default
    }
}

internal suspend fun AcpClientService.ensureSharedProcessStarted(
    sharedProcess: AcpClientService.SharedProcess,
    adapterInfo: AcpAdapterConfig.AdapterInfo,
    forceRestart: Boolean = false
) {
    if (forceRestart || !sharedProcess.isHealthy()) {
        updateAdapterInitializationState(
            adapterInfo.id,
            AcpClientService.AdapterInitializationStatus.Initializing,
            detail = "Starting adapter process..."
        )
        AcpAdapterPaths.ensurePatched(adapterInfo.id)

        try {
            startAndInitializeSharedProcess(sharedProcess, adapterInfo, forceRestart)
        } catch (error: Exception) {
            if (error is CancellationException) {
                // A caller cancelled while waiting for another initializer's
                // mutex must not overwrite that initializer's state.
                if (!sharedProcess.mutex.isLocked && !sharedProcess.isHealthy()) {
                    updateAdapterInitializationState(
                        adapterInfo.id,
                        AcpClientService.AdapterInitializationStatus.NotStarted
                    )
                }
            } else {
                updateAdapterInitializationState(
                    adapterInfo.id,
                    AcpClientService.AdapterInitializationStatus.Failed,
                    error = formatAcpError(error)
                )
            }
            throw error
        }
    }

    updateAdapterInitializationState(adapterInfo.id, AcpClientService.AdapterInitializationStatus.Ready)
    ensureAsyncSessionUpdates(sharedProcess)
}
