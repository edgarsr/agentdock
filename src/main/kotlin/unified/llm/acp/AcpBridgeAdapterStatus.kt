package unified.llm.acp

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import unified.llm.utils.escapeForJsString

private fun downloadProbeKey(target: AcpExecutionTarget, adapterId: String) = "${target.name}:$adapterId"

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

private fun AcpBridge.buildAdapterPayload(
    info: AcpAdapterConfig.AdapterInfo,
    target: AcpExecutionTarget,
    includeRuntimeChecks: Boolean,
    runtimeChecksReady: Boolean,
    isWslMode: Boolean,
    wslProbeState: WslRuntimeProbeState?,
    idsToFetch: MutableList<String>
): AdapterPayload {
    val probeState = if (includeRuntimeChecks) {
        downloadProbeStates[downloadProbeKey(target, info.id)]
    } else {
        null
    }
    val downloadedKnown = probeState?.downloadedKnown == true
    val downloaded = probeState?.downloaded
    val initStatus = service.adapterInitializationStatus(info.id)
    val isInitializing = initStatus == AcpClientService.AdapterInitializationStatus.Initializing

    val dlStatus = downloadStatuses[info.id] ?: ""
    val isDownloading = dlStatus.isNotEmpty() && !dlStatus.startsWith("Error")
    val hasAuthentication = info.authConfig != null
    val installedVersion = probeState?.installedVersion
    val updateSupported = downloaded == true && AcpAdapterUpdates.isUpdateCheckSupported(info)
    val updateKey = "${target.name}:${info.id}"
    val updateChecking = updateCheckJobs[updateKey]?.isActive == true
    val latestVersion = if (!runtimeChecksReady || !updateSupported) {
        null
    } else {
        latestVersionStates[info.id]
    }
    val updateKnown = updateSupported && !latestVersion.isNullOrBlank() && !installedVersion.isNullOrBlank()
    val updateAvailable = updateKnown && latestVersion != installedVersion
    val authUiMode = if (isWslMode && hasAuthentication) "manage_terminal" else (info.authConfig?.uiMode ?: "login_logout")
    val isAuthenticating = AcpAuthService.isAuthenticating(info.id)
    val cliAvailable = downloaded == true && info.cli != null && cli.isIdeTerminalAvailable()
    val rawInitError = service.adapterInitializationError(info.id) ?: ""
    val authRequiredByInit = rawInitError.startsWith("[AUTH_REQUIRED]")
    val initError = if (authRequiredByInit) "" else rawInitError

    val shouldFetchAuth = downloadedKnown &&
        !isWslMode && downloaded == true && hasAuthentication && authUiMode == "login_logout" &&
        !isDownloading && !isAuthenticating

    val needsAuthFetch = shouldFetchAuth && !authStates.containsKey(info.id)
    if (needsAuthFetch) {
        idsToFetch.add(info.id)
    }

    val authAuthenticated = when {
        !downloadedKnown -> null
        !hasAuthentication -> null
        authRequiredByInit -> false
        authUiMode != "login_logout" -> null
        !shouldFetchAuth || needsAuthFetch -> null
        else -> authStates[info.id] == true
    }
    val authKnown = when {
        !downloadedKnown -> false
        !hasAuthentication -> true
        authRequiredByInit -> true
        authUiMode != "login_logout" -> true
        else -> authAuthenticated != null
    }
    val authLoading = needsAuthFetch || authFetchJobs[info.id]?.isActive == true

    val isReady = when {
        !downloadedKnown -> null
        authRequiredByInit -> false
        initStatus == AcpClientService.AdapterInitializationStatus.NotStarted -> false
        initStatus == AcpClientService.AdapterInitializationStatus.Failed -> false
        initStatus != AcpClientService.AdapterInitializationStatus.Ready -> null
        !service.isAdapterReady(info.id) -> false
        !hasAuthentication -> true
        authUiMode != "login_logout" -> true
        authAuthenticated == null -> null
        else -> authAuthenticated
    }
    val readyKnown = isReady != null

    val iconBase64 = info.iconPath?.let { path ->
        try {
            val stream = AcpAdapterConfig::class.java.getResourceAsStream(path)
            if (stream != null) {
                val bytes = stream.use { it.readBytes() }
                val b64 = java.util.Base64.getEncoder().encodeToString(bytes)
                "data:image/svg+xml;base64,$b64"
            } else ""
        } catch (_: Exception) {
            ""
        }
    } ?: ""

    val savedPreference = AcpAgentPreferencesStore.preferenceFor(info.id)
    val rawRuntimeMetadata = service.adapterRuntimeMetadata(info.id)
        ?: AcpClientService.AdapterRuntimeMetadata(
            currentModelId = null,
            availableModels = emptyList(),
            currentModeId = null,
            availableModes = emptyList()
        )
    val resolvedCurrentModelId = savedPreference?.modelId
        ?.takeIf { preferred ->
            rawRuntimeMetadata.availableModels.isEmpty() || rawRuntimeMetadata.availableModels.any { it.modelId == preferred }
        }
        ?: rawRuntimeMetadata.currentModelId
    val resolvedCurrentModeId = savedPreference?.modeId
        ?.takeIf { preferred ->
            rawRuntimeMetadata.availableModes.isEmpty() || rawRuntimeMetadata.availableModes.any { it.id == preferred }
        }
        ?: rawRuntimeMetadata.currentModeId
    val runtimeMetadata = rawRuntimeMetadata.copy(
        currentModelId = resolvedCurrentModelId,
        currentModeId = resolvedCurrentModeId
    )

    return AdapterPayload(
        id = info.id,
        name = info.name,
        iconPath = iconBase64,
        isLastUsed = info.id == AcpAgentPreferencesStore.lastAgentId(),
        currentModelId = runtimeMetadata.currentModelId ?: "",
        availableModels = runtimeMetadata.availableModels.map {
            AdapterModelPayload(it.modelId, it.name, it.description.orEmpty())
        },
        currentModeId = runtimeMetadata.currentModeId ?: "",
        availableModes = runtimeMetadata.availableModes.map {
            AdapterModePayload(it.id, it.name, it.description.orEmpty())
        },
        downloaded = downloaded,
        downloadedKnown = downloadedKnown,
        downloadPath = if (downloaded == true) {
            AcpAdapterPaths.getDownloadPath(info.id, target, wslProbeState?.homeDir)
        } else "",
        hasAuthentication = hasAuthentication,
        authAuthenticated = authAuthenticated,
        authKnown = authKnown,
        authLoading = authLoading,
        authError = "",
        authenticating = isAuthenticating,
        authUiMode = authUiMode,
        initializing = isInitializing,
        initializationError = initError,
        ready = isReady,
        readyKnown = readyKnown,
        installedVersion = installedVersion,
        latestVersion = latestVersion,
        updateSupported = updateSupported,
        updateChecking = updateChecking,
        updateKnown = updateKnown,
        updateAvailable = updateAvailable,
        downloading = isDownloading,
        downloadStatus = dlStatus,
        disabledModels = info.disabledModels,
        cliAvailable = cliAvailable,
        executionTarget = if (isWslMode) "wsl" else "windows"
    )
}

private fun AcpBridge.ensureWslRuntimeProbeStarted() {
    if (wslRuntimeProbeState.attempted || wslRuntimeProbeJob?.isActive == true) return

    wslRuntimeProbeState = WslRuntimeProbeState(attempted = true)
    wslRuntimeProbeJob = scope.launch(Dispatchers.IO) {
        val homeDir = AcpExecutionMode.wslHomeDir()
        val distroName = AcpExecutionMode.selectedWslDistributionName()
        val nextState = if (homeDir != null && distroName.isNotBlank()) {
            WslRuntimeProbeState(
                attempted = true,
                ready = true,
                homeDir = homeDir,
                distroName = distroName
            )
        } else {
            WslRuntimeProbeState(attempted = true, ready = false)
        }

        wslRuntimeProbeState = nextState
        wslRuntimeProbeJob = null
        pushAdapters(includeRuntimeChecks = true)
    }
}

private fun AcpBridge.ensureDownloadProbeStarted(
    info: AcpAdapterConfig.AdapterInfo,
    target: AcpExecutionTarget,
    wslProbeState: WslRuntimeProbeState?
) {
    val key = downloadProbeKey(target, info.id)
    if (downloadProbeStates[key]?.downloadedKnown == true) return
    if (downloadProbeJobs[key]?.isActive == true) return

    downloadProbeJobs[key] = scope.launch(Dispatchers.IO) {
        try {
            val downloaded = AcpAdapterPaths.isDownloaded(
                adapterName = info.id,
                target = target,
                wslHomeDirOverride = wslProbeState?.homeDir,
                distroNameOverride = wslProbeState?.distroName
            )
            val installedVersion = if (downloaded) {
                AcpAdapterPaths.installedVersion(
                    adapterName = info.id,
                    target = target,
                    wslHomeDirOverride = wslProbeState?.homeDir,
                    distroNameOverride = wslProbeState?.distroName
                )
            } else {
                null
            }
            downloadProbeStates[key] = AdapterDownloadProbeState(
                downloaded = downloaded,
                downloadedKnown = true,
                installedVersion = installedVersion
            )
        } catch (_: Exception) {
            downloadProbeStates.remove(key)
        } finally {
            downloadProbeJobs.remove(key)
            pushAdapters()
        }
    }
}

internal fun AcpBridge.pushAdapters(includeRuntimeChecks: Boolean = true) {
    try {
        val unique = linkedMapOf<String, AcpAdapterConfig.AdapterInfo>()
        AcpAdapterConfig.getAllAdapters().values.forEach { info -> unique[info.id] = info }
        val target = AcpAdapterPaths.getExecutionTarget()
        val isWslMode = target == AcpExecutionTarget.WSL

        if (includeRuntimeChecks && isWslMode) {
            ensureWslRuntimeProbeStarted()
        }

        val wslProbeState = if (isWslMode) wslRuntimeProbeState else null
        val runtimeChecksReady = when {
            !includeRuntimeChecks -> false
            !isWslMode -> true
            else -> wslProbeState?.ready == true
        }

        if (includeRuntimeChecks && runtimeChecksReady) {
            unique.values.forEach { info ->
                ensureDownloadProbeStarted(info, target, wslProbeState)
            }
        }

        val idsToFetch = mutableListOf<String>()

        val adapters = unique.values.sortedBy { it.name.lowercase() }.map { info ->
            buildAdapterPayload(
                info = info,
                target = target,
                includeRuntimeChecks = includeRuntimeChecks,
                runtimeChecksReady = runtimeChecksReady,
                isWslMode = isWslMode,
                wslProbeState = wslProbeState,
                idsToFetch = idsToFetch
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

        for (id in idsToFetch) {
            if (authFetchJobs[id]?.isActive == true) continue
            authFetchJobs[id] = scope.launch(Dispatchers.IO) {
                val authenticated = try { AcpAuthService.getAuthStatus(id).authenticated } catch (_: Exception) { true }
                authStates[id] = authenticated
                authFetchJobs.remove(id)
                pushAdapters()
            }
        }

        unique.values.forEach { info ->
            if (!includeRuntimeChecks) return@forEach
            val key = "${target.name}:${info.id}"
            if (updateCheckJobs[key]?.isActive == true) return@forEach
            val downloaded = adapters.firstOrNull { it.id == info.id }?.downloaded == true
            if (!downloaded || !AcpAdapterUpdates.isUpdateCheckSupported(info)) return@forEach
            if (!latestVersionStates[info.id].isNullOrBlank()) return@forEach
            updateCheckJobs[key] = scope.launch(Dispatchers.IO) {
                try {
                    AcpAdapterUpdates.latestAvailableVersion(info)?.let { latest ->
                        latestVersionStates[info.id] = latest
                    }
                } finally {
                    updateCheckJobs.remove(key)
                }
                pushAdapters()
            }
        }
    } catch (_: Exception) {
    }
}

internal fun AcpBridge.resetAuthStatusRefreshState() {
    authFetchJobs.values.forEach { it.cancel() }
    authFetchJobs.clear()
    authStates.clear()
    downloadProbeJobs.values.forEach { it.cancel() }
    downloadProbeJobs.clear()
    downloadProbeStates.clear()
    wslRuntimeProbeJob?.cancel()
    wslRuntimeProbeJob = null
    wslRuntimeProbeState = WslRuntimeProbeState()
    updateCheckJobs.values.forEach { it.cancel() }
    updateCheckJobs.clear()
    latestVersionStates.clear()
    authActionJobs.values.forEach { it.cancel() }
    authActionJobs.clear()
    downloadStatuses.clear()
    AcpAuthService.resetTransientState()
}

internal fun AcpBridge.resetDownloadProbeState(adapterId: String? = null) {
    val targets = AcpExecutionTarget.entries
    if (adapterId == null) {
        downloadProbeJobs.values.forEach { it.cancel() }
        downloadProbeJobs.clear()
        downloadProbeStates.clear()
        return
    }
    targets.forEach { target ->
        val key = downloadProbeKey(target, adapterId)
        downloadProbeJobs.remove(key)?.cancel()
        downloadProbeStates.remove(key)
    }
}
