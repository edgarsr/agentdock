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

    /**
     * [client] is the kind of page: `jcef` or `browser`. A web browser paints and zooms the page
     * itself and opens links in a new tab.
     */
    fun bridgeApi(client: String): String = """
        (function() {
            window.__IS_DEV = ${BuildConfig.IS_DEV};
            window.__AGENT_DOCK_CLIENT = '$client';

            var invoke = function(name, payload) {
                try { window.__agentDockInvoke(name, payload == null ? '' : String(payload)); }
                catch (e) { console.error('[AgentDock] bridge call failed: ' + name, e); }
            };

            window.__notifyReady = function() {
                var isDark = getComputedStyle(document.documentElement).getPropertyValue('--ide-theme-is-dark').trim();
                invoke('ready', isDark === '0' ? 'light' : 'dark');
            };

            window.__requestAdapters = function(adapterIdToRefresh) {
                invoke('listAdapters', adapterIdToRefresh || '');
            };
            window.__rememberAgentConfigOptions = function(adapterId, configValues, links) {
                invoke('rememberConfigOption', JSON.stringify(Object.assign({ adapterId: adapterId, configValues: configValues }, links)));
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
            window.__attachChat = function(chatId, projectPath) {
                invoke('attachChat', JSON.stringify({ chatId: chatId, projectPath: (projectPath || '') }));
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
            window.__fetchAdapterUsage = function(adapterId, view) { invoke('fetchUsage', JSON.stringify({ adapterId: adapterId, view: view === true })); };
            window.__openAgentCli = function(adapterId) { invoke('openAgentCli', adapterId); };
            window.__openHistoryConversationCli = function(payload) {
                invoke('openHistoryConversationCli', JSON.stringify(payload));
            };
            window.__searchFiles = function(payload) { invoke('searchFiles', payload); };
            window.__requestFileIcon = function(path) { invoke('iconFile', JSON.stringify({ path: path })); };
            window.__readLocalImage = function(path) { invoke('readLocalImage', JSON.stringify({ path: path })); };
            window.__undoFile = function(payload) { invoke('undoFile', payload); };
            window.__undoAllFiles = function(payload) { invoke('undoAllFiles', payload); };
            window.__processFile = function(payload) { invoke('processFile', payload); };
            window.__keepAll = function(payload) { invoke('keepAll', payload); };
            window.__getChangesState = function(payload) { invoke('getChangesState', payload); };
            window.__computeFileChangeStats = function(payload) { invoke('computeFileChangeStats', payload); };
            window.__showDiff = function(payload) { invoke('showDiff', payload); };
            window.__openFile = function(payload) { invoke('openFile', payload); };
            window.__openUrl = ${if (client == "browser") "function(url) { window.open(url, '_blank', 'noopener,noreferrer'); }" else "function(url) { invoke('openUrl', url); }"};
            window.__attachFile = function(chatId) { invoke('attachFile', chatId); };
            window.__updateSessionMetadata = function(payload) { invoke('updateSessionMetadata', JSON.stringify(payload)); };
            window.__continueConversationWithSession = function(payload) { invoke('continueConversation', JSON.stringify(payload)); };
            window.__saveConversationTranscript = function(payload) { invoke('saveConversationTranscript', payload); };

            window.__requestHistoryList = function(projectPath) { invoke('requestHistoryList', projectPath); };
            window.__syncHistoryList = function(projectPath) { invoke('syncHistoryList', projectPath); };
            window.__deleteHistoryConversations = function(payload) { invoke('deleteHistoryConversations', JSON.stringify(payload)); };
            window.__updateHistoryConversations = function(payload) { invoke('updateHistoryConversations', JSON.stringify(payload)); };
            window.__renameHistoryGroup = function(payload) { invoke('renameHistoryGroup', JSON.stringify(payload)); };
            window.__searchHistoryConversations = function(payload) { invoke('searchHistoryConversations', JSON.stringify(payload)); };

            window.__loadMcpServers = function() { invoke('loadMcpServers', ''); };
            window.__saveMcpServers = function(json) { invoke('saveMcpServers', json); };
            window.__checkMcpStatus = function(id) { invoke('checkMcpStatus', id); };
            window.__cancelMcpStatus = function(id) { invoke('cancelMcpStatus', id); };

            window.__loadCustomAcpConfigs = function() { invoke('loadCustomAcpConfigs', ''); };
            window.__saveCustomAcpConfigs = function(json) { invoke('saveCustomAcpConfigs', json); };
            window.__testCustomAcpConnection = function(json) { invoke('testCustomAcpConnection', json); };
            window.__cancelCustomAcpConnectionTest = function(id) { invoke('cancelCustomAcpConnectionTest', id); };

            window.__loadPromptLibrary = function() { invoke('loadPromptLibrary', ''); };
            window.__savePromptLibrary = function(json) { invoke('savePromptLibrary', json); };

            window.__loadSystemInstructions = function() { invoke('loadSystemInstructions', ''); };
            window.__saveSystemInstructions = function(json) { invoke('saveSystemInstructions', json); };

            window.__loadGlobalSettings = function() { invoke('loadGlobalSettings', ''); };
            window.__saveGlobalSettings = function(payload) { invoke('saveGlobalSettings', payload); };
            // Answered by the client itself - see FrontendCommands.
            window.__loadAudioTranscriptionFeature = function(payload) { invoke('loadAudioTranscriptionFeature', payload || ''); };
            window.__installAudioTranscriptionFeature = function(payload) { invoke('installAudioTranscriptionFeature', payload || ''); };
            window.__cancelAudioTranscriptionFeatureInstall = function(payload) { invoke('cancelAudioTranscriptionFeatureInstall', payload || ''); };
            window.__uninstallAudioTranscriptionFeature = function(payload) { invoke('uninstallAudioTranscriptionFeature', payload || ''); };
            window.__startAudioRecording = function(ownerId) { invoke('startAudioRecording', ownerId || ''); };
            window.__stopAudioRecording = function(payload) { invoke('stopAudioRecording', payload); };
            window.__cancelAudioTranscription = function(payload) { invoke('cancelAudioTranscription', payload); };
            window.__cancelAudioRecording = function(ownerId) { invoke('cancelAudioRecording', ownerId || ''); };
            window.__startSpeech = function(payload) { invoke('startSpeech', payload); };
            window.__stopSpeech = function(requestId) { invoke('stopSpeech', requestId || ''); };
            window.__agentDockPlaySound = function(sound) { invoke('playSound', sound); };
            ${if (client == "browser") "" else "window.__requestHostRepaint = function(reason) { invoke('repaint', reason || ''); };"}
            window.__readUiVisibility = function() { invoke('readUiVisibility', ''); };
            ${if (client == "browser") "" else "window.__readUiZoom = function() { invoke('readUiZoom', ''); };"}
            window.__setAttentionBadge = function(level) { invoke('setAttentionBadge', level || ''); };
            window.__readBrowserAddress = function() { invoke('readBrowserAddress', ''); };
            window.__loadUiWorkspace = function() { invoke('loadUiWorkspace', ''); };
            window.__saveUiWorkspace = function(json) { invoke('saveUiWorkspace', json); };

            window.__settingsBridgeReady = true;
            window.dispatchEvent(new CustomEvent('settings-bridge-ready'));
            window.__notifyReady();
        })();
    """.trimIndent()

    /** Makes a page that does not show the UI say so and offer to take it over. */
    const val ELSEWHERE = "window.__agentDockElsewhere = true; window.dispatchEvent(new CustomEvent('agent-dock-elsewhere'));"

    /**
     * The web page's side of [WebUi], run once the page has loaded. Commands go out as POSTs in the
     * order they were made, scripts come in as server-sent events, and the bridge API is installed
     * only once the server says this page shows the UI. The page keeps its ID across reloads.
     */
    fun browserBridge(): String = """
        (function() {
            // A duplicated tab gets a copy of sessionStorage, so the ID is kept there only while the page is not shown.
            var id = sessionStorage.getItem('agentDockUiId') || crypto.randomUUID();
            sessionStorage.removeItem('agentDockUiId');
            window.addEventListener('pagehide', function() { sessionStorage.setItem('agentDockUiId', id); });
            window.addEventListener('pageshow', function() { sessionStorage.removeItem('agentDockUiId'); });
            var query = 'c=' + encodeURIComponent(id);
            var shown = false;
            var lost = false;
            var pending = [];
            var sending = false;
            var send = function() {
                if (sending || pending.length === 0) return;
                sending = true;
                var batch = pending;
                pending = [];
                fetch('commands?' + query, { method: 'POST', body: JSON.stringify(batch) })
                    // The server no longer knows this page that showed the UI: a reload asks it again.
                    .then(function(r) { if (r.status === 409 && shown && !window.__agentDockElsewhere) location.reload(); })
                    .catch(function() { })
                    .then(function() { sending = false; send(); });
            };
            // Saving the workspace does not hold up the commands, and a newer workspace replaces one not yet sent.
            var workspace = null;
            var saving = false;
            var saveWorkspace = function() {
                if (saving || workspace === null) return;
                saving = true;
                var body = JSON.stringify([{ n: 'saveUiWorkspace', p: workspace }]);
                workspace = null;
                fetch('commands?' + query, { method: 'POST', body: body })
                    .catch(function() { })
                    .then(function() { saving = false; saveWorkspace(); });
            };
            window.__agentDockInvoke = function(name, payload) {
                if (name === 'saveUiWorkspace') {
                    workspace = payload;
                    return saveWorkspace();
                }
                pending.push({ n: name, p: payload });
                send();
            };
            window.__takeOverUi = function() {
                fetch('takeover?' + query, { method: 'POST' }).then(function() { location.reload(); });
            };
            window.__reloadUi = function() { location.reload(); };
            document.addEventListener('visibilitychange', function() {
                window.dispatchEvent(new CustomEvent('agent-dock-ui-visibility', { detail: !document.hidden }));
            });

            var events = new EventSource('events?' + query);
            events.onmessage = function(e) { (0, eval)(e.data); };
            // The IDE or the project closed, or the connection went; the stream reconnects by itself.
            events.onerror = function() {
                if (lost) return;
                lost = true;
                window.__agentDockDisconnected = true;
                window.dispatchEvent(new CustomEvent('agent-dock-disconnected'));
            };
            events.addEventListener('reload', function() { location.reload(); });
            events.addEventListener('elsewhere', function() {
                events.close();
                $ELSEWHERE
            });
            // A reconnected stream may have missed events: the page reloads and restores the UI.
            events.addEventListener('active', function() {
                if (shown || lost) return location.reload();
                shown = true;
                ${bridgeApi("browser")}
            });
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
        function reportCursor(target) {
          if (!target) return;
          const cursor = window.getComputedStyle(target).cursor;
          if (window.__lastSentCursor !== cursor) {
            window.__lastSentCursor = cursor;
            window.__agentDockInvoke('cursor', cursor);
          }
        }
        document.addEventListener('mousemove', function(e) {
          if (window.__cursorThrottleTimer !== null) return;
          window.__cursorThrottleTimer = setTimeout(function() {
            window.__cursorThrottleTimer = null;
            reportCursor(e.target);
          }, 50);
        });
        // Image click handlers can stop propagation, so observe clicks in the capture phase.
        document.addEventListener('click', function(e) {
          if (window.__cursorThrottleTimer !== null) {
            clearTimeout(window.__cursorThrottleTimer);
            window.__cursorThrottleTimer = null;
          }
          requestAnimationFrame(function() {
            reportCursor(document.elementFromPoint(e.clientX, e.clientY));
          });
        }, true);
    """.trimIndent()
}
