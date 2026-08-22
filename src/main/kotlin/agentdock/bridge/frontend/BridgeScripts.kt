package agentdock.bridge.frontend

import agentdock.BuildConfig

/**
 * The JavaScript side of the bridge.
 *
 * Every `window.__*` action is a thin wrapper over `window.__agentDockInvoke(name, payload)`, so
 * this is one static script instead of the seven that each bridge used to build from its own
 * `JBCefJSQuery.inject(...)` fragments. Because nothing here depends on runtime state, it can be
 * injected once when the page finishes loading, which also removes the old two-phase dance where
 * stubs were installed first and replaced with the real functions after `__notifyReady()`.
 */
internal object BridgeScripts {

    fun bridgeApi(): String = """
        (function() {
            window.__IS_DEV = ${BuildConfig.IS_DEV};

            var invoke = function(name, payload) {
                try { window.__agentDockInvoke(name, payload == null ? '' : String(payload)); }
                catch (e) { console.error('[AgentDock] bridge call failed: ' + name, e); }
            };

            // Callbacks the backend pushes into. Defined as no-ops so a push that arrives before
            // React has registered its own handler is dropped instead of throwing.
            var callbacks = [
                '__onAcpLog', '__onContentChunk', '__onStatus', '__onBridgeOperationResult',
                '__onSessionId', '__onAdapters', '__onAdapterRefreshState', '__onAvailableCommands',
                '__onMode', '__onSessionConfigOptions', '__onPermissionRequest', '__onUndoResult',
                '__onChangesState', '__onFileChangeStats', '__onConversationTranscriptSaved',
                '__onConversationReplayLoaded', '__onAdapterDeleted', '__onFilesResult',
                '__onFileIconResult', '__onThemeChanged', '__onHistoryList', '__onHistoryDeleteResult',
                '__onMcpServers', '__onMcpStatus', '__onPromptLibrary', '__onSystemInstructions',
                '__onAudioTranscriptionFeature', '__onAudioTranscriptionResult',
                '__onAudioRecordingState', '__onAudioTranscriptionSettings', '__onGlobalSettings'
            ];
            callbacks.forEach(function(name) {
                window[name] = window[name] || function() {};
            });

            window.__notifyReady = function() { invoke('ready', ''); };

            window.__requestAdapters = function(forceRefresh) {
                invoke('listAdapters', forceRefresh === true ? 'refresh' : '');
            };
            window.__rememberAgentConfigOption = function(adapterId, configId, value) {
                invoke('rememberConfigOption', JSON.stringify({ adapterId: adapterId, configValues: { [configId]: value } }));
            };
            window.__startAgent = function(chatId, adapterId, configValues, requestId) {
                invoke('startAgent', JSON.stringify({ requestId: (requestId || ''), chatId: chatId, adapterId: (adapterId || ''), configValues: (configValues || {}) }));
            };
            window.__sendPrompt = function(chatId, message, requestId, forkBase, adapterId, configValues) {
                invoke('sendPrompt', JSON.stringify({ requestId: (requestId || ''), chatId: chatId, text: message, forkBase: forkBase || null, adapterId: (adapterId || ''), configValues: (configValues || {}) }));
            };
            window.__cancelPrompt = function(chatId, requestId) {
                invoke('cancelPrompt', JSON.stringify({ requestId: (requestId || ''), chatId: chatId }));
            };
            window.__stopAgent = function(chatId) { invoke('stopAgent', chatId); };
            window.__respondPermission = function(requestId, decision) {
                invoke('respondPermission', JSON.stringify({ requestId: requestId, decision: decision }));
            };
            window.__loadHistoryConversation = function(chatId, projectPath, conversationId) {
                invoke('loadConversation', JSON.stringify({ chatId: chatId, projectPath: (projectPath || ''), conversationId: (conversationId || '') }));
            };
            window.__recoverRuntime = function(reason, requestId) {
                invoke('recoverRuntime', JSON.stringify({ requestId: (requestId || ''), reason: (reason || '') }));
            };
            window.__downloadAgent = function(adapterId) { invoke('downloadAgent', adapterId); };
            window.__cancelAgentInstall = function(adapterId) { invoke('cancelAgentInstall', adapterId); };
            window.__deleteAgent = function(adapterId) { invoke('deleteAgent', adapterId); };
            window.__updateAgent = function(adapterId) { invoke('updateAgent', adapterId); };
            window.__loginAgent = function(adapterId, methodId) {
                invoke('loginAgent', JSON.stringify({ adapterId: adapterId, methodId: methodId }));
            };
            window.__logoutAgent = function(adapterId) { invoke('logoutAgent', adapterId); };
            window.__cancelAgentAuth = function(adapterId) { invoke('cancelAgentAuth', adapterId); };
            window.__fetchAdapterUsage = function(adapterId) { invoke('fetchUsage', adapterId); };
            window.__openAgentCli = function(adapterId) { invoke('openAgentCli', adapterId); };
            window.__openHistoryConversationCli = function(payload) {
                invoke('openHistoryConversationCli', JSON.stringify(payload));
            };
            window.__searchFiles = function(query) { invoke('searchFiles', query); };
            window.__requestFileIcon = function(path) { invoke('iconFile', JSON.stringify({ path: path })); };
            window.__undoFile = function(payload) { invoke('undoFile', payload); };
            window.__undoAllFiles = function(payload) { invoke('undoAllFiles', payload); };
            window.__processFile = function(payload) { invoke('processFile', payload); };
            window.__keepAll = function(payload) { invoke('keepAll', payload); };
            window.__getChangesState = function(payload) { invoke('getChangesState', payload); };
            window.__computeFileChangeStats = function(payload) { invoke('computeFileChangeStats', payload); };
            window.__showDiff = function(payload) { invoke('showDiff', payload); };
            window.__openFile = function(payload) { invoke('openFile', payload); };
            window.__openUrl = function(url) { invoke('openUrl', url); };
            window.__attachFile = function(chatId) { invoke('attachFile', chatId); };
            window.__updateSessionMetadata = function(payload) { invoke('updateSessionMetadata', JSON.stringify(payload)); };
            window.__continueConversationWithSession = function(payload) { invoke('continueConversation', JSON.stringify(payload)); };
            window.__saveConversationTranscript = function(payload) { invoke('saveConversationTranscript', payload); };

            window.__requestHistoryList = function(projectPath) { invoke('requestHistoryList', projectPath); };
            window.__syncHistoryList = function(projectPath) { invoke('syncHistoryList', projectPath); };
            window.__deleteHistoryConversations = function(payload) { invoke('deleteHistoryConversations', JSON.stringify(payload)); };
            window.__renameHistoryConversation = function(payload) { invoke('renameHistoryConversation', JSON.stringify(payload)); };

            window.__loadMcpServers = function() { invoke('loadMcpServers', ''); };
            window.__saveMcpServers = function(json) { invoke('saveMcpServers', json); };
            window.__checkMcpStatus = function() { invoke('checkMcpStatus', ''); };

            window.__loadPromptLibrary = function() { invoke('loadPromptLibrary', ''); };
            window.__savePromptLibrary = function(json) { invoke('savePromptLibrary', json); };

            window.__loadSystemInstructions = function() { invoke('loadSystemInstructions', ''); };
            window.__saveSystemInstructions = function(json) { invoke('saveSystemInstructions', json); };

            window.__loadGlobalSettings = function() { invoke('loadGlobalSettings', ''); };
            window.__saveGlobalSettings = function(payload) { invoke('saveGlobalSettings', payload); };
            window.__loadAudioTranscriptionSettings = function() { invoke('loadAudioTranscriptionSettings', ''); };
            window.__saveAudioTranscriptionSettings = function(payload) { invoke('saveAudioTranscriptionSettings', payload); };

            // Answered by the client itself - see FrontendCommands.
            window.__loadAudioTranscriptionFeature = function() { invoke('loadAudioTranscriptionFeature', ''); };
            window.__installAudioTranscriptionFeature = function() { invoke('installAudioTranscriptionFeature', ''); };
            window.__uninstallAudioTranscriptionFeature = function() { invoke('uninstallAudioTranscriptionFeature', ''); };
            window.__transcribeAudioInput = function(payload) { invoke('transcribeAudioInput', payload); };
            window.__startAudioRecording = function() { invoke('startAudioRecording', ''); };
            window.__stopAudioRecording = function(payload) { invoke('stopAudioRecording', payload); };
            window.__agentDockPlaySound = function(sound) { invoke('playSound', sound); };
            window.__requestHostRepaint = function(reason) { invoke('repaint', reason || ''); };

            window.__settingsBridgeReady = true;
            window.dispatchEvent(new CustomEvent('settings-bridge-ready'));
            window.__notifyReady();
        })();
    """.trimIndent()

    /**
     * Reports the CSS cursor under the pointer so the host can mirror it on the Swing component.
     * JCEF does not do this by itself on Windows, and the component it has to be set on is the one
     * in this process - which is why this never becomes a backend command.
     */
    fun cursorTracking(): String = """
        window.__lastSentCursor = 'default';
        window.__cursorThrottleTimer = null;
        document.addEventListener('mousemove', function(e) {
          if (window.__cursorThrottleTimer !== null) return;
          window.__cursorThrottleTimer = setTimeout(function() {
            window.__cursorThrottleTimer = null;
            const cursor = window.getComputedStyle(e.target).cursor;
            if (window.__lastSentCursor !== cursor) {
              window.__lastSentCursor = cursor;
              window.__agentDockInvoke('cursor', cursor);
            }
          }, 50);
        });
    """.trimIndent()
}
