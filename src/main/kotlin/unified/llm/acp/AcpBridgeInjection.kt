package unified.llm.acp

import org.cef.browser.CefBrowser
import unified.llm.utils.escapeForJsString


/**
 * Injects the real JS bridge: window.__startAgent, __sendPrompt, __undoFile, etc.
 * Called from the ready handler after React has called __notifyReady() and set window.__on* callbacks.
 * (injectReadySignal runs first on page load and only sets no-op stubs for __on* and __downloadAgent etc.)
 */
internal fun AcpBridge.injectDebugApi(cefBrowser: CefBrowser) {
    val startAgentInject = startAgentQuery?.inject("JSON.stringify({ chatId: chatId, adapterId: (adapterId || ''), modelId: (modelId || '') })") ?: ""
    val setModelInject = setModelQuery?.inject("JSON.stringify({ chatId: chatId, adapterId: (adapterId || ''), modelId: modelId })") ?: ""
    val setModeInject = setModeQuery?.inject("JSON.stringify({ chatId: chatId, adapterId: (adapterId || ''), modeId: modeId })") ?: ""
    val listAdaptersInject = listAdaptersQuery?.inject("") ?: ""
    val sendPromptInject = sendPromptQuery?.inject("JSON.stringify({ chatId: chatId, text: message })") ?: ""
    val cancelPromptInject = cancelPromptQuery?.inject("chatId") ?: ""
    val stopAgentInject = stopAgentQuery?.inject("chatId") ?: ""
    val respondPermissionInject = respondPermissionQuery?.inject("JSON.stringify({ requestId: requestId, decision: decision })") ?: ""
    val loadConversationInject = loadConversationQuery?.inject("JSON.stringify({ chatId: chatId, projectPath: (projectPath || ''), conversationId: (conversationId || '') })") ?: ""
    val downloadAgentInject = downloadAgentQuery?.inject("adapterId") ?: ""
    val deleteAgentInject = deleteAgentQuery?.inject("adapterId") ?: ""
    val updateAgentInject = updateAgentQuery?.inject("adapterId") ?: ""
    val loginAgentInject = loginAgentQuery?.inject("adapterId") ?: ""
    val logoutAgentInject = logoutAgentQuery?.inject("adapterId") ?: ""
    val fetchUsageInject = fetchUsageQuery?.inject("adapterId") ?: ""
    val openAgentCliInject = openAgentCliQuery?.inject("adapterId") ?: ""
    val openHistoryConversationCliInject = openHistoryConversationCliQuery?.inject("JSON.stringify(payload)") ?: ""
    val searchFilesInject = searchFilesQuery?.inject("query") ?: ""
    val undoFileInject = undoFileQuery?.inject("payload") ?: ""
    val undoAllFilesInject = undoAllFilesQuery?.inject("payload") ?: ""
    val processFileInject = processFileQuery?.inject("payload") ?: ""
    val keepAllInject = keepAllQuery?.inject("payload") ?: ""
    val removeProcessedFilesInject = removeProcessedFilesQuery?.inject("payload") ?: ""
    val getChangesStateInject = getChangesStateQuery?.inject("payload") ?: ""
    val computeFileChangeStatsInject = computeFileChangeStatsQuery?.inject("payload") ?: ""
    val showDiffInject = showDiffQuery?.inject("payload") ?: ""
    val openFileInject = openFileQuery?.inject("payload") ?: ""
    val openUrlInject = openUrlQuery?.inject("url") ?: ""
    val attachFileInject = attachFileQuery?.inject("chatId") ?: ""
    val updateSessionMetadataInject = updateSessionMetadataQuery?.inject("JSON.stringify(payload)") ?: ""
    val continueConversationInject = continueConversationQuery?.inject("JSON.stringify(payload)") ?: ""
    val saveConversationTranscriptInject = saveConversationTranscriptQuery?.inject("payload") ?: ""

    val script = """
        (function() {
            window.__requestAdapters = function() {
                try { $listAdaptersInject } catch (e) { }
            };
            window.__startAgent = function(chatId, adapterId, modelId) {
                try {
                    if (window.__onStatus) window.__onStatus(chatId, 'initializing');
                    $startAgentInject
                } catch (e) { }
            };
            window.__setModel = function(chatId, adapterId, modelId) {
                try { $setModelInject } catch (e) { }
            };
            window.__setMode = function(chatId, adapterId, modeId) {
                try { $setModeInject } catch (e) { }
            };
            window.__sendPrompt = function(chatId, message) {
                try {
                    if (window.__onStatus) window.__onStatus(chatId, 'prompting');
                    $sendPromptInject
                } catch (e) { }
            };
            window.__cancelPrompt = function(chatId) {
                try { $cancelPromptInject } catch (e) { }
            };
            window.__stopAgent = function(chatId) {
                try { $stopAgentInject } catch (e) { }
            };
            window.__respondPermission = function(requestId, decision) {
                try { $respondPermissionInject } catch (e) { }
            };
            window.__loadHistoryConversation = function(chatId, projectPath, conversationId) {
                try { $loadConversationInject } catch (e) { }
            };
            window.__downloadAgent = function(adapterId) {
                try { $downloadAgentInject } catch (e) { }
            };
            window.__deleteAgent = function(adapterId) {
                try { $deleteAgentInject } catch (e) { }
            };
            window.__updateAgent = function(adapterId) {
                try { $updateAgentInject } catch (e) { }
            };
            window.__loginAgent = function(adapterId) {
                try { $loginAgentInject } catch (e) { }
            };
            window.__logoutAgent = function(adapterId) {
                try { $logoutAgentInject } catch (e) { }
            };
            window.__fetchAdapterUsage = function(adapterId) {
                try { $fetchUsageInject } catch (e) { }
            };
            window.__openAgentCli = function(adapterId) {
                try { $openAgentCliInject } catch (e) { }
            };
            window.__openHistoryConversationCli = function(payload) {
                try { $openHistoryConversationCliInject } catch (e) { }
            };
            window.__searchFiles = function(query) {
                try { $searchFilesInject } catch (e) { }
            };
            window.__undoFile = function(payload) {
                try { $undoFileInject } catch (e) { }
            };
            window.__undoAllFiles = function(payload) {
                try { $undoAllFilesInject } catch (e) { }
            };
            window.__processFile = function(payload) {
                try { $processFileInject } catch (e) { }
            };
            window.__keepAll = function(payload) {
                try { $keepAllInject } catch (e) { }
            };
            window.__removeProcessedFiles = function(payload) {
                try { $removeProcessedFilesInject } catch (e) { }
            };
            window.__getChangesState = function(payload) {
                try { $getChangesStateInject } catch (e) { }
            };
            window.__computeFileChangeStats = function(payload) {
                try { $computeFileChangeStatsInject } catch (e) { }
            };
            window.__showDiff = function(payload) {
                try { $showDiffInject } catch (e) { }
            };
            window.__openFile = function(payload) {
                try { $openFileInject } catch (e) { }
            };
            window.__openUrl = function(url) {
                try { $openUrlInject } catch (e) { }
            };
            window.__attachFile = function(chatId) {
                try { $attachFileInject } catch (e) { }
            };
            window.__updateSessionMetadata = function(payload) {
                try { $updateSessionMetadataInject } catch (e) { }
            };
            window.__continueConversationWithSession = function(payload) {
                try { $continueConversationInject } catch (e) { }
            };
            window.__saveConversationTranscript = function(payload) {
                try { $saveConversationTranscriptInject } catch (e) { }
            };

            // Try prime
            try { window.__requestAdapters(); } catch (e) {}
        })();
    """.trimIndent()
    cefBrowser.executeJavaScript(script, cefBrowser.url, 0)
}

/**
 * Injected on first page load (onLoadEnd). Registers no-op stubs for all __on* and action callbacks
 * so the page does not break before React mounts. When React is ready it calls __notifyReady(),
 * which triggers injectDebugApi() to replace these with the real implementations.
 */
internal fun AcpBridge.injectReadySignal(cefBrowser: CefBrowser) {
    val readyInject = readyQuery?.inject("") ?: ""
    val script = """
        // No-op stubs until injectDebugApi runs after __notifyReady()
        window.__onAcpLog = window.__onAcpLog || function(payload) {};
        window.__onContentChunk = window.__onContentChunk || function(payload) {};
        window.__onStatus = window.__onStatus || function(chatId, status) {};
        window.__onSessionId = window.__onSessionId || function(chatId, id) {};
        window.__onAdapters = window.__onAdapters || function(adapters) {};
        window.__onAvailableCommands = window.__onAvailableCommands || function(adapterId, commands) {};
        window.__onMode = window.__onMode || function(chatId, modeId) {};
        window.__onPermissionRequest = window.__onPermissionRequest || function(request) {};
        window.__respondPermission = window.__respondPermission || function(requestId, decision) {};
        window.__stopAgent = window.__stopAgent || function(chatId) {};
        window.__onToolCall = window.__onToolCall || function(chatId, payload) {};
        window.__onToolCallUpdate = window.__onToolCallUpdate || function(chatId, payload) {};
        window.__onPlan = window.__onPlan || function(chatId, payload) {};
        window.__onUndoResult = window.__onUndoResult || function(chatId, result) {};
        window.__onChangesState = window.__onChangesState || function(chatId, state) {};
        window.__onFileChangeStats = window.__onFileChangeStats || function(payload) {};
        window.__onConversationTranscriptSaved = window.__onConversationTranscriptSaved || function(payload) {};
        window.__onConversationReplayLoaded = window.__onConversationReplayLoaded || function(payload) {};

        window.__notifyReady = function() {
            try { $readyInject } catch (e) { }
        };
        window.__downloadAgent = window.__downloadAgent || function(id) {};
        window.__deleteAgent = window.__deleteAgent || function(id) {};
        window.__updateAgent = window.__updateAgent || function(id) {};
        window.__loginAgent = window.__loginAgent || function(id) {};
        window.__logoutAgent = window.__logoutAgent || function(id) {};
        window.__fetchAdapterUsage = window.__fetchAdapterUsage || function(id) {};
        window.__openAgentCli = window.__openAgentCli || function(id) {};
        window.__openHistoryConversationCli = window.__openHistoryConversationCli || function(payload) {};
        window.__searchFiles = window.__searchFiles || function(query) {};
        window.__onFilesResult = window.__onFilesResult || function(files) {};
        window.__attachFile = window.__attachFile || function(chatId) {};
        window.__updateSessionMetadata = window.__updateSessionMetadata || function(payload) {};
        window.__continueConversationWithSession = window.__continueConversationWithSession || function(payload) {};
        window.__saveConversationTranscript = window.__saveConversationTranscript || function(payload) {};
        window.__loadHistoryConversation = window.__loadHistoryConversation || function(chatId, projectPath, conversationId) {};
        window.__computeFileChangeStats = window.__computeFileChangeStats || function(payload) {};
    """.trimIndent()
    cefBrowser.executeJavaScript(script, cefBrowser.url, 0)
}

internal fun AcpBridge.pushLogEntry(entry: AcpLogEntry) {
    val payload = """{"direction":"${entry.direction}","category":"${entry.category}","json":${escapeJsonString(entry.json)},"timestamp":${entry.timestampMillis}}"""
    val escaped = payload.escapeForJsString()
    runOnEdt {
        browser.cefBrowser.executeJavaScript(
            "if(window.__onAcpLog) window.__onAcpLog(JSON.parse('$escaped'));",
            browser.cefBrowser.url, 0
        )
    }
}
