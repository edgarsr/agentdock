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
import { EmptyStateView } from './components/EmptyStateView';
import ConfirmationModal from './components/ConfirmationModal';

let tabCounter = 0;
function nextId(prefix: string): string {
  return `${prefix}-${++tabCounter}-${Date.now()}`;
}

const DEFAULT_TAB_UI: TabUiFlags = { unread: false, atBottom: true, canMarkRead: true, warning: false };

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
  const [adaptersResolved, setAdaptersResolved] = useState(false);
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
  const lastStableNewTabAgentIdRef = useRef<string>('');
  const stableAgentSnapshotsRef = useRef<Record<string, AgentOption>>({});

  const canUserSeeResponse = useCallback((tabId: string) => {
    const isActive = tabId === activeTabIdRef.current;
    const canMarkRead = tabUiRef.current[tabId]?.canMarkRead ?? true;
    return isActive && canMarkRead;
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
    const dispose = ACPBridge.onAdapters((e) => {
      const safeAdapters = Array.isArray(e.detail.adapters) ? e.detail.adapters : [];
      const nextSnapshots = { ...stableAgentSnapshotsRef.current };
      safeAdapters.forEach((agent) => {
        const previous = nextSnapshots[agent.id];
        nextSnapshots[agent.id] = {
          ...previous,
          ...agent,
          iconPath: agent.iconPath || previous?.iconPath,
          name: agent.name || previous?.name,
        };
      });
      stableAgentSnapshotsRef.current = nextSnapshots;

      const stableLastUsedRunnableId = safeAdapters.find((agent) => agent.isLastUsed && agent.downloaded === true)?.id;
      if (stableLastUsedRunnableId) {
        lastStableNewTabAgentIdRef.current = stableLastUsedRunnableId;
      } else {
        const currentStable = lastStableNewTabAgentIdRef.current;
        const currentStableStatus = currentStable ? safeAdapters.find((agent) => agent.id === currentStable) : undefined;
        if (currentStableStatus?.downloadedKnown === true && currentStableStatus.downloaded !== true) {
          lastStableNewTabAgentIdRef.current = safeAdapters.find((agent) => agent.downloaded === true)?.id || '';
        } else if (!currentStable) {
          lastStableNewTabAgentIdRef.current = safeAdapters.find((agent) => agent.downloaded === true)?.id || '';
        }
      }

      setAvailableAgents(safeAdapters);
      setAdaptersResolved(true);
      if (safeAdapters.length > 0) {
        try {
          localStorage.setItem('unified-llm.adapters', JSON.stringify(safeAdapters));
        } catch (e) {
          console.warn('[App] Failed to cache adapters:', e);
        }
      }
    });
    ACPBridge.requestAdapters();
    return dispose;
  }, []);

  useEffect(() => {
    return ACPBridge.onHistoryList((e) => {
      const historyByConversationId = new Map(
        e.detail.list
          .filter((item) => item.conversationId && item.title?.trim())
          .map((item) => [item.conversationId, item])
      );

      setTabs((prev) => {
        let changed = false;
        const next = prev.map((tab) => {
          if (tab.type !== 'chat') return tab;

          const historyItem = historyByConversationId.get(tab.historySession?.conversationId || tab.conversationId);
          const nextTitle = historyItem?.title?.trim();
          if (!nextTitle || nextTitle === tab.title) {
            if (!historyItem || !tab.historySession) return tab;
            if (tab.historySession.title === historyItem.title) return tab;
            changed = true;
            return {
              ...tab,
              historySession: {
                ...tab.historySession,
                title: historyItem.title,
              }
            };
          }

          changed = true;
          return {
            ...tab,
            title: nextTitle,
            historySession: historyItem
          };
        });

        return changed ? next : prev;
      });
    });
  }, []);

  useEffect(() => {
    return ACPBridge.onExecutionTargetSwitched(() => {
      const activeSettingsTab = tabsRef.current.find(
        tab => tab.id === activeTabIdRef.current && tab.type === 'settings'
      );
      const remainingTabs = activeSettingsTab ? [activeSettingsTab] : [];
      const closedTabIds = tabsRef.current
        .filter(tab => !activeSettingsTab || tab.id !== activeSettingsTab.id)
        .map(tab => tab.id);

      setTabs(remainingTabs);
      setTabUi(prev => {
        const next = { ...prev };
        closedTabIds.forEach(id => delete next[id]);
        return next;
      });
      setTabSessionState(prev => {
        const next = { ...prev };
        closedTabIds.forEach(id => delete next[id]);
        return next;
      });
      setPendingHandoffsByTab(prev => {
        const next = { ...prev };
        closedTabIds.forEach(id => delete next[id]);
        return next;
      });
      closedTabIds.forEach(id => {
        delete pendingPermissionRef.current[id];
        delete pendingConversationContinuationsRef.current[id];
      });
      setPendingAgentSwitch(null);
      setActiveTabId(activeSettingsTab?.id ?? '');
    });
  }, []);

  const runnableAgents = useMemo(() => availableAgents.filter(isAgentRunnable), [availableAgents]);
  const agentAvailabilityResolved = useMemo(
    () => adaptersResolved && availableAgents.every((agent) => agent.downloadedKnown === true),
    [adaptersResolved, availableAgents]
  );
  const pendingAgentName = pendingAgentSwitch
    ? (availableAgents.find((agent) => agent.id === pendingAgentSwitch.targetAgentId)?.name || pendingAgentSwitch.targetAgentId)
    : 'the selected agent';

  const handleNewTab = useCallback((agentId?: string) => {
    const resolvedAgentId = runnableAgents.some(agent => agent.id === agentId)
      ? agentId
      : lastStableNewTabAgentIdRef.current
        || runnableAgents.find(agent => agent.isLastUsed)?.id
        || runnableAgents[0]?.id;
    if (!resolvedAgentId) {
      return;
    }
    const newId = nextId('tab');
    const newConversationId = nextId('conv');
    const title = 'New';
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
    const title = 'New';

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
    const title = item.title || 'New';

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
      const next = {
        ...current,
        atBottom: isAtBottom,
      };

      if (
        current.atBottom === next.atBottom &&
        current.canMarkRead === next.canMarkRead &&
        current.unread === next.unread &&
        current.warning === next.warning
      ) {
        return prev;
      }

      return { ...prev, [tabId]: next };
    });
  }, []);

  const handleCanMarkReadChange = useCallback((tabId: string, canMarkRead: boolean) => {
    setTabUi(prev => {
      const current = prev[tabId] ?? DEFAULT_TAB_UI;
      const shouldClearUnread = canMarkRead && tabId === activeTabIdRef.current && current.unread;
      const next = {
        ...current,
        canMarkRead,
        unread: shouldClearUnread ? false : current.unread,
      };

      if (
        current.atBottom === next.atBottom &&
        current.canMarkRead === next.canMarkRead &&
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
          if ((tabUi[id]?.canMarkRead ?? true)) {
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
                  onCanMarkReadChange={(canMarkRead) => handleCanMarkReadChange(tab.id, canMarkRead)}
                  onPermissionRequestChange={(hasPendingPermission) => handlePermissionRequestChange(tab.id, hasPendingPermission)}
                  onAgentChangeRequest={(payload) => requestAgentSwitch(tab.id, payload)}
                  onHandoffConsumed={(handoffId) => handleHandoffConsumed(tab.id, handoffId)}
                  onSessionStateChange={(state) => handleChatSessionStateChange(tab.id, state)}
                />
              )}
              {tab.type !== 'chat' && (
                <>
                  {tab.type === 'management' && <AgentManagementView initialAgents={availableAgents} isActive={isTabActive} />}
                  {tab.type === 'design' && <DesignSystemView />}
                  {tab.type === 'history' && (
                    <HistoryPanel availableAgents={availableAgents} onOpenSession={handleOpenHistory} />
                  )}
                  {tab.type === 'mcp' && <McpServersView />}
                  {tab.type === 'prompt-library' && <PromptLibraryView />}
                  {tab.type === 'system-instructions' && <SystemInstructionsView />}
                  {tab.type === 'settings' && <SettingsView />}
                </>
              )}
            </div>
          );
        })}

        {/* Empty state */}
        {tabs.length === 0 && (
          <EmptyStateView
            availableAgents={availableAgents}
            runnableAgents={runnableAgents}
            adaptersResolved={agentAvailabilityResolved}
            onStartWithAgent={handleNewTab}
            onOpenRecentConversation={handleOpenHistory}
            onOpenHistory={() => openSingletonTab('history', 'History')}
            onOpenManagement={() => openSingletonTab('management', 'Service Providers')}
          />
        )}
      </div>

      <ConfirmationModal
        isOpen={pendingAgentSwitch !== null}
        title={`Switch to ${pendingAgentName}`}
        message={`Click "Continue" to pass the current chat context to ${pendingAgentName}.` + "\n" + `Click "Start New" to begin a new separate chat.`}
        confirmLabel="Continue"
        
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












