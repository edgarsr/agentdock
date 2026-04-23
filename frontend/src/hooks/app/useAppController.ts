import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ChatTab,
  HistorySessionMeta,
  PendingHandoffContext,
  TabType,
  isAgentRunnable,
} from '../../types/chat';
import { ACPBridge } from '../../utils/bridge';
import { useAvailableAgents } from '../useAvailableAgents';
import { useHistoryTitleSync } from '../useHistoryTitleSync';
import { useAppTabUiState } from './useAppTabUiState';

let tabCounter = 0;

function nextId(prefix: string): string {
  return `${prefix}-${++tabCounter}-${Date.now()}`;
}

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

export function useAppController() {
  const [tabs, setTabs] = useState<ChatTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const { availableAgents, adaptersResolved, lastStableNewTabAgentIdRef } = useAvailableAgents();
  const [tabSessionState, setTabSessionState] = useState<Record<string, TabSessionState>>({});
  const [pendingAgentSwitch, setPendingAgentSwitch] = useState<PendingAgentSwitch | null>(null);
  const [pendingHandoffsByTab, setPendingHandoffsByTab] = useState<Record<string, PendingHandoffContext>>({});
  const pendingConversationContinuationsRef = useRef<Record<string, PendingConversationContinuation>>({});

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  const {
    tabUi,
    initTabUi,
    cleanupTabUiState,
    resetTabUiState,
    markTabReadIfAllowed,
    handleAssistantActivity,
    handleAtBottomChange,
    handleCanMarkReadChange,
    handlePermissionRequestChange,
  } = useAppTabUiState(activeTabId, activeTabIdRef);

  const cleanupTabUi = useCallback((id: string) => {
    cleanupTabUiState(id);
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
  }, [cleanupTabUiState]);

  useHistoryTitleSync(setTabs);

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
  }, [initTabUi, lastStableNewTabAgentIdRef, runnableAgents]);

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
  }, [cleanupTabUi, pendingAgentSwitch, runnableAgents]);

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

  const handleCloseTab = useCallback((id: string) => {
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
  }, [activeTabId, cleanupTabUi, tabs]);

  const handleReorderTabs = useCallback((draggedId: string, targetId: string, position: 'before' | 'after') => {
    if (draggedId === targetId) {
      return;
    }

    setTabs((prev) => {
      const draggedTab = prev.find((tab) => tab.id === draggedId);
      if (!draggedTab || !prev.some((tab) => tab.id === targetId)) {
        return prev;
      }

      const withoutDragged = prev.filter((tab) => tab.id !== draggedId);
      const targetIndex = withoutDragged.findIndex((tab) => tab.id === targetId);
      if (targetIndex === -1) {
        return prev;
      }

      const insertIndex = position === 'before' ? targetIndex : targetIndex + 1;
      const next = [...withoutDragged];
      next.splice(insertIndex, 0, draggedTab);
      return next;
    });
  }, []);

  const handleCloseAllTabs = useCallback(() => {
    if (typeof window.__stopAgent === 'function') {
      tabs.forEach((tab) => {
        if (tab.type === 'chat') {
          try { window.__stopAgent?.(tab.conversationId); } catch (e) {}
        }
      });
    }
    setTabs([]);
    resetTabUiState();
    setActiveTabId('');
  }, [resetTabUiState, tabs]);

  const handleOpenHistory = useCallback((item: HistorySessionMeta) => {
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
  }, [initTabUi]);

  const handleSelectTab = useCallback((id: string) => {
    setActiveTabId(id);
    markTabReadIfAllowed(id);
  }, [markTabReadIfAllowed]);

  return {
    tabs,
    activeTabId,
    tabUi,
    availableAgents,
    runnableAgents,
    agentAvailabilityResolved,
    pendingAgentSwitch,
    pendingAgentName,
    pendingHandoffsByTab,
    handleSelectTab,
    handleReorderTabs,
    handleCloseTab,
    handleCloseAllTabs,
    handleNewTab,
    handleOpenHistory,
    openSingletonTab,
    handleAssistantActivity,
    handleAtBottomChange,
    handleCanMarkReadChange,
    handlePermissionRequestChange,
    requestAgentSwitch,
    handleHandoffConsumed,
    handleChatSessionStateChange,
    handleContinueInNewTab,
    handleContinueInCurrentConversation,
    handleCancelAgentSwitch: () => setPendingAgentSwitch(null),
  };
}
