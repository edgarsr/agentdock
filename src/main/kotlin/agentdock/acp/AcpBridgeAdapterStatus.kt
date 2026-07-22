package agentdock.acp

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import agentdock.IdeTheme
import agentdock.utils.escapeForJsString
import com.intellij.openapi.diagnostic.Logger
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import com.agentclientprotocol.model.AuthMethod

private const val RUNTIME_CHECK_MAX_ATTEMPTS = 3
private const val RUNTIME_CHECK_RETRY_DELAY_MS = 1_000L
private val LOG = Logger.getInstance("agentdock.acp.AcpBridgeAdapterStatus")

private fun downloadProbeKey(target: AcpExecutionTarget, adapterId: String) = "${target.name}:$adapterId"

private suspend fun runRuntimeCheckWithRetries(check: suspend (attempt: Int) -> Boolean): Boolean {
    for (attempt in 1..RUNTIME_CHECK_MAX_ATTEMPTS) {
        if (check(attempt)) return true
        if (attempt < RUNTIME_CHECK_MAX_ATTEMPTS) delay(RUNTIME_CHECK_RETRY_DELAY_MS)
    }
    return false
}

private fun <K> AcpBridge.launchRuntimeCheck(
    jobs: ConcurrentHashMap<K, Job>,
    key: K,
    check: suspend () -> Unit
) {
    val job = scope.launch(Dispatchers.IO, start = CoroutineStart.LAZY) { check() }
    job.invokeOnCompletion {
        jobs.remove(key, job)
        finishFullAdapterRefreshIfIdle()
    }
    val selected = jobs.compute(key) { _, current ->
        current?.takeUnless { it.isCompleted } ?: job
    } === job
    if (selected) job.start() else job.cancel()
}

private fun parseAgentVersion(config: AcpAdapterConfig.AgentVersionConfig, output: String): String? {
    if (output.isBlank()) return null
    val pattern = config.pattern
    if (!pattern.isNullOrBlank()) {
        val match = Regex(pattern).find(output) ?: return null
        return (match.groups[1]?.value ?: match.value).takeIf { it.isNotBlank() }
    }
    return Regex("""(\d+\.\d+[\d.\-]*)""").find(output)?.groupValues?.get(1)?.takeIf { it.isNotBlank() }
}

private fun AcpAdapterConfig.AdapterInfo.resolveIconPath(): String? {
    val themePath = if (IdeTheme.isDarkTheme()) iconPathDark else iconPathLight
    return themePath?.takeIf { it.isNotBlank() } ?: iconPath
}

private fun iconMimeType(path: String): String {
    val normalized = path.lowercase()
    return when {
        normalized.endsWith(".png") -> "image/png"
        normalized.endsWith(".webp") -> "image/webp"
        normalized.endsWith(".jpg") || normalized.endsWith(".jpeg") -> "image/jpeg"
        else -> "image/svg+xml"
    }
}

private fun loadIconDataUrl(path: String?): String {
    val resourcePath = path?.takeIf { it.isNotBlank() } ?: return ""
    return try {
        val stream = AcpAdapterConfig::class.java.getResourceAsStream(resourcePath)
        if (stream != null) {
            val bytes = stream.use { it.readBytes() }
            val b64 = java.util.Base64.getEncoder().encodeToString(bytes)
            "data:${iconMimeType(resourcePath)};base64,$b64"
        } else ""
    } catch (_: Exception) {
        ""
    }
}

private fun AcpAdapterConfig.ModeInfo.toReasoningEffortPayload(): AdapterReasoningEffortPayload {
    return AdapterReasoningEffortPayload(id, name, description.orEmpty())
}

private fun AcpAdapterConfig.ModeInfo.toModePayload(): AdapterModePayload {
    return AdapterModePayload(id, name, description.orEmpty())
}

internal fun AcpBridge.setDownloadProbeState(
    adapterId: String,
    target: AcpExecutionTarget,
    downloaded: Boolean,
    installedVersion: String? = null
) {
    val key = downloadProbeKey(target, adapterId)
    downloadProbeJobs.remove(key)?.cancel()
    downloadProbeStates[key] = AdapterDownloadProbeState(
        downloaded = downloaded,
        downloadedKnown = true,
        installedVersion = installedVersion
    )
}

@OptIn(com.agentclientprotocol.annotations.UnstableApi::class)
private fun AcpBridge.buildAdapterPayload(
    info: AcpAdapterConfig.AdapterInfo,
    target: AcpExecutionTarget,
    preferences: AcpAgentPreferencesState
): AdapterPayload {
    val probeState = downloadProbeStates[downloadProbeKey(target, info.id)]
    val downloadedKnown = probeState?.downloadedKnown == true
    val downloaded = probeState?.downloaded
    val initStatus = service.adapterInitializationStatus(info.id)
    val isInitializing = initStatus == AcpClientService.AdapterInitializationStatus.Initializing

    val dlStatus = downloadStatuses[info.id] ?: ""
    val isDownloading = dlStatus.isNotEmpty() && !dlStatus.startsWith("Error")
    val usesAcpLogin = info.loginMethod == "acp"
    val authMethods = if (usesAcpLogin) {
        service.adapterAuthMethods(info.id).mapNotNull { method ->
            when (method) {
                is AuthMethod.AgentAuth, is AuthMethod.TerminalAuth -> AdapterAuthMethodPayload(
                    id = method.id.value,
                    name = method.name,
                    description = method.description.orEmpty()
                )
                else -> null
            }
        }
    } else {
        emptyList()
    }
    val logoutAvailable = when (info.logoutMethod) {
        "acp" -> service.isAdapterLogoutAvailable(info.id)
        "cli" -> info.logoutArgs.isNotEmpty()
        else -> false
    }
    val installedVersion = probeState?.installedVersion
    val rawAgentVersion = agentVersionStates[info.id]
    val agentVersion = rawAgentVersion?.takeIf { it != installedVersion }
    val isStaticUpdateAvailable = downloaded == true &&
        !installedVersion.isNullOrBlank() &&
        installedVersion != info.getConfiguredVersion()
    val updateSupported = downloaded == true &&
        (AcpAdapterUpdates.isUpdateCheckSupported(info) || isStaticUpdateAvailable)
    val updateKey = "${target.name}:${info.id}"
    val updateChecking = updateCheckJobs[updateKey]?.isActive == true
    val latestVersion = if (!updateSupported) {
        null
    } else if (AcpAdapterUpdates.isUpdateCheckSupported(info)) {
        latestVersionStates[info.id]
    } else {
        info.getConfiguredVersion()
    }
    val updateKnown = updateSupported && !latestVersion.isNullOrBlank() && !installedVersion.isNullOrBlank()
    val updateAvailable = updateKnown && latestVersion != installedVersion
    val isAuthenticating = authActionJobs[info.id]?.isActive == true
    val cliAvailable = downloaded == true && info.cli != null && cli.isIdeTerminalAvailable()
    val rawInitError = service.adapterInitializationError(info.id) ?: ""
    val initializationDetail = if (isInitializing) service.adapterInitializationDetail(info.id).orEmpty() else ""
    val initError = rawInitError

    val isReady = when {
        !downloadedKnown -> null
        initStatus == AcpClientService.AdapterInitializationStatus.NotStarted -> false
        initStatus == AcpClientService.AdapterInitializationStatus.Failed -> false
        initStatus != AcpClientService.AdapterInitializationStatus.Ready -> null
        !service.isAdapterReady(info.id) -> false
        else -> true
    }
    val readyKnown = isReady != null

    val savedPreference = preferences.agents[info.id]
    val rawRuntimeMetadata = service.adapterRuntimeMetadata(info.id)
        ?: AcpClientService.AdapterRuntimeMetadata(
            currentModelId = null,
            availableModels = emptyList(),
            currentModeId = null,
            availableModes = emptyList(),
            currentReasoningEffortId = null,
            availableReasoningEfforts = emptyList()
        )
    val resolvedCurrentModelId = savedPreference?.modelId
        ?.takeIf { preferred ->
            rawRuntimeMetadata.availableModels.isEmpty() || rawRuntimeMetadata.availableModels.any { it.modelId == preferred }
        }
        ?: rawRuntimeMetadata.currentModelId
    val resolvedAvailableModes = rawRuntimeMetadata.modesForModel(resolvedCurrentModelId)
    val resolvedCurrentModeId = savedPreference?.modeId
        ?.takeIf { preferred -> resolvedAvailableModes.any { it.id == preferred } }
        ?: rawRuntimeMetadata.currentModeId
            ?.takeIf { current -> resolvedAvailableModes.any { it.id == current } }
        ?: resolvedAvailableModes.firstOrNull()?.id
    val resolvedAvailableReasoningEfforts = rawRuntimeMetadata.reasoningEffortsForModel(resolvedCurrentModelId)
    val resolvedCurrentReasoningEffortId = savedPreference?.reasoningEffortId
        ?.takeIf { preferred -> resolvedAvailableReasoningEfforts.any { it.id == preferred } }
        ?: rawRuntimeMetadata.currentReasoningEffortId
            ?.takeIf { current -> resolvedAvailableReasoningEfforts.any { it.id == current } }
        ?: resolvedAvailableReasoningEfforts.firstOrNull()?.id
    val resolvedReasoningEffortConfigId = rawRuntimeMetadata.reasoningEffortConfigId
    val runtimeMetadata = rawRuntimeMetadata.copy(
        currentModelId = resolvedCurrentModelId,
        currentModeId = resolvedCurrentModeId,
        availableModes = resolvedAvailableModes,
        currentReasoningEffortId = resolvedCurrentReasoningEffortId,
        availableReasoningEfforts = resolvedAvailableReasoningEfforts,
        reasoningEffortConfigId = resolvedReasoningEffortConfigId
    )

    return AdapterPayload(
        id = info.id,
        name = info.name,
        iconPath = loadIconDataUrl(info.resolveIconPath()),
        isLastUsed = info.id == preferences.lastAgentId,
        currentModelId = runtimeMetadata.currentModelId ?: "",
        availableModels = runtimeMetadata.availableModels.map {
            AdapterModelPayload(it.modelId, it.name, it.description.orEmpty())
        },
        currentModeId = runtimeMetadata.currentModeId ?: "",
        availableModes = runtimeMetadata.availableModes.map {
            AdapterModePayload(it.id, it.name, it.description.orEmpty())
        },
        availableModesByModel = runtimeMetadata.availableModesByModel.mapValues { (_, modes) ->
            modes.map { it.toModePayload() }
        },
        currentReasoningEffortId = runtimeMetadata.currentReasoningEffortId ?: "",
        availableReasoningEfforts = runtimeMetadata.availableReasoningEfforts.map {
            it.toReasoningEffortPayload()
        },
        reasoningEffortsByModel = runtimeMetadata.availableReasoningEffortsByModel.mapValues { (_, efforts) ->
            efforts.map { it.toReasoningEffortPayload() }
        },
        downloaded = downloaded,
        downloadedKnown = downloadedKnown,
        downloadPath = if (downloaded == true) AcpAdapterPaths.getDownloadPath(info.id, target) else "",
        loginMethod = info.loginMethod,
        authMethods = authMethods,
        authenticating = isAuthenticating,
        authenticatingMethodId = authActionMethodIds[info.id].orEmpty(),
        authError = authErrors[info.id].orEmpty(),
        loginStatusSupported = info.loginStatusMethod != null,
        loggedIn = loginStatusStates[info.id],
        logoutAvailable = logoutAvailable,
        initializing = isInitializing,
        initializationDetail = initializationDetail,
        initializationError = initError,
        ready = isReady,
        readyKnown = readyKnown,
        installedVersion = installedVersion,
        agentVersion = agentVersion,
        latestVersion = latestVersion,
        updateSupported = updateSupported,
        updateChecking = updateChecking,
        updateKnown = updateKnown,
        updateAvailable = updateAvailable,
        downloading = isDownloading,
        downloadStatus = dlStatus,
        disabledModels = info.disabledModels,
        cliAvailable = cliAvailable
    )
}

private fun AcpBridge.ensureDownloadProbeStarted(
    info: AcpAdapterConfig.AdapterInfo,
    target: AcpExecutionTarget
) {
    val key = downloadProbeKey(target, info.id)
    if (downloadProbeStates[key]?.downloadedKnown == true) return

    launchRuntimeCheck(downloadProbeJobs, key) {
        val succeeded = runRuntimeCheckWithRetries { attempt ->
            try {
                val downloaded = AcpAdapterPaths.isDownloaded(adapterName = info.id, target = target)
                downloadProbeStates[key] = AdapterDownloadProbeState(
                    downloaded = downloaded,
                    downloadedKnown = true,
                    installedVersion = if (downloaded) AcpAdapterPaths.installedVersion(info.id, target) else null
                )
                if (
                    downloaded &&
                    !service.isAdapterReady(info.id) &&
                    service.adapterInitializationStatus(info.id) != AcpClientService.AdapterInitializationStatus.Initializing
                ) {
                    service.initializeAdapterInBackground(info.id)
                }
                true
            } catch (error: Exception) {
                downloadProbeStates.remove(key)
                LOG.warn(
                    "Adapter download probe failed for '${info.id}' " +
                        "(attempt $attempt/$RUNTIME_CHECK_MAX_ATTEMPTS)",
                    error
                )
                false
            }
        }
        pushAdapters(
            includeRuntimeChecks = succeeded,
            adapterIdToRefresh = info.id.takeIf { succeeded }
        )
    }
}

private fun AcpBridge.ensureLoginStatusCheckStarted(
    info: AcpAdapterConfig.AdapterInfo,
    target: AcpExecutionTarget,
    force: Boolean = false
) {
    if (info.loginStatusMethod == null) return
    val stageForFullRefresh = fullAdapterRefreshInProgress.get()
    if (stageForFullRefresh && completedLoginStatusRefreshes.contains(info.id)) return
    if (!force && loginStatusStates.containsKey(info.id)) return

    launchRuntimeCheck(loginStatusJobs, info.id) {
        runRuntimeCheckWithRetries { attempt ->
            try {
                val loggedIn = AcpLoginStatus.resolve(info, target)
                if (loggedIn != null) {
                    if (stageForFullRefresh) {
                        pendingLoginStatusStates[info.id] = loggedIn
                    } else {
                        loginStatusStates[info.id] = loggedIn
                    }
                    true
                } else {
                    LOG.warn(
                        "Login status check returned no result for '${info.id}' " +
                            "(attempt $attempt/$RUNTIME_CHECK_MAX_ATTEMPTS)"
                    )
                    false
                }
            } catch (error: Exception) {
                LOG.warn(
                    "Login status check failed for '${info.id}' " +
                        "(attempt $attempt/$RUNTIME_CHECK_MAX_ATTEMPTS)",
                    error
                )
                false
            }
        }
        if (stageForFullRefresh) completedLoginStatusRefreshes.add(info.id)
        if (!stageForFullRefresh) pushAdapters()
    }
}

internal fun AcpBridge.refreshAdapterLoginStatus(adapterId: String) {
    val info = runCatching { AcpAdapterConfig.getAdapterInfo(adapterId) }.getOrNull()
    if (info?.loginStatusMethod == null) {
        pushAdapters()
        return
    }

    val target = AcpAdapterPaths.getExecutionTarget()
    loginStatusJobs.remove(adapterId)?.cancel()
    pushAdapters()
    ensureLoginStatusCheckStarted(info, target, force = true)
}

internal fun AcpBridge.pushAdapters(
    includeRuntimeChecks: Boolean = false,
    adapterIdToRefresh: String? = null
) {
    try {
        val unique = linkedMapOf<String, AcpAdapterConfig.AdapterInfo>()
        AcpAdapterConfig.getAllAdapters().values.forEach { info -> unique[info.id] = info }
        val target = AcpAdapterPaths.getExecutionTarget()

        if (includeRuntimeChecks) {
            unique.values.forEach { info ->
                if (adapterIdToRefresh != null && info.id != adapterIdToRefresh) return@forEach
                ensureDownloadProbeStarted(info, target)
            }
        }

        val preferences = AcpAgentPreferencesStore.load()

        val adapters = unique.values.sortedBy { it.name.lowercase() }.map { info ->
            buildAdapterPayload(
                info = info,
                target = target,
                preferences = preferences
            )
        }

        val payload = adapterJson.encodeToString(adapters)
        val escaped = payload.escapeForJsString()
        runOnEdt {
            browser.cefBrowser.executeJavaScript(
                "if(window.__onAdapters) window.__onAdapters(JSON.parse('$escaped'));",
                browser.cefBrowser.url, 0
            )
        }

        unique.values.forEach { info ->
            if (!includeRuntimeChecks) return@forEach
            if (adapterIdToRefresh != null && info.id != adapterIdToRefresh) return@forEach
            if (info.loginStatusMethod == null) return@forEach
            if (adapters.firstOrNull { it.id == info.id }?.downloaded != true) return@forEach
            ensureLoginStatusCheckStarted(
                info = info,
                target = target,
                force = fullAdapterRefreshInProgress.get()
            )
        }

        unique.values.forEach { info ->
            if (!includeRuntimeChecks) return@forEach
            if (adapterIdToRefresh != null && info.id != adapterIdToRefresh) return@forEach
            val key = "${target.name}:${info.id}"
            if (updateCheckJobs[key]?.isActive == true) return@forEach
            val downloaded = adapters.firstOrNull { it.id == info.id }?.downloaded == true
            if (!downloaded || !AcpAdapterUpdates.isUpdateCheckSupported(info)) return@forEach
            if (!latestVersionStates[info.id].isNullOrBlank()) return@forEach

            launchRuntimeCheck(updateCheckJobs, key) {
                runRuntimeCheckWithRetries { attempt ->
                    try {
                        val latest = AcpAdapterUpdates.latestAvailableVersion(info)
                        if (!latest.isNullOrBlank()) {
                            latestVersionStates[info.id] = latest
                            return@runRuntimeCheckWithRetries true
                        }
                        LOG.warn(
                            "Adapter update check returned no version for '${info.id}' " +
                                "(attempt $attempt/$RUNTIME_CHECK_MAX_ATTEMPTS)"
                        )
                    } catch (error: Exception) {
                        LOG.warn(
                            "Adapter update check failed for '${info.id}' " +
                                "(attempt $attempt/$RUNTIME_CHECK_MAX_ATTEMPTS)",
                            error
                        )
                    }
                    false
                }
                pushAdapters()
            }
        }

        unique.values.forEach { info ->
            if (!includeRuntimeChecks) return@forEach
            if (adapterIdToRefresh != null && info.id != adapterIdToRefresh) return@forEach
            if (info.agentVersionConfig == null) return@forEach
            if (agentVersionJobs[info.id]?.isActive == true) return@forEach
            val adapterPayload = adapters.firstOrNull { it.id == info.id }
            if (adapterPayload?.downloaded != true) return@forEach
            val isDownloading = adapterPayload.downloadStatus.isNotEmpty() && !adapterPayload.downloadStatus.startsWith("Error")
            if (isDownloading) return@forEach
            if (!agentVersionStates[info.id].isNullOrBlank()) return@forEach

            launchRuntimeCheck(agentVersionJobs, info.id) {
                runRuntimeCheckWithRetries { attempt ->
                    try {
                        val cmd = AcpAgentVersionCommand.buildAgentVersionCommand(info)
                        if (cmd.isNullOrEmpty()) {
                            LOG.warn(
                                "Agent version command is unavailable for '${info.id}' " +
                                    "(attempt $attempt/$RUNTIME_CHECK_MAX_ATTEMPTS)"
                            )
                        } else {
                            val workDir = AcpAdapterPaths.getDownloadPath(info.id, target)
                                .takeIf { it.isNotBlank() }
                                ?.let(::File)
                            val builder = ProcessBuilder(cmd)
                                .also { process -> if (workDir != null) process.directory(workDir) }
                                .redirectErrorStream(true)
                            AcpNodeRuntimeResolver.resolveAvailable()
                                ?.let { AcpNodeRuntimeResolver.applyTo(builder, it) }
                            val process = builder.start()
                            val output = process.inputStream.bufferedReader().use { it.readText() }.trim()
                            if (!process.waitFor(10L, TimeUnit.SECONDS)) {
                                process.destroyForcibly()
                                LOG.warn(
                                    "Agent version command timed out for '${info.id}' " +
                                        "(attempt $attempt/$RUNTIME_CHECK_MAX_ATTEMPTS)"
                                )
                            } else {
                                val version = parseAgentVersion(info.agentVersionConfig, output)
                                if (!version.isNullOrBlank()) {
                                    agentVersionStates[info.id] = version
                                    return@runRuntimeCheckWithRetries true
                                }
                                LOG.warn(
                                    "Unable to parse agent version for '${info.id}' " +
                                        "(attempt $attempt/$RUNTIME_CHECK_MAX_ATTEMPTS)"
                                )
                            }
                        }
                    } catch (error: Exception) {
                        LOG.warn(
                            "Agent version check failed for '${info.id}' " +
                                "(attempt $attempt/$RUNTIME_CHECK_MAX_ATTEMPTS)",
                            error
                        )
                    }
                    false
                }
                pushAdapters()
            }
        }
    } catch (_: Exception) {
    } finally {
        if (includeRuntimeChecks) finishFullAdapterRefreshIfIdle()
    }
}

internal fun AcpBridge.pushAdapterRefreshState(refreshing: Boolean) {
    runOnEdt {
        browser.cefBrowser.executeJavaScript(
            "if(window.__onAdapterRefreshState) window.__onAdapterRefreshState($refreshing);",
            browser.cefBrowser.url, 0
        )
    }
}

internal fun AcpBridge.finishFullAdapterRefreshIfIdle() {
    if (!fullAdapterRefreshInProgress.get()) return
    if (fullAdapterRefreshDispatching.get()) return
    val hasActiveChecks =
        downloadProbeJobs.values.any { !it.isCompleted } ||
            loginStatusJobs.values.any { !it.isCompleted } ||
            updateCheckJobs.values.any { !it.isCompleted } ||
            agentVersionJobs.values.any { !it.isCompleted }
    if (!hasActiveChecks) {
        if (fullAdapterRefreshInProgress.compareAndSet(true, false)) {
            loginStatusStates.putAll(pendingLoginStatusStates)
            pendingLoginStatusStates.clear()
            completedLoginStatusRefreshes.clear()
            pushAdapters()
            pushAdapterRefreshState(false)
        }
    }
}

internal fun AcpBridge.resetAdapterRefreshState() {
    downloadStatuses.forEach { (adapterId, status) ->
        if (status.startsWith("Error:")) {
            downloadStatuses.remove(adapterId, status)
        }
    }
    downloadProbeJobs.values.forEach { it.cancel() }
    downloadProbeJobs.clear()
    downloadProbeStates.clear()
    loginStatusJobs.values.forEach { it.cancel() }
    loginStatusJobs.clear()
    pendingLoginStatusStates.clear()
    completedLoginStatusRefreshes.clear()
    updateCheckJobs.values.forEach { it.cancel() }
    updateCheckJobs.clear()
    latestVersionStates.clear()
    agentVersionJobs.values.forEach { it.cancel() }
    agentVersionJobs.clear()
    agentVersionStates.clear()
}

internal fun AcpBridge.resetDownloadProbeState(adapterId: String? = null) {
    val targets = AcpExecutionTarget.entries
    if (adapterId == null) {
        downloadProbeJobs.values.forEach { it.cancel() }
        downloadProbeJobs.clear()
        downloadProbeStates.clear()
        loginStatusJobs.values.forEach { it.cancel() }
        loginStatusJobs.clear()
        loginStatusStates.clear()
        pendingLoginStatusStates.clear()
        completedLoginStatusRefreshes.clear()
        agentVersionJobs.values.forEach { it.cancel() }
        agentVersionJobs.clear()
        agentVersionStates.clear()
        return
    }
    targets.forEach { target ->
        val key = downloadProbeKey(target, adapterId)
        downloadProbeJobs.remove(key)?.cancel()
        downloadProbeStates.remove(key)
    }
    loginStatusJobs.remove(adapterId)?.cancel()
    loginStatusStates.remove(adapterId)
    pendingLoginStatusStates.remove(adapterId)
    completedLoginStatusRefreshes.remove(adapterId)
    agentVersionJobs.remove(adapterId)?.cancel()
    agentVersionStates.remove(adapterId)
}

internal fun AcpBridge.resetUpdateCheckState(
    adapterId: String,
    target: AcpExecutionTarget = AcpAdapterPaths.getExecutionTarget()
) {
    val key = "${target.name}:$adapterId"
    updateCheckJobs.remove(key)?.cancel()
    latestVersionStates.remove(adapterId)
}
