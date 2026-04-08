import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ChatTab, AgentOption, HistorySessionMeta, PendingHandoffContext, TabUiFlags, TabType, isAgentRunnable } from './types/chat';
import { ACPBridge } from './utils/bridge';
import TabBar from './components/TabBar';
import ChatSessionView from './components/chat/ChatSessionView';
import HistoryPanel from './components/HistoryPanel';
import { AgentManagementView } from './components/AgentManagement';
import { DesignSystemView } from './components/DesignSystem';
import { McpServersView } from './components/McpServersView';
import { PromptLibraryView } from './components/PromptLibraryView';
import { SystemInstructionsView } from './components/SystemInstructionsView';
import { SettingsView } from './components/SettingsView';
import ConfirmationModal from './components/ConfirmationModal';

let tabCounter = 0;
function nextId(prefix: string): string {
  return `${prefix}-${++tabCounter}-${Date.now()}`;
}

const DEFAULT_TAB_UI: TabUiFlags = { unread: false, atBottom: true, warning: false };

interface TabSessionState {
  acpSessionId: string;
  adapterName: string;
}

interface PendingAgentSwitch {
  tabId: string;
  targetAgentId: string;
  handoffText: string;
}

interface PendingConversationContinuation {
  previousSessionId: string;
  previousAdapterName: string;
  targetAgentId: string;
}

function App() {
  const [tabs, setTabs] = useState<ChatTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const [availableAgents, setAvailableAgents] = useState<AgentOption[]>([]);
  const [tabUi, setTabUi] = useState<Record<string, TabUiFlags>>({});
  const [tabSessionState, setTabSessionState] = useState<Record<string, TabSessionState>>({});
  const [pendingAgentSwitch, setPendingAgentSwitch] = useState<PendingAgentSwitch | null>(null);
  const [pendingHandoffsByTab, setPendingHandoffsByTab] = useState<Record<string, PendingHandoffContext>>({});
  const pendingPermissionRef = useRef<Record<string, boolean>>({});
  const pendingConversationContinuationsRef = useRef<Record<string, PendingConversationContinuation>>({});

  // Refs for stable callbacks
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const tabUiRef = useRef(tabUi);
  tabUiRef.current = tabUi;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  const canUserSeeResponse = useCallback((tabId: string) => {
    const isActive = tabId === activeTabIdRef.current;
    const atBottom = tabUiRef.current[tabId]?.atBottom ?? true;
    return isActive && atBottom;
  }, []);

  // Helpers for tab UI state init/cleanup
  const initTabUi = (id: string) => {
    setTabUi(prev => ({ ...prev, [id]: { ...DEFAULT_TAB_UI } }));
    pendingPermissionRef.current[id] = false;
  };

  const cleanupTabUi = (id: string) => {
    setTabUi(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    delete pendingPermissionRef.current[id];
    setTabSessionState(prev => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setPendingHandoffsByTab(prev => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    delete pendingConversationContinuationsRef.current[id];
  };

  // Single global listener for adapter updates
  useEffect(() => {
    return ACPBridge.onAdapters((e) => {
      const safeAdapters = Array.isArray(e.detail.adapters) ? e.detail.adapters : [];
      setAvailableAgents(safeAdapters);
      if (safeAdapters.length > 0) {
        try {
          localStorage.setItem('unified-llm.adapters', JSON.stringify(safeAdapters));
        } catch (e) {
          console.warn('[App] Failed to cache adapters:', e);
        }
      }
    });
  }, []);

  useEffect(() => {
    return ACPBridge.onExecutionTargetSwitched(() => {
      const chatTabIds = tabsRef.current.filter(tab => tab.type === 'chat').map(tab => tab.id);
      setTabs(prev => prev.filter(tab => tab.type !== 'chat'));
      setTabUi(prev => {
        const next = { ...prev };
        chatTabIds.forEach(id => delete next[id]);
        return next;
      });
      setTabSessionState(prev => {
        const next = { ...prev };
        chatTabIds.forEach(id => delete next[id]);
        return next;
      });
      setPendingHandoffsByTab(prev => {
        const next = { ...prev };
        chatTabIds.forEach(id => delete next[id]);
        return next;
      });
      chatTabIds.forEach(id => {
        delete pendingPermissionRef.current[id];
        delete pendingConversationContinuationsRef.current[id];
      });

      const remainingTabs = tabsRef.current.filter(tab => tab.type !== 'chat');
      setActiveTabId(current => {
        if (remainingTabs.length === 0) return '';
        if (remainingTabs.some(tab => tab.id === current)) return current;
        return remainingTabs[0].id;
      });
    });
  }, []);

  const runnableAgents = useMemo(() => availableAgents.filter(isAgentRunnable), [availableAgents]);
  const pendingAgentName = pendingAgentSwitch
    ? (availableAgents.find((agent) => agent.id === pendingAgentSwitch.targetAgentId)?.name || pendingAgentSwitch.targetAgentId)
    : 'the selected agent';

  const handleNewTab = useCallback((agentId?: string) => {
    const resolvedAgentId = runnableAgents.some(agent => agent.id === agentId)
      ? agentId
      : runnableAgents.find(agent => agent.isLastUsed)?.id || runnableAgents[0]?.id;
    const newId = nextId('tab');
    const newConversationId = nextId('conv');
    const title = 'Untitled';
    setTabs((prev) => [...prev, { id: newId, type: 'chat', title, conversationId: newConversationId, agentId: resolvedAgentId }]);
    initTabUi(newId);
    setActiveTabId(newId);
  }, [runnableAgents]);

  const handleChatSessionStateChange = useCallback((tabId: string, state: TabSessionState) => {
    setTabSessionState(prev => {
      const current = prev[tabId];
      if (current?.acpSessionId === state.acpSessionId && current?.adapterName === state.adapterName) {
        return prev;
      }
      return { ...prev, [tabId]: state };
    });

    const pendingContinuation = pendingConversationContinuationsRef.current[tabId];
    if (!pendingContinuation) return;
    if (!state.acpSessionId || !state.adapterName) return;
    if (state.acpSessionId === pendingContinuation.previousSessionId) return;
    if (state.adapterName !== pendingContinuation.targetAgentId) return;

    const tab = tabsRef.current.find(item => item.id === tabId);
    ACPBridge.continueConversationWithSession({
      previousSessionId: pendingContinuation.previousSessionId,
      previousAdapterName: pendingContinuation.previousAdapterName,
      sessionId: state.acpSessionId,
      adapterName: state.adapterName,
      title: tab?.title
    });
    delete pendingConversationContinuationsRef.current[tabId];
  }, []);

  const requestAgentSwitch = useCallback((tabId: string, payload: { agentId: string; handoffText: string }) => {
    const tab = tabsRef.current.find(item => item.id === tabId);
    if (!tab || tab.type !== 'chat') return;

    const currentSession = tabSessionState[tabId];
    const hasConversationToContinue = Boolean(currentSession?.acpSessionId && payload.handoffText.trim());
    if (!hasConversationToContinue) {
      setTabs(prev => prev.map(item => (
        item.id === tabId
          ? { ...item, agentId: payload.agentId, historySession: undefined }
          : item
      )));
      setActiveTabId(tabId);
      return;
    }

    setPendingAgentSwitch({
      tabId,
      targetAgentId: payload.agentId,
      handoffText: payload.handoffText,
    });
  }, [tabSessionState]);

  const handleContinueInNewTab = useCallback(() => {
    if (!pendingAgentSwitch) return;

    const closingTab = tabsRef.current.find(item => item.id === pendingAgentSwitch.tabId);
    if (closingTab?.type === 'chat' && typeof window.__stopAgent === 'function') {
      try {
        window.__stopAgent(closingTab.conversationId);
      } catch (e) {
        console.warn('[App] Failed to stop agent:', e);
      }
    }

    const resolvedAgentId = runnableAgents.some(agent => agent.id === pendingAgentSwitch.targetAgentId)
      ? pendingAgentSwitch.targetAgentId
      : runnableAgents[0]?.id;
    const newId = nextId('tab');
    const newConversationId = nextId('conv');
    const title = 'Untitled';

    setTabs(prev => {
      const remaining = prev.filter(item => item.id !== pendingAgentSwitch.tabId);
      return [...remaining, { id: newId, type: 'chat', title, conversationId: newConversationId, agentId: resolvedAgentId }];
    });
    cleanupTabUi(pendingAgentSwitch.tabId);
    setActiveTabId(newId);
    setPendingAgentSwitch(null);
  }, [pendingAgentSwitch, runnableAgents]);

  const handleContinueInCurrentConversation = useCallback(() => {
    if (!pendingAgentSwitch) return;

    const currentSession = tabSessionState[pendingAgentSwitch.tabId];
    if (currentSession?.acpSessionId && currentSession.adapterName) {
      const handoffContext: PendingHandoffContext = {
        id: nextId('handoff'),
        sourceSessionId: currentSession.acpSessionId,
        sourceAgentId: currentSession.adapterName,
        targetAgentId: pendingAgentSwitch.targetAgentId,
        text: pendingAgentSwitch.handoffText,
      };

      pendingConversationContinuationsRef.current[pendingAgentSwitch.tabId] = {
        previousSessionId: currentSession.acpSessionId,
        previousAdapterName: currentSession.adapterName,
        targetAgentId: pendingAgentSwitch.targetAgentId,
      };
      setPendingHandoffsByTab(prev => ({
        ...prev,
        [pendingAgentSwitch.tabId]: handoffContext,
      }));
    }

    setTabs(prev => prev.map(tab => (
      tab.id === pendingAgentSwitch.tabId
        ? { ...tab, agentId: pendingAgentSwitch.targetAgentId, historySession: undefined }
        : tab
    )));
    setActiveTabId(pendingAgentSwitch.tabId);
    setPendingAgentSwitch(null);
  }, [pendingAgentSwitch, tabSessionState]);

  const handleHandoffConsumed = useCallback((tabId: string, handoffId: string) => {
    setPendingHandoffsByTab(prev => {
      const current = prev[tabId];
      if (!current || current.id !== handoffId) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
  }, []);

  /** Open a singleton tab of the given type (management/design/history). If already open, just switch to it. */
  const openSingletonTab = useCallback((type: TabType, title: string) => {
    const existing = tabsRef.current.find(t => t.type === type);
    if (existing) {
      setActiveTabId(existing.id);
      if (type === 'management') {
        ACPBridge.requestAdapters();
      }
      return;
    }
    const newId = nextId('tab');
    setTabs(prev => [...prev, { id: newId, type, title, conversationId: newId }]);
    setActiveTabId(newId);
  }, []);

  const handleCloseTab = (id: string) => {
    const closingTab = tabs.find(t => t.id === id);
    if (closingTab?.type === 'chat' && typeof window.__stopAgent === 'function') {
      try {
        window.__stopAgent(closingTab.conversationId);
      } catch (e) {
        console.warn('[App] Failed to stop agent:', e);
      }
    }

    const newTabs = tabs.filter((t) => t.id !== id);
    cleanupTabUi(id);

    if (newTabs.length === 0) {
      setTabs([]);
      setActiveTabId('');
      return;
    }

    setTabs(newTabs);

    if (activeTabId === id) {
      const currentIndex = tabs.findIndex(t => t.id === id);
      if (currentIndex > 0) {
        setActiveTabId(tabs[currentIndex - 1].id);
      } else if (tabs.length > 1) {
        setActiveTabId(tabs[currentIndex + 1].id);
      }
    }
  };

  const handleCloseAllTabs = () => {
    if (typeof window.__stopAgent === 'function') {
      tabs.forEach((tab) => {
        if (tab.type === 'chat') {
          try { window.__stopAgent?.(tab.conversationId); } catch (e) {}
        }
      });
    }
    setTabs([]);
    setTabUi({});
    pendingPermissionRef.current = {};
    setActiveTabId('');
  };

  const handleOpenHistory = (item: HistorySessionMeta) => {
    const conversationKey = item.conversationId;
    const existing = tabsRef.current.find((tab) => {
      if (tab.type !== 'chat') return false;
      if (tab.conversationId === conversationKey) return true;
      return tab.historySession?.conversationId === conversationKey;
    });
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }

    const newId = nextId('tab');
    const title = item.title || 'Untitled';

    // Open the history session as a new chat tab
    setTabs((prev) => [
      ...prev,
      {
        id: newId,
        type: 'chat',
        title,
        conversationId: conversationKey,
        agentId: item.adapterName,
        historySession: item
      }
    ]);
    initTabUi(newId);
    setActiveTabId(newId);
  };

  const handleAssistantActivity = useCallback((tabId: string) => {
    if (pendingPermissionRef.current[tabId] || tabUiRef.current[tabId]?.warning) {
      setTabUi(prev => prev[tabId]?.unread ? { ...prev, [tabId]: { ...prev[tabId], unread: false } } : prev);
      return;
    }
    if (canUserSeeResponse(tabId)) {
      setTabUi(prev => prev[tabId]?.unread ? { ...prev, [tabId]: { ...prev[tabId], unread: false } } : prev);
      return;
    }
    setTabUi(prev => ({ ...prev, [tabId]: { ...prev[tabId], unread: true } }));
  }, [canUserSeeResponse]);

  const handleAtBottomChange = useCallback((tabId: string, isAtBottom: boolean) => {
    setTabUi(prev => {
      const current = prev[tabId] ?? DEFAULT_TAB_UI;
      const shouldClearUnread = isAtBottom && tabId === activeTabIdRef.current && current.unread;
      const next = {
        ...current,
        atBottom: isAtBottom,
        unread: shouldClearUnread ? false : current.unread,
      };

      if (
        current.atBottom === next.atBottom &&
        current.unread === next.unread &&
        current.warning === next.warning
      ) {
        return prev;
      }

      return { ...prev, [tabId]: next };
    });
  }, []);

  const handlePermissionRequestChange = useCallback((tabId: string, hasPendingPermission: boolean) => {
    pendingPermissionRef.current[tabId] = hasPendingPermission;
    setTabUi(prev => {
      const current = prev[tabId];
      if (!current) return prev;
      const needsUpdate = current.warning !== hasPendingPermission;
      if (!needsUpdate) return prev;
      return {
        ...prev,
        [tabId]: {
          ...current,
          unread: hasPendingPermission ? false : current.unread,
          warning: hasPendingPermission
        }
      };
    });
  }, []);

  useEffect(() => {
    if (!activeTabId) return;
    if (canUserSeeResponse(activeTabId)) {
      setTabUi(prev => prev[activeTabId]?.unread ? { ...prev, [activeTabId]: { ...prev[activeTabId], unread: false } } : prev);
    }
  }, [activeTabId, canUserSeeResponse]);

  return (
    <div className="h-screen bg-background text-foreground overflow-hidden flex flex-col">
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        tabUi={tabUi}
        onSelectTab={(id) => {
          setActiveTabId(id);
          if ((tabUi[id]?.atBottom ?? true)) {
            setTabUi(prev => prev[id]?.unread ? { ...prev, [id]: { ...prev[id], unread: false } } : prev);
          }
        }}
        onCloseTab={handleCloseTab}
        onCloseAllTabs={handleCloseAllTabs}
        onNewTab={() => handleNewTab()}
        onNewTabWithAgent={(agentId) => handleNewTab(agentId)}
        agents={availableAgents}
        onOpenHistory={() => openSingletonTab('history', 'History')}
        onOpenManagement={() => openSingletonTab('management', 'Service Providers')}
        onOpenDesignSystem={() => openSingletonTab('design', 'Design System')}
        onOpenMcp={() => openSingletonTab('mcp', 'MCP Servers')}
        onOpenPromptLibrary={() => openSingletonTab('prompt-library', 'Prompt Library')}
        onOpenSystemInstructions={() => openSingletonTab('system-instructions', 'System Instructions')}
        onOpenSettings={() => openSingletonTab('settings', 'Settings')}
      />

      <div className="flex-1 relative min-h-0">
        {/* All tabs -- keep mounted for state preservation, toggle visibility */}
        {tabs.map((tab) => {
          const isTabActive = tab.id === activeTabId;

          return (
            <div
              key={tab.id}
              className={`absolute inset-0 w-full h-full bg-background ${isTabActive ? 'z-10 visible' : 'z-0 invisible'}`}
            >
              {tab.type === 'chat' && (
                <ChatSessionView
                  initialAgentId={tab.agentId}
                  conversationId={tab.conversationId}
                  historySession={tab.historySession}
                  pendingHandoff={pendingHandoffsByTab[tab.id]}
                  availableAgents={runnableAgents}
                  isActive={isTabActive}
                  onAssistantActivity={() => handleAssistantActivity(tab.id)}
                  onAtBottomChange={(isAtBottom) => handleAtBottomChange(tab.id, isAtBottom)}
                  onPermissionRequestChange={(hasPendingPermission) => handlePermissionRequestChange(tab.id, hasPendingPermission)}
                  onAgentChangeRequest={(payload) => requestAgentSwitch(tab.id, payload)}
                  onHandoffConsumed={(handoffId) => handleHandoffConsumed(tab.id, handoffId)}
                  onSessionStateChange={(state) => handleChatSessionStateChange(tab.id, state)}
                />
              )}
              {tab.type === 'management' && <AgentManagementView initialAgents={availableAgents} isActive={isTabActive} />}
              {tab.type === 'design' && <DesignSystemView />}
              {tab.type === 'history' && (
                <HistoryPanel availableAgents={availableAgents} onOpenSession={handleOpenHistory} />
              )}
              {tab.type === 'mcp' && <McpServersView />}
              {tab.type === 'prompt-library' && <PromptLibraryView />}
              {tab.type === 'system-instructions' && <SystemInstructionsView />}
              {tab.type === 'settings' && <SettingsView />}
            </div>
          );
        })}

        {/* Empty state */}
        {tabs.length === 0 && (
          <div className="absolute inset-0 w-full h-full z-10 bg-background flex items-center justify-center">
            <div className="flex flex-col items-center gap-4 max-w-[620px] px-6 text-center">
              {runnableAgents.length === 0 ? (
                <>
                  <div className="text-ide-regular text-foreground/85">
                    No AI agents are currently available.
                  </div>
                  <div className="text-sm text-foreground/60">
                    Install at least one agent and sign in from the plugin Agent Management section.
                  </div>
                  <button
                    onClick={() => openSingletonTab('management', 'Service Providers')}
                    className="px-4 py-2 rounded-md border border-border bg-background-secondary hover:bg-accent hover:text-accent-foreground transition-colors text-ide-regular"
                  >
                    Open Agent Management
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => handleNewTab()}
                    className="px-4 py-2 rounded-md border border-border bg-background-secondary hover:bg-accent hover:text-accent-foreground transition-colors text-ide-regular"
                  >
                    Open new chat
                  </button>
                <div className="flex items-center gap-2 flex-wrap justify-center max-w-[520px]">
                  {runnableAgents.map((agent) => (
                    <button
                      key={agent.id}
                      onClick={() => handleNewTab(agent.id)}
                      className="px-3 py-1.5 rounded-md border border-border bg-background-secondary hover:bg-accent hover:text-accent-foreground transition-colors text-xs flex items-center gap-2"
                    >
                      {agent.iconPath && <img src={agent.iconPath} className="w-3.5 h-3.5" alt="" />}
                      <span>{agent.name}</span>
                    </button>
                  ))}
                </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <ConfirmationModal
        isOpen={pendingAgentSwitch !== null}
        title={`Switch to ${pendingAgentName}`}
        message={`Click "Continue" to pass the current conversation context to ${pendingAgentName}.` + "\n" + `Click "Start New" to begin a new separate conversation.`}
        confirmLabel="Continue"
        confirmVariant="primary"
        secondaryActionLabel="Start New"
        onSecondaryAction={handleContinueInNewTab}
        showCancelButton={false}
        onConfirm={handleContinueInCurrentConversation}
        onCancel={() => setPendingAgentSwitch(null)}
      />
    </div>
  );
}

export default App;












