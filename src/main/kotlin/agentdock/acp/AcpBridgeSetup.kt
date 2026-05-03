package agentdock.acp

import com.agentclientprotocol.model.SessionUpdate
import com.intellij.ui.jcef.JBCefJSQuery
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import agentdock.history.AgentDockHistoryService
import java.io.File
internal fun AcpBridge.installServiceCallbacks() {
    service.setOnLogEntry { pushLogEntry(it) }
    service.setOnPermissionRequest { pushPermissionRequest(it) }
    service.setOnAvailableCommands { adapterId, commands ->
        pushAvailableCommands(adapterId, commands)
    }
    service.setOnAdapterInitializationStateChanged { _, _, _ ->
        scope.launch(Dispatchers.IO) { pushAdapters() }
    }
    service.setOnSessionUpdate { chatId: String, update: SessionUpdate, isReplay: Boolean, _meta: JsonElement? ->
        if (isReplay && suppressReplayForChatIds.contains(chatId)) {
            return@setOnSessionUpdate
        }
        val captureOnlyReplay = isReplay && historyReplayCaptures.containsKey(chatId)
        val sessionId = if (captureOnlyReplay) {
            historyReplayCaptures[chatId]?.currentSessionId.orEmpty()
        } else {
            service.sessionId(chatId).orEmpty()
        }
        val adapterName = if (captureOnlyReplay) {
            historyReplayCaptures[chatId]?.currentAdapterName.orEmpty()
        } else {
            service.activeAdapterName(chatId).orEmpty()
        }
        when (update) {
            is SessionUpdate.UserMessageChunk -> {
                if (isReplay) {
                    recordReplayUserBlock(chatId, sessionId, adapterName, update.content)
                    if (!captureOnlyReplay) {
                        pushContentBlock(chatId, "user", update.content, isThought = false, isReplay = true)
                    }
                }
            }
            is SessionUpdate.AgentMessageChunk -> {
                recordContentBlock(chatId, sessionId, adapterName, "assistant", update.content, isThought = false, isReplay = isReplay)
                if (!captureOnlyReplay) {
                    if (!isReplay && contentBlockHasVisibleOutput(update.content)) {
                        markLivePromptVisibleAssistantOutput(chatId)
                    }
                    pushContentBlock(chatId, "assistant", update.content, isThought = false, isReplay = isReplay)
                }
            }
            is SessionUpdate.AgentThoughtChunk -> {
                recordContentBlock(chatId, sessionId, adapterName, "assistant", update.content, isThought = true, isReplay = isReplay)
                if (!captureOnlyReplay) {
                    if (!isReplay && contentBlockHasVisibleOutput(update.content, textType = "thinking")) {
                        markLivePromptVisibleAssistantOutput(chatId)
                    }
                    pushContentBlock(chatId, "assistant", update.content, isThought = true, isReplay = isReplay)
                }
            }
            is SessionUpdate.CurrentModeUpdate -> {
                if (!captureOnlyReplay) {
                    pushMode(chatId, update.currentModeId.value)
                }
            }
            is SessionUpdate.ToolCall -> {
                if (!isReplay) removeProcessedFilesForDiffs(chatId, update.content)
                var json = try { Json.encodeToString(update) } catch (_: Exception) { update.toString() }
                json = convertBrokenOtherPatchToolCallJson(json)
                val isPermissionRequest = update.toolCallId.value.endsWith("-permission")
                if (!isPermissionRequest) {
                    recordStoredEvent(
                        chatId,
                        sessionId,
                        adapterName,
                        buildStoredToolCallChunk(json),
                        isReplay
                    )
                }
                if (!isPermissionRequest && !captureOnlyReplay) {
                    if (!isReplay) {
                        markLivePromptVisibleAssistantOutput(chatId)
                    }
                    pushToolCallChunk(chatId, json, isReplay)
                }
            }
            is SessionUpdate.ToolCallUpdate -> {
                if (!isReplay) removeProcessedFilesForDiffs(chatId, update.content)
                var json = try { Json.encodeToString(update) } catch (_: Exception) { update.toString() }
                json = convertBrokenOtherPatchToolCallJson(json)
                val isPermissionRequest = update.toolCallId.value.endsWith("-permission")
                if (!isPermissionRequest) {
                    recordStoredEvent(
                        chatId,
                        sessionId,
                        adapterName,
                        buildStoredToolCallUpdateChunk(update.toolCallId.value, json),
                        isReplay
                    )
                }
                if (!isPermissionRequest && !captureOnlyReplay) {
                    if (!isReplay) {
                        markLivePromptVisibleAssistantOutput(chatId)
                    }
                    pushToolCallUpdateChunk(chatId, update.toolCallId.value, json, isReplay)
                }
            }
            else -> {
                val usage = extractUsageUpdate(update, _meta)
                if (usage != null) {
                    recordUsageUpdate(chatId, sessionId, adapterName, usage.first, usage.second, isReplay)
                } else if (isPlanUpdate(update, _meta)) {
                    buildStoredPlanChunk(update, _meta)?.let { recordStoredEvent(chatId, sessionId, adapterName, it, isReplay) }
                    if (!captureOnlyReplay) {
                        if (!isReplay && extractPlanEntries(update, _meta)?.isNotEmpty() == true) {
                            markLivePromptVisibleAssistantOutput(chatId)
                        }
                        pushPlanChunk(chatId, update, isReplay, _meta)
                    }
                }
            }
        }
    }
}

private data class PatchDiff(val path: String, val oldText: String?, val newText: String)

// OpenCode reports apply_patch edits as kind=other, so normalize that broken payload shape.
private fun AcpBridge.convertBrokenOtherPatchToolCallJson(rawJson: String): String {
    val parsed = try { Json.parseToJsonElement(rawJson).jsonObject } catch (_: Exception) { return rawJson }
    val kind = parsed["kind"]?.jsonPrimitive?.contentOrNull
    val patchText = when (kind) {
        "other" -> (parsed["rawInput"] as? JsonObject)?.get("patchText")?.jsonPrimitive?.contentOrNull
        "edit" -> (parsed["rawInput"] as? JsonPrimitive)?.contentOrNull
        else -> null
    } ?: return rawJson
    if (!patchText.contains("*** Begin Patch")) return rawJson

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
    for (file in files) {
        when (file.mode) {
            "add" -> {
                val newText = file.hunks.joinToString("\n") { it.newText }
                if (newText.isNotEmpty()) {
                    diffs += PatchDiff(path = file.path, oldText = null, newText = newText)
                }
            }
            "delete" -> {
                val oldText = file.hunks.joinToString("\n") { it.oldText }
                if (oldText.isNotEmpty()) {
                    diffs += PatchDiff(path = file.path, oldText = oldText, newText = "")
                }
            }
            else -> {
                file.hunks.forEach { hunk ->
                    if (hunk.oldText != hunk.newText) {
                        diffs += PatchDiff(path = file.path, oldText = hunk.oldText, newText = hunk.newText)
                    }
                }
            }
        }
    }

    if (diffs.isEmpty()) return rawJson

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
    }.toString()
}

internal fun AcpBridge.installAdapterQueries() {
    readyQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler {
            runOnEdt {
                injectDebugApi(browser.cefBrowser)
            }
            scope.launch(Dispatchers.IO) {
                pushAdapters()
                pushAllAvailableCommands()
            }
            JBCefJSQuery.Response("ok")
        }
    }

    downloadAgentQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            val adapterId = parseIdOnlyPayload(payload)
            if (adapterId != null) {
                if (adapterInstallJobs[adapterId]?.isActive == true) {
                    return@addHandler JBCefJSQuery.Response("ok")
                }
                val cancellation = AcpAdapterInstallCancellation()
                adapterInstallCancellations[adapterId] = cancellation
                val job = scope.launch(Dispatchers.IO) {
                    val target = AcpAdapterPaths.getExecutionTarget()
                    var replacingRuntime = false
                    try {
                        downloadStatuses[adapterId] = "Starting download..."
                        resetDownloadProbeState(adapterId)
                        pushAdapters()

                        service.stopSharedProcess(adapterId)
                        latestVersionStates.remove(adapterId)
                        val adapterInfo = AcpAdapterPaths.getAdapterInfo(adapterId)
                        val targetDir = File(AcpAdapterPaths.getDependenciesDir(), adapterInfo.id)

                        val statusCallback = { status: String ->
                            downloadStatuses[adapterId] = status
                            pushAdapters()
                        }

                        replacingRuntime = true
                        val success = AcpAdapterPaths.installAdapterRuntime(
                            targetDir = targetDir,
                            adapterInfo = adapterInfo,
                            statusCallback = statusCallback,
                            target = target,
                            cancellation = cancellation
                        )

                        if (success) {
                            downloadStatuses.remove(adapterId)
                            val installedVersion = AcpAdapterPaths.installedVersion(adapterId, target)
                            setDownloadProbeState(adapterId, target, downloaded = true, installedVersion = installedVersion)
                            service.initializeAdapterInBackground(adapterId)
                            pushAdapters()
                        } else {
                            downloadStatuses.compute(adapterId) { _, previous ->
                                previous?.takeIf { it.startsWith("Error:") } ?: "Error: Download failed"
                            }
                            pushAdapters()
                        }
                    } catch (_: CancellationException) {
                        downloadStatuses.remove(adapterId)
                        if (replacingRuntime) {
                            runCatching { AcpAdapterPaths.deleteAdapter(adapterId, target) }
                        }
                        resetDownloadProbeState(adapterId)
                    } catch (e: Exception) {
                        downloadStatuses[adapterId] = "Error: ${e.message}"
                    } finally {
                        adapterInstallJobs.remove(adapterId)
                        adapterInstallCancellations.remove(adapterId)
                        pushAdapters()
                    }
                }
                adapterInstallJobs[adapterId] = job
            }
            JBCefJSQuery.Response("ok")
        }
    }

    cancelAgentInstallQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            val adapterId = parseIdOnlyPayload(payload)
            if (adapterId != null) {
                downloadStatuses[adapterId] = "Cancelling..."
                adapterInstallCancellations.remove(adapterId)?.cancel()
                adapterInstallJobs.remove(adapterId)?.cancel(CancellationException("Adapter installation cancelled"))
                pushAdapters()
            }
            JBCefJSQuery.Response("ok")
        }
    }

    deleteAgentQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            val adapterId = parseIdOnlyPayload(payload)
            if (adapterId != null) {
                scope.launch(Dispatchers.IO) {
                    service.stopSharedProcess(adapterId)
                    latestVersionStates.remove(adapterId)
                    resetDownloadProbeState(adapterId)
                    val deleted = AcpAdapterPaths.deleteAdapter(adapterId, AcpAdapterPaths.getExecutionTarget())
                    if (deleted) {
                        downloadStatuses.remove(adapterId)
                        setDownloadProbeState(adapterId, AcpAdapterPaths.getExecutionTarget(), downloaded = false)
                        runOnEdt {
                            browser.cefBrowser.executeJavaScript(
                                "if(window.__onAdapterDeleted) window.__onAdapterDeleted(${jsStringLiteral(adapterId)});",
                                browser.cefBrowser.url, 0
                            )
                        }
                    } else {
                        downloadStatuses[adapterId] = "Error: Unable to remove adapter files"
                    }
                    pushAdapters()
                }
            }
            JBCefJSQuery.Response("ok")
        }
    }

    updateAgentQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            val adapterId = parseIdOnlyPayload(payload)
            if (adapterId != null) {
                if (adapterInstallJobs[adapterId]?.isActive == true) {
                    return@addHandler JBCefJSQuery.Response("ok")
                }
                val cancellation = AcpAdapterInstallCancellation()
                adapterInstallCancellations[adapterId] = cancellation
                val job = scope.launch(Dispatchers.IO) {
                    var replacingRuntime = false
                    try {
                        val adapterInfo = AcpAdapterPaths.getAdapterInfo(adapterId)
                        if (!AcpAdapterUpdates.isUpdateCheckSupported(adapterInfo)) {
                            return@launch
                        }

                        val latestVersion = latestVersionStates[adapterId]
                            ?: AcpAdapterUpdates.latestAvailableVersion(adapterInfo)
                            ?: throw IllegalStateException("Unable to resolve latest version")
                        cancellation.throwIfCancelled()
                        latestVersionStates[adapterId] = latestVersion

                        downloadStatuses[adapterId] = "Updating to $latestVersion..."
                        resetDownloadProbeState(adapterId)
                        pushAdapters()

                        service.stopSharedProcess(adapterId)
                        val target = AcpAdapterPaths.getExecutionTarget()
                        val targetDir = File(AcpAdapterPaths.getDependenciesDir(), adapterInfo.id)
                        val deleted = AcpAdapterPaths.deleteAdapter(adapterId, target)
                        if (!deleted) {
                            throw IllegalStateException("Unable to remove old adapter files")
                        }
                        replacingRuntime = true

                        val statusCallback = { status: String ->
                            downloadStatuses[adapterId] = status
                            pushAdapters()
                        }

                        val success = AcpAdapterPaths.installAdapterRuntime(
                            targetDir = targetDir,
                            adapterInfo = adapterInfo,
                            statusCallback = statusCallback,
                            target = target,
                            versionOverride = latestVersion,
                            cancellation = cancellation
                        )

                        if (success) {
                            downloadStatuses.remove(adapterId)
                            setDownloadProbeState(adapterId, target, downloaded = true, installedVersion = latestVersion)
                            service.initializeAdapterInBackground(adapterId)
                        } else {
                            downloadStatuses.compute(adapterId) { _, previous ->
                                previous?.takeIf { it.startsWith("Error:") } ?: "Error: Update failed"
                            }
                        }
                    } catch (_: CancellationException) {
                        downloadStatuses.remove(adapterId)
                        if (replacingRuntime) {
                            runCatching { AcpAdapterPaths.deleteAdapter(adapterId, AcpAdapterPaths.getExecutionTarget()) }
                        }
                        resetDownloadProbeState(adapterId)
                    } catch (e: Exception) {
                        downloadStatuses[adapterId] = "Error: ${e.message}"
                    } finally {
                        adapterInstallJobs.remove(adapterId)
                        adapterInstallCancellations.remove(adapterId)
                        pushAdapters()
                    }
                }
                adapterInstallJobs[adapterId] = job
            }
            JBCefJSQuery.Response("ok")
        }
    }

    loginAgentQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            val adapterId = parseIdOnlyPayload(payload)
            if (adapterId != null) {
                val existingJob = authActionJobs.remove(adapterId)
                existingJob?.cancel()
                val job = scope.launch(Dispatchers.Default) {
                    try {
                        downloadStatuses.remove(adapterId)
                        AcpAuthService.incrementActive(adapterId)
                        pushAdapters()
                        when {
                            AcpAuthService.getLoginMode(adapterId) == "manage_terminal" -> {
                                if (!cli.isIdeTerminalAvailable()) {
                                    throw Exception("IDE terminal is required for auth management")
                                }
                                cli.openAgentCliInTerminal(adapterId)
                            }
                            AcpAuthService.getLoginMode(adapterId) == "ide_terminal" -> {
                                if (!cli.isIdeTerminalAvailable()) {
                                    throw Exception("IDE terminal is required for login")
                                }
                                if (!cli.openLoginInTerminal(adapterId)) {
                                    throw Exception("Unable to open IDE terminal for login")
                                }
                            }
                            else -> {
                                val projectPath = service.project.basePath
                                val authenticated = AcpAuthService.login(
                                    adapterName = adapterId,
                                    projectPath = projectPath,
                                    onProgress = {
                                        pushAdapters()
                                    }
                                )
                                if (authenticated) {
                                    service.stopSharedProcess(adapterId)
                                    resetDownloadProbeState(adapterId)
                                    authStates.remove(adapterId)
                                    service.initializeAdapterInBackground(adapterId)
                                    pushAdapters()
                                }
                            }
                        }
                    } finally {
                        AcpAuthService.decrementActive(adapterId)
                        authActionJobs.remove(adapterId)
                        authStates.remove(adapterId)
                        pushAdapters()
                    }
                }
                authActionJobs[adapterId] = job
            }
            JBCefJSQuery.Response("ok")
        }
    }

    logoutAgentQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            val adapterId = parseIdOnlyPayload(payload)
            if (adapterId != null) {
                val existingJob = authActionJobs.remove(adapterId)
                existingJob?.cancel()
                val job = scope.launch(Dispatchers.Default) {
                    try {
                        AcpAuthService.incrementActive(adapterId)
                        pushAdapters()
                        AcpAuthService.logout(adapterId)
                    } finally {
                        AcpAuthService.decrementActive(adapterId)
                        authActionJobs.remove(adapterId)
                        authStates.remove(adapterId)
                        pushAdapters()
                    }
                }
                authActionJobs[adapterId] = job
            }
            JBCefJSQuery.Response("ok")
        }
    }

    fetchUsageQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            val adapterId = parseIdOnlyPayload(payload) ?: payload?.trim() ?: ""
            scope.launch(Dispatchers.IO) {
                val result = when (adapterId) {
                    "claude-code" -> AcpUsageDataFetcher.fetchClaudeUsageData()
                    "codex" -> AcpUsageDataFetcher.fetchCodexUsageData()
                    "gemini-cli" -> AcpUsageDataFetcher.fetchGeminiUsageData(adapterId)
                    "github-copilot-cli" -> AcpUsageDataFetcher.fetchCopilotUsageData(adapterId)
                    else -> ""
                }
                if (result.isNotBlank()) {
                    AcpQuotaService.updateQuotaForAdapter(adapterId, result)
                }
                val escapedAdapterId = jsStringLiteral(adapterId)
                val escapedResult = jsStringLiteral(result)
                runOnEdt {
                    browser.cefBrowser.executeJavaScript(
                        "if(window.__onUsageData) window.__onUsageData($escapedAdapterId, $escapedResult);",
                        browser.cefBrowser.url, 0
                    )
                }
            }
            JBCefJSQuery.Response(null)
        }
    }

    openAgentCliQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            val adapterId = parseIdOnlyPayload(payload)
            if (adapterId != null) {
                scope.launch(Dispatchers.Default) {
                    cli.openAgentCliInTerminal(adapterId)
                }
            }
            JBCefJSQuery.Response("ok")
        }
    }

    openHistoryConversationCliQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            val (projectPath, conversationId) = parseHistoryConversationCliPayload(payload)
            if (projectPath != null && conversationId != null) {
                scope.launch(Dispatchers.Default) {
                    cli.openHistoryConversationCliInTerminal(projectPath, conversationId)
                }
            }
            JBCefJSQuery.Response("ok")
        }
    }

}
