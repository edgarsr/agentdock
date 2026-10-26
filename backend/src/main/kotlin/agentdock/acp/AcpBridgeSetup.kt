package agentdock.acp

import agentdock.BuildConfig
import agentdock.bridge.ClientTheme
import agentdock.utils.jsCallback
import agentdock.utils.jsStringLiteral
import com.agentclientprotocol.model.ContentBlock
import com.agentclientprotocol.model.SessionUpdate
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import kotlin.time.Duration
internal fun AcpBridge.installServiceCallbacks() {
    service.callbackOwner = this
    if (BuildConfig.IS_DEV) {
        service.setOnLogEntry { pushLogEntry(it) }
    }
    service.setOnPermissionRequest { pushPermissionRequest(it) }
    service.setOnAvailableCommands { adapterId, commands ->
        pushAvailableCommands(adapterId, commands)
    }
    service.setOnAdapterInitializationStateChanged { _, _, _ ->
        scope.launch(Dispatchers.IO) { pushAdapters() }
    }
    service.setOnSessionConfigOptionsChanged { chatId, metadata, applyCurrentValues ->
        val adapterId = service.activeAdapterName(chatId) ?: return@setOnSessionConfigOptionsChanged
        if (applyCurrentValues) {
            AcpAgentPreferencesStore.rememberConfigOptions(adapterId, metadata.configOptions.associate { it.id to it.currentValue })
        }
        pushAdapters()
        pushSessionConfigOptions(chatId, metadata, applyCurrentValues)
    }
    service.setOnSessionUpdate { chatId: String, update: SessionUpdate, isReplay: Boolean, meta: JsonElement? ->
        if (isReplay && suppressReplayForChatIds.contains(chatId)) {
            replayFreshnessProbes[chatId]?.let { probe ->
                when (update) {
                    is SessionUpdate.UserMessageChunk -> probe.closeMessage()
                    is SessionUpdate.AgentMessageChunk ->
                        (update.content as? ContentBlock.Text)?.let { probe.appendAssistantText(it.text) }
                    else -> Unit
                }
            }
            return@setOnSessionUpdate
        }
        withChatDelivery(chatId) { handleSessionUpdate(chatId, update, isReplay, meta) }
    }
}

private fun AcpBridge.handleSessionUpdate(chatId: String, update: SessionUpdate, isReplay: Boolean, meta: JsonElement?) {
    // Replay is capture-only: it is collected into ConversationReplayData and delivered
    // to the UI in one piece by pushConversationReplayLoaded, never as streamed chunks.
    val sessionId = if (isReplay) {
        historyReplayCaptures[chatId]?.currentSessionId.orEmpty()
    } else {
        service.sessionId(chatId).orEmpty()
    }
    val adapterName = if (isReplay) {
        historyReplayCaptures[chatId]?.currentAdapterName.orEmpty()
    } else {
        service.activeAdapterName(chatId).orEmpty()
    }
    val hasAssistantOutput = when (update) {
        is SessionUpdate.AgentMessageChunk -> contentBlockHasVisibleOutput(update.content)
        is SessionUpdate.AgentThoughtChunk -> contentBlockHasVisibleOutput(update.content, textType = "thinking")
        else -> false
    }
    if (!isReplay && hasAssistantOutput && awaitingBackgroundOutput.remove(chatId, sessionId)) {
        val escapedChatId = chatId.jsStringLiteral()
        host.eval(jsCallback("__onAssistantActivity", escapedChatId))
        host.eval(jsCallback("__agentDockPlaySound", "'backgroundResumed'"))
    }
    when (update) {
        is SessionUpdate.UserMessageChunk -> {
            if (isReplay) {
                recordReplayUserBlock(
                    chatId,
                    sessionId,
                    adapterName,
                    sessionUpdateMessageIdFromMeta(meta),
                    update.content
                )
            }
        }
        is SessionUpdate.AgentMessageChunk -> {
            recordContentBlock(chatId, sessionId, adapterName, "assistant", update.content, isThought = false, isReplay = isReplay)
            if (!isReplay) {
                if (contentBlockHasVisibleOutput(update.content)) {
                    markLivePromptVisibleAssistantOutput(chatId)
                }
                pushContentBlock(chatId, "assistant", update.content, isThought = false)
            }
        }
        is SessionUpdate.AgentThoughtChunk -> {
            recordContentBlock(chatId, sessionId, adapterName, "assistant", update.content, isThought = true, isReplay = isReplay)
            if (!isReplay) {
                if (contentBlockHasVisibleOutput(update.content, textType = "thinking")) {
                    markLivePromptVisibleAssistantOutput(chatId)
                }
                pushContentBlock(chatId, "assistant", update.content, isThought = true)
            }
        }
        is SessionUpdate.CurrentModeUpdate -> {
            if (!isReplay) {
                pushMode(chatId, update.currentModeId.value)
            }
        }
        is SessionUpdate.ToolCall -> {
            if (!isReplay) ensureChangesStateForLiveDiffs(chatId, update.content)
            val json = try { Json.encodeToJsonElement(update).jsonObject } catch (_: Exception) { JsonObject(emptyMap()) }
            handleToolCall(chatId, sessionId, adapterName, update.toolCallId.value, json, isUpdate = false, isReplay)
        }
        is SessionUpdate.ToolCallUpdate -> {
            if (!isReplay) ensureChangesStateForLiveDiffs(chatId, update.content)
            val json = try { Json.encodeToJsonElement(update).jsonObject } catch (_: Exception) { JsonObject(emptyMap()) }
            handleToolCall(chatId, sessionId, adapterName, update.toolCallId.value, json, isUpdate = true, isReplay)
        }
        else -> {
            val usage = extractUsageUpdate(update, meta)
            if (usage != null) {
                recordUsageUpdate(chatId, sessionId, adapterName, usage.first, usage.second, isReplay)
            } else if (isPlanUpdate(update, meta)) {
                buildStoredPlanChunk(update, meta)?.let { recordStoredEvent(chatId, sessionId, adapterName, it, isReplay) }
                if (!isReplay) {
                    if (extractPlanEntries(update, meta)?.isNotEmpty() == true) {
                        markLivePromptVisibleAssistantOutput(chatId)
                    }
                    pushPlanChunk(chatId, update, meta)
                }
            }
        }
    }
}

private fun todoToolCallKey(chatId: String, sessionId: String, toolCallId: String): String =
    listOf(chatId, sessionId, toolCallId).joinToString("|")

/** Forgets the tool call keys of a chat; a reopened chat replays its tool calls from scratch. */
internal fun AcpBridge.forgetToolCallKeys(chatId: String) {
    val prefix = "$chatId|"
    listOf(todoToolCallKeys, fullOutputToolCallKeys, emittedTodoPlanKeys).forEach { keys ->
        keys.removeIf { it.startsWith(prefix) }
    }
}

/** Records and shows a tool call or its update; a todo tool call is shown as a plan instead. */
private fun AcpBridge.handleToolCall(
    chatId: String,
    sessionId: String,
    adapterName: String,
    toolCallId: String,
    raw: JsonObject,
    isUpdate: Boolean,
    isReplay: Boolean
) {
    var json = convertBrokenOtherPatchToolCallJson(raw)
    val todoToolCallKey = todoToolCallKey(chatId, sessionId, toolCallId)
    val hasFullOutputKind = hasFullOutputToolKind(json)
    if (hasFullOutputKind) fullOutputToolCallKeys.add(todoToolCallKey)
    // An update keeps the full output of a tool call whose kind an earlier event reported.
    val fullOutput = isUpdate && fullOutputToolCallKeys.contains(todoToolCallKey)
    if (hasFullOutputKind || fullOutput) json = dropOversizedToolCallPayload(json)
    val todoPlanEntries = extractTodoPlanEntriesFromToolRawJson(json)
    val isTodoWrite = todoPlanEntries != null ||
        (isUpdate && todoToolCallKeys.contains(todoToolCallKey)) ||
        isTodoWriteToolCallJson(json)
    if (isTodoWrite) {
        todoToolCallKeys.add(todoToolCallKey)
    }
    val shouldEmitTodoPlan = todoPlanEntries != null && emittedTodoPlanKeys.add(todoToolCallKey)
    if (shouldEmitTodoPlan) {
        recordStoredEvent(chatId, sessionId, adapterName, buildStoredPlanChunk(todoPlanEntries), isReplay)
    } else if (!isTodoWrite) {
        val chunk = if (isUpdate) buildStoredToolCallUpdateChunk(toolCallId, json, fullOutput) else buildStoredToolCallChunk(json)
        recordStoredEvent(chatId, sessionId, adapterName, chunk, isReplay)
    }
    if (!isReplay) {
        if (!isTodoWrite || shouldEmitTodoPlan) {
            markLivePromptVisibleAssistantOutput(chatId)
        }
        if (shouldEmitTodoPlan) {
            pushPlanChunk(chatId, todoPlanEntries)
        } else if (!isTodoWrite) {
            pushToolCallChunk(chatId, if (isUpdate) "tool_call_update" else "tool_call", toolCallId, json, fullOutput)
        }
    }
}

private data class PatchDiff(val path: String, val oldText: String?, val newText: String)

// OpenCode reports apply_patch edits as kind=other, so normalize that broken payload shape.
private fun convertBrokenOtherPatchToolCallJson(parsed: JsonObject): JsonObject {
    val kind = parsed["kind"]?.jsonPrimitive?.contentOrNull
    val rawInput = parsed["rawInput"]
    val patchText = when (kind) {
        "other" -> (rawInput as? JsonObject)?.get("patchText")?.jsonPrimitive?.contentOrNull
        "edit" -> when (rawInput) {
            is JsonPrimitive -> rawInput.contentOrNull
            is JsonObject -> rawInput["patchText"]?.jsonPrimitive?.contentOrNull
            else -> null
        }
        else -> null
    } ?: return parsed
    if (!patchText.contains("*** Begin Patch")) return parsed

    data class PatchHunk(val oldText: String, val newText: String)
    data class PatchFile(val path: String, val mode: String, val hunks: MutableList<PatchHunk>)

    val files = mutableListOf<PatchFile>()
    var path = ""
    var mode: String? = null
    var oldLines = mutableListOf<String>()
    var newLines = mutableListOf<String>()
    var hunks = mutableListOf<PatchHunk>()

    fun flushHunk() {
        if (path.isBlank()) return
        if (oldLines.isEmpty() && newLines.isEmpty()) return
        hunks += PatchHunk(oldLines.joinToString("\n"), newLines.joinToString("\n"))
        oldLines = mutableListOf()
        newLines = mutableListOf()
    }

    fun flush() {
        val currentMode = mode ?: return
        if (path.isBlank()) return
        flushHunk()
        files += PatchFile(path, currentMode, hunks)
        path = ""
        mode = null
        hunks = mutableListOf()
        oldLines = mutableListOf()
        newLines = mutableListOf()
    }

    patchText.replace("\r\n", "\n").replace("\r", "\n").lines().forEach { line ->
        Regex("^\\*\\*\\* (Update File|Add File|Delete File):\\s*(.+)$").find(line)?.let {
            flush()
            mode = when (it.groupValues[1]) {
                "Add File" -> "add"
                "Delete File" -> "delete"
                else -> "update"
            }
            path = it.groupValues[2].trim()
            return@forEach
        }
        if (path.isBlank() || line == "*** Begin Patch" || line == "*** End Patch") return@forEach
        if (line.startsWith("@@")) {
            flushHunk()
            return@forEach
        }
        when {
            line.startsWith("+") -> newLines += line.removePrefix("+")
            line.startsWith("-") -> oldLines += line.removePrefix("-")
            else -> {
                oldLines += line.removePrefix(" ")
                newLines += line.removePrefix(" ")
            }
        }
    }

    flush()
    val diffs = mutableListOf<PatchDiff>()
    for ((filePath, fileMode, fileHunks) in files) {
        when (fileMode) {
            "add" -> {
                val newText = fileHunks.joinToString("\n") { it.newText }
                if (newText.isNotEmpty()) {
                    diffs += PatchDiff(path = filePath, oldText = null, newText = newText)
                }
            }
            "delete" -> {
                val oldText = fileHunks.joinToString("\n") { it.oldText }
                if (oldText.isNotEmpty()) {
                    diffs += PatchDiff(path = filePath, oldText = oldText, newText = "")
                }
            }
            else -> {
                fileHunks.forEach { hunk ->
                    if (hunk.oldText != hunk.newText) {
                        diffs += PatchDiff(path = filePath, oldText = hunk.oldText, newText = hunk.newText)
                    }
                }
            }
        }
    }

    if (diffs.isEmpty()) return parsed

    return buildJsonObject {
        parsed.forEach { (key, value) -> put(key, value) }
        put("kind", JsonPrimitive("edit"))
        put("title", JsonPrimitive(diffs.map { it.path }.distinct().joinToString(prefix = "Edit ")))
        put("locations", buildJsonArray {
            diffs.map { it.path }.distinct().forEach { add(buildJsonObject { put("path", JsonPrimitive(it)) }) }
        })
        put("content", buildJsonArray {
            diffs.forEach {
                add(buildJsonObject {
                    put("type", JsonPrimitive("diff"))
                    put("path", JsonPrimitive(it.path))
                    put("oldText", it.oldText?.let(::JsonPrimitive) ?: JsonNull)
                    put("newText", JsonPrimitive(it.newText))
                })
            }
        })
    }
}

/** The adapter an install job installs; [versionOverride] replaces the configured version. */
private class AdapterInstallTarget(val adapterInfo: AcpAdapterConfig.AdapterInfo, val versionOverride: String? = null)

/**
 * Runs the install job of [adapterId] unless one is already running. [prepare] stops the adapter and
 * returns what to install, or null to skip. The install is made beside the adapter files, which are
 * replaced only once it succeeds, so a failed or cancelled one keeps the installed version.
 */
private fun AcpBridge.launchAdapterInstall(
    adapterId: String,
    prepare: (AcpAdapterInstallCancellation) -> AdapterInstallTarget?
) {
    if (adapterInstallJobs[adapterId]?.isActive == true) return
    val cancellation = AcpAdapterInstallCancellation()
    adapterInstallCancellations[adapterId] = cancellation
    val job = scope.launch(Dispatchers.IO) {
        try {
            val target = prepare(cancellation) ?: return@launch
            val stagingDir = AcpAdapterPaths.getInstallStagingDir(adapterId)
            val installed = AcpAdapterPaths.installAdapterRuntime(
                targetDir = stagingDir,
                adapterInfo = target.adapterInfo,
                statusCallback = { status ->
                    downloadStatuses[adapterId] = status
                    pushAdapters()
                },
                versionOverride = target.versionOverride,
                cancellation = cancellation
            )
            cancellation.throwIfCancelled()
            val success = installed && AcpAdapterPaths.replaceAdapterRuntime(adapterId, stagingDir).also { replaced ->
                if (!replaced) downloadStatuses[adapterId] = "Error: Unable to replace the old adapter files"
            }

            if (success) {
                downloadStatuses.remove(adapterId)
                val installedVersion = target.versionOverride ?: AcpAdapterPaths.installedVersion(adapterId)
                setDownloadProbeState(adapterId, downloaded = true, installedVersion = installedVersion)
                service.initializeAdapterInBackground(adapterId)
                refreshAdapterLoginStatus(adapterId)
                pushAdapters(includeRuntimeChecks = true, adapterIdsToRefresh = setOf(adapterId))
            } else {
                downloadStatuses.compute(adapterId) { _, previous ->
                    previous?.takeIf { it.startsWith("Error:") }
                }
                pushAdapters()
            }
        } catch (_: CancellationException) {
            downloadStatuses.remove(adapterId)
            resetDownloadProbeState(adapterId)
        } catch (e: Exception) {
            downloadStatuses[adapterId] = "Error: ${e.message}"
        } finally {
            runCatching { AcpAdapterPaths.getInstallStagingDir(adapterId).deleteRecursively() }
            adapterInstallJobs.remove(adapterId)
            adapterInstallCancellations.remove(adapterId)
            // Checks the files again, as a cancellation leaves the installed state unknown.
            pushAdapters(includeRuntimeChecks = true, adapterIdsToRefresh = setOf(adapterId))
        }
    }
    adapterInstallJobs[adapterId] = job
}

internal fun AcpBridge.installAdapterQueries() {
    host.register("themeChanged") { theme ->
        ClientTheme.update(theme)
        fileIconProvider?.invalidate()
        scope.launch(Dispatchers.IO) { pushAdapters() }
    }

    host.register("ready") { theme ->
        ClientTheme.update(theme)
        scope.launch(Dispatchers.IO) {
            startInitialAdapterRefresh()
            pushAllAvailableCommands()
        }
    }

    host.register("rememberConfigOption") { payload ->
        parseRememberConfigPayload(payload)?.takeIf { it.configValues.isNotEmpty() }?.let { parsed ->
            AcpAgentPreferencesStore.rememberConfigOptions(
                parsed.adapterId,
                parsed.configValues,
                parsed.modelByMode,
                parsed.effortByModel
            )
            pushAdapters()
        }
    }

    host.register("downloadAgent") { payload ->
        val adapterId = parseIdOnlyPayload(payload)
        if (adapterId != null) {
            launchAdapterInstall(adapterId) {
                downloadStatuses[adapterId] = "Starting download..."
                resetDownloadProbeState(adapterId)
                pushAdapters(includeRuntimeChecks = true, adapterIdsToRefresh = setOf(adapterId))

                service.stopSharedProcess(adapterId)
                AcpConfigOptionsCache.remove(adapterId)
                resetUpdateCheckState(adapterId)
                AdapterInstallTarget(AcpAdapterPaths.getAdapterInfo(adapterId))
            }
        }
    }

    host.register("cancelAgentInstall") { payload ->
        val adapterId = parseIdOnlyPayload(payload)
        if (adapterId != null) {
            downloadStatuses[adapterId] = "Cancelling..."
            adapterInstallCancellations.remove(adapterId)?.cancel()
            adapterInstallJobs.remove(adapterId)?.cancel(CancellationException("Adapter installation cancelled"))
            pushAdapters()
        }
    }

    host.register("deleteAgent") { payload ->
        val adapterId = parseIdOnlyPayload(payload)
        if (adapterId != null) {
            scope.launch(Dispatchers.IO) {
                service.stopSharedProcess(adapterId)
                AcpConfigOptionsCache.remove(adapterId)
                resetUpdateCheckState(adapterId)
                resetDownloadProbeState(adapterId)
                val deleted = AcpAdapterPaths.deleteAdapter(adapterId)
                if (deleted) {
                    downloadStatuses.remove(adapterId)
                    authErrors.remove(adapterId)
                    setDownloadProbeState(adapterId, downloaded = false)
                    host.eval(jsCallback("__onAdapterDeleted", adapterId.jsStringLiteral()))
                } else {
                    downloadStatuses[adapterId] = "Error: Unable to remove adapter files"
                }
                pushAdapters(includeRuntimeChecks = true, adapterIdsToRefresh = setOf(adapterId))
            }
        }
    }

    host.register("updateAgent") { payload ->
        val adapterId = parseIdOnlyPayload(payload)
        if (adapterId != null) {
            launchAdapterInstall(adapterId) { cancellation ->
                val adapterInfo = AcpAdapterPaths.getAdapterInfo(adapterId)
                val isUpdateCheckSupported = AcpAdapterUpdates.isUpdateCheckSupported(adapterInfo)
                val installedVersion = AcpAdapterPaths.installedVersion(adapterId)
                val isStaticUpdateAvailable = installedVersion != null && installedVersion != adapterInfo.getConfiguredVersion()

                if (!isUpdateCheckSupported && !isStaticUpdateAvailable) {
                    return@launchAdapterInstall null
                }

                val latestVersion = if (isUpdateCheckSupported) {
                    latestVersionStates[adapterId]
                        ?: AcpAdapterUpdates.latestAvailableVersion(adapterInfo)
                        ?: throw IllegalStateException("Unable to resolve latest version")
                } else {
                    adapterInfo.getConfiguredVersion()
                }
                cancellation.throwIfCancelled()
                latestVersionStates[adapterId] = latestVersion

                downloadStatuses[adapterId] = "Updating to $latestVersion..."
                resetDownloadProbeState(adapterId)
                pushAdapters(includeRuntimeChecks = true, adapterIdsToRefresh = setOf(adapterId))

                service.stopSharedProcess(adapterId)
                AcpConfigOptionsCache.remove(adapterId)
                AdapterInstallTarget(adapterInfo, versionOverride = latestVersion)
            }
        }
    }

    host.register("loginAgent") { payload ->
        val (adapterId, methodId) = parseAdapterAuthMethodPayload(payload)
        if (adapterId != null && methodId != null) {
            launchAuthAction(adapterId, methodId, "Login failed") {
                AcpAuthenticationService.login(
                    adapterId = adapterId,
                    methodId = methodId,
                    service = service,
                    openTerminalAuth = { title, args, environment ->
                        cli.openAgentAuthInTerminal(adapterId, title, args, environment)
                    }
                )
                if (AcpAdapterConfig.getAdapterInfo(adapterId).loginStatusMethod != null) {
                    service.loginStatusStates[adapterId] = true
                }
                service.stopSharedProcess(adapterId)
                service.initializeAdapterInBackground(adapterId)
            }
        }
    }

    host.register("logoutAgent") { payload ->
        val adapterId = parseIdOnlyPayload(payload)
        if (adapterId != null) {
            launchAuthAction(adapterId, null, "Logout failed") {
                val restartRequired = AcpAuthenticationService.logout(adapterId, service)
                AcpUsageDataFetcher.discardCachedUsage(adapterId)
                if (adapterId == "cursor-cli") {
                    AcpQuotaService.getInstance().clearQuotaForAdapter(adapterId)
                    host.eval(jsCallback("__onUsageData", adapterId.jsStringLiteral(), "''"))
                }
                if (restartRequired) {
                    service.stopSharedProcess(adapterId)
                    service.initializeAdapterInBackground(adapterId)
                }
            }
        }
    }

    host.register("cancelAgentAuth") { payload ->
        parseIdOnlyPayload(payload)?.let { adapterId ->
            authActionJobs[adapterId]?.cancel()
        }
    }

    host.register("fetchUsage") { payload ->
        val (parsedAdapterId, view) = parseFetchUsagePayload(payload)
        val adapterId = parsedAdapterId ?: payload.trim()
        scope.launch(Dispatchers.IO) {
            val push: (String) -> Unit = { json ->
                host.eval(jsCallback("__onUsageData", adapterId.jsStringLiteral(), json.jsStringLiteral()))
            }
            // A view keeps showing the older data until the newer data arrives.
            val result = AcpUsageDataFetcher.fetchUsageData(
                adapterId,
                if (view) AcpUsageDataFetcher.VIEW_MAX_AGE else Duration.ZERO,
                onStale = push.takeIf { view }
            )
            if (result.isNotBlank()) {
                AcpQuotaService.getInstance().updateQuotaForAdapter(adapterId, result)
            } else if (adapterId == "cursor-cli") {
                AcpQuotaService.getInstance().clearQuotaForAdapter(adapterId)
            }
            push(result)
        }
    }

    host.register("terminalCapability") { payload ->
        runCatching { adapterJson.decodeFromString<agentdock.rpc.TerminalCapability>(payload) }
            .getOrNull()
            ?.let { capability ->
                cli.updateTerminalCapability(capability)
                pushAdapters()
            }
    }

    host.register("openAgentCli") { payload ->
        val adapterId = parseIdOnlyPayload(payload)
        if (adapterId != null) {
            scope.launch(Dispatchers.Default) {
                cli.openAgentCliInTerminal(adapterId)
            }
        }
    }

    host.register("openHistoryConversationCli") { payload ->
        val (projectPath, conversationId) = parseHistoryConversationCliPayload(payload)
        if (projectPath != null && conversationId != null) {
            scope.launch(Dispatchers.Default) {
                cli.openHistoryConversationCliInTerminal(projectPath, conversationId)
            }
        }
    }

}

private fun AcpBridge.launchAuthAction(
    adapterId: String,
    methodId: String?,
    fallbackError: String,
    action: suspend () -> Unit
) {
    val previousJob = authActionJobs[adapterId]
    if (methodId == null) {
        authActionMethodIds.remove(adapterId)
    } else {
        authActionMethodIds[adapterId] = methodId
    }
    lateinit var job: kotlinx.coroutines.Job
    job = scope.launch(Dispatchers.Default, start = CoroutineStart.LAZY) {
        try {
            previousJob?.join()
            authErrors.remove(adapterId)
            pushAdapters()
            action()
        } catch (_: CancellationException) {
            authErrors.remove(adapterId)
        } catch (error: Exception) {
            val message = formatAcpError(error).takeIf { it.isNotBlank() } ?: fallbackError
            authErrors[adapterId] = message
        } finally {
            authActionJobs.remove(adapterId, job)
            methodId?.let { authActionMethodIds.remove(adapterId, it) }
            refreshAdapterLoginStatus(adapterId)
        }
    }
    authActionJobs[adapterId] = job
    previousJob?.cancel()
    job.start()
}

internal fun AcpBridge.pushLogEntry(entry: AcpLogEntry) {
    if (!BuildConfig.IS_DEV || !host.isAttached) return
    val payload = buildJsonObject {
        put("adapterId", entry.adapterId)
        put("direction", entry.direction.toString())
        put("category", entry.category.toString())
        put("json", entry.json)
        put("timestamp", entry.timestampMillis)
    }.toString().jsStringLiteral()
    host.eval(jsCallback("__onAcpLog", "JSON.parse($payload)"))
}
