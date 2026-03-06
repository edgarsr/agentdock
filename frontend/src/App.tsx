import { useState, useEffect, useCallback, useRef } from 'react';
import { ChatTab, AgentOption, HistorySessionMeta, TabUiFlags, TabType } from './types/chat';
import { ACPBridge } from './utils/bridge';
import TabBar from './components/TabBar';
import ChatSessionView from './components/chat/ChatSessionView';
import HistoryPanel from './components/HistoryPanel';
import { AgentManagementView } from './components/AgentManagement';
import { DesignSystemView } from './components/DesignSystem';

let tabCounter = 0;
function nextId(prefix: string): string {
  return `${prefix}-${++tabCounter}-${Date.now()}`;
}

const INITIAL_TAB_ID = nextId('tab');
const INITIAL_SESSION_ID = nextId('ses');

const DEFAULT_TAB_UI: TabUiFlags = { unread: false, atBottom: true, warning: false };

function App() {
  const [tabs, setTabs] = useState<ChatTab[]>([
    { id: INITIAL_TAB_ID, type: 'chat', title: 'Untitled', sessionId: INITIAL_SESSION_ID }
  ]);
  const [activeTabId, setActiveTabId] = useState<string>(INITIAL_TAB_ID);
  const [availableAgents, setAvailableAgents] = useState<AgentOption[]>([]);
  const [tabUi, setTabUi] = useState<Record<string, TabUiFlags>>({});
  const pendingPermissionRef = useRef<Record<string, boolean>>({});

  // Refs for stable callbacks
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const tabUiRef = useRef(tabUi);
  tabUiRef.current = tabUi;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  const findTabIdBySessionId = useCallback((sessionId: string) => {
    return tabsRef.current.find(t => t.sessionId === sessionId)?.id;
  }, []);

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
  };

  // Initialize Bridge and load cached agents
  useEffect(() => {
    ACPBridge.initialize();

    try {
      const cached = localStorage.getItem('unified-llm.adapters');
      if (cached) {
        const parsed = JSON.parse(cached) as AgentOption[];
        if (Array.isArray(parsed)) {
          setAvailableAgents(parsed.filter(a => a.downloaded && a.enabled));
        }
      }
    } catch (e) {
      console.warn('[App] Failed to load cached adapters:', e);
    }
  }, []);

  // Single global listener for adapter updates
  useEffect(() => {
    return ACPBridge.onAdapters((e) => {
      const safeAdapters = Array.isArray(e.detail.adapters) ? e.detail.adapters : [];
      setAvailableAgents(safeAdapters.filter(a => a.downloaded && a.enabled));
      if (safeAdapters.length > 0) {
        try {
          localStorage.setItem('unified-llm.adapters', JSON.stringify(safeAdapters));
        } catch (e) {
          console.warn('[App] Failed to cache adapters:', e);
        }
      }
    });
  }, []);

  const handleNewTab = useCallback((agentId?: string) => {
    const newId = nextId('tab');
    const newSessionId = nextId('ses');
    const title = 'Untitled';
    setTabs((prev) => [...prev, { id: newId, type: 'chat', title, sessionId: newSessionId, agentId }]);
    initTabUi(newId);
    setActiveTabId(newId);
  }, []);

  /** Open a singleton tab of the given type (management/design/history). If already open, just switch to it. */
  const openSingletonTab = useCallback((type: TabType, title: string) => {
    const existing = tabsRef.current.find(t => t.type === type);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    const newId = nextId('tab');
    const newSessionId = nextId('ses');
    setTabs(prev => [...prev, { id: newId, type, title, sessionId: newSessionId }]);
    setActiveTabId(newId);
  }, []);

  const handleCloseTab = (id: string) => {
    const closingTab = tabs.find(t => t.id === id);
    if (closingTab?.type === 'chat' && typeof window.__stopAgent === 'function') {
      try {
        window.__stopAgent(closingTab.sessionId);
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
          try { window.__stopAgent?.(tab.sessionId); } catch (e) {}
        }
      });
    }
    setTabs([]);
    setTabUi({});
    pendingPermissionRef.current = {};
    setActiveTabId('');
  };

  const handleOpenHistory = (item: HistorySessionMeta) => {
    const newId = nextId('tab');
    const newSessionId = nextId('ses');
    const title = item.title || 'Untitled';

    // Close the history tab
    const historyTab = tabsRef.current.find(t => t.type === 'history');
    if (historyTab) {
      setTabs(prev => prev.filter(t => t.id !== historyTab.id));
    }

    // Open the history session as a new chat tab
    setTabs((prev) => [
      ...prev.filter(t => t.type !== 'history'),
      {
        id: newId,
        type: 'chat',
        title,
        sessionId: newSessionId,
        agentId: item.adapterName,
        historySession: item
      }
    ]);
    initTabUi(newId);
    setActiveTabId(newId);
  };

  const handleAssistantActivity = useCallback((sessionId: string) => {
    const tabId = findTabIdBySessionId(sessionId);
    if (!tabId) return;
    if (pendingPermissionRef.current[tabId] || tabUiRef.current[tabId]?.warning) {
      setTabUi(prev => prev[tabId]?.unread ? { ...prev, [tabId]: { ...prev[tabId], unread: false } } : prev);
      return;
    }
    if (canUserSeeResponse(tabId)) {
      setTabUi(prev => prev[tabId]?.unread ? { ...prev, [tabId]: { ...prev[tabId], unread: false } } : prev);
      return;
    }
    setTabUi(prev => ({ ...prev, [tabId]: { ...prev[tabId], unread: true } }));
  }, [findTabIdBySessionId, canUserSeeResponse]);

  const handleAtBottomChange = useCallback((sessionId: string, isAtBottom: boolean) => {
    const tabId = findTabIdBySessionId(sessionId);
    if (!tabId) return;
    setTabUi(prev => ({ ...prev, [tabId]: { ...prev[tabId], atBottom: isAtBottom } }));
    if (isAtBottom && canUserSeeResponse(tabId)) {
      setTabUi(prev => prev[tabId]?.unread ? { ...prev, [tabId]: { ...prev[tabId], unread: false } } : prev);
    }
  }, [findTabIdBySessionId, canUserSeeResponse]);

  const handlePermissionRequestChange = useCallback((sessionId: string, hasPendingPermission: boolean) => {
    const tabId = findTabIdBySessionId(sessionId);
    if (!tabId) return;
    pendingPermissionRef.current[tabId] = hasPendingPermission;
    setTabUi(prev => {
      const current = prev[tabId];
      if (!current) return prev;
      const needsUpdate = current.unread || current.warning !== hasPendingPermission;
      if (!needsUpdate) return prev;
      return { ...prev, [tabId]: { ...current, unread: false, warning: hasPendingPermission } };
    });
  }, [findTabIdBySessionId]);

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
      />

      <div className="flex-1 relative min-h-0">
        {/* All tabs — keep mounted for state preservation, toggle visibility */}
        {tabs.map((tab) => {
          const isTabActive = tab.id === activeTabId;
          const isVisible = isTabActive;

          return (
            <div
              key={tab.id}
              className={`absolute inset-0 w-full h-full bg-background ${isVisible ? 'z-10 visible' : 'z-0 invisible'}`}
            >
              {tab.type === 'chat' && (
                <ChatSessionView
                  initialAgentId={tab.agentId}
                  chatId={tab.sessionId}
                  historySession={tab.historySession}
                  availableAgents={availableAgents}
                  isActive={isTabActive}
                  onAssistantActivity={handleAssistantActivity}
                  onAtBottomChange={handleAtBottomChange}
                  onPermissionRequestChange={handlePermissionRequestChange}
                  onAgentChangeRequest={(agentId) => handleNewTab(agentId)}
                />
              )}
              {tab.type === 'management' && <AgentManagementView />}
              {tab.type === 'design' && <DesignSystemView />}
              {tab.type === 'history' && (
                <HistoryPanel availableAgents={availableAgents} onOpenSession={handleOpenHistory} />
              )}
            </div>
          );
        })}

        {/* Empty state */}
        {tabs.length === 0 && (
          <div className="absolute inset-0 w-full h-full z-10 bg-background flex items-center justify-center">
            <div className="flex flex-col items-center gap-4 max-w-[620px] px-6 text-center">
              {availableAgents.length === 0 ? (
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
                  {availableAgents.map((agent) => (
                    <button
                      key={agent.id}
                      onClick={() => handleNewTab(agent.id)}
                      className="px-3 py-1.5 rounded-md border border-border bg-background-secondary hover:bg-accent hover:text-accent-foreground transition-colors text-xs flex items-center gap-2"
                    >
                      {agent.iconPath && <img src={agent.iconPath} className="w-3.5 h-3.5" alt="" />}
                      <span>{agent.displayName}</span>
                    </button>
                  ))}
                </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
