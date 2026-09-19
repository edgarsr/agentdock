import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChatTab,
  HistorySessionMeta,
  Message,
  PendingHandoffContext,
  SectionType,
  isAgentRunnable,
} from '../../types/chat';
import { ACPBridge } from '../../utils/bridge';
import { useAvailableAgents } from '../useAvailableAgents';
import { useHistoryConversationIndex } from '../useHistoryConversationIndex';
import { useHistoryList } from '../useHistoryList';
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
  sourceConversationTitle: string;
}

interface PendingConversationContinuation {
  previousSessionId: string;
  previousAdapterName: string;
  targetAgentId: string;
}

function forkedTitle(sourceTitle?: string): string {
  const normalized = (sourceTitle || '').trim();
  if (!normalized || normalized === 'New') return 'Forked conversation';
  const title = normalized.startsWith('Forked:') ? normalized : `Forked: ${normalized}`;
  return title.length <= 80 ? title : `${title.slice(0, 77)}...`;
}

function normalizeAdapterNames(adapterNames: Array<string | undefined>): string[] {
  const result = new Map<string, string>();
  adapterNames.forEach((adapterName) => {
    const clean = (adapterName || '').trim();
    if (!clean) return;
    result.delete(clean);
    result.set(clean, clean);
  });
  return Array.from(result.values());
}

export function useAppController() {
  const [tabs, setTabs] = useState<ChatTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const [activeSection, setActiveSection] = useState<SectionType | null>(null);
  const [mountedSections, setMountedSections] = useState<SectionType[]>([]);
  const { availableAgents, adaptersResolved, lastStableNewTabAgentIdRef } = useAvailableAgents();
  const agentAvailabilityResolved = useMemo(
    () => adaptersResolved && availableAgents.every((agent) => agent.downloadedKnown === true),
    [adaptersResolved, availableAgents]
  );
  const { historyList, historyLoaded } = useHistoryList(agentAvailabilityResolved);
  const [tabSessionState, setTabSessionState] = useState<Record<string, TabSessionState>>({});
  const [pendingAgentSwitch, setPendingAgentSwitch] = useState<PendingAgentSwitch | null>(null);
  const [pendingHandoffsByTab, setPendingHandoffsByTab] = useState<Record<string, PendingHandoffContext>>({});
  const pendingConversationContinuationsRef = useRef<Record<string, PendingConversationContinuation>>({});

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const lastActiveChatIdRef = useRef('');

  const activateChat = useCallback((id: string) => {
    lastActiveChatIdRef.current = id;
    setActiveSection(null);
    setActiveTabId(id);
  }, []);

  const {
    tabUi,
    initTabUi,
    cleanupTabUiState,
    markTabReadIfAllowed,
    clearTabUnread,
    handleAssistantActivity,
    handleAtBottomChange,
    handleCanMarkReadChange,
    handlePermissionRequestChange,
    handleProcessingChange,
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

  useHistoryTitleSync(setTabs, historyList);
  const historyConversationIndex = useHistoryConversationIndex(historyList);

  const conversationKeyOf = (tab: ChatTab) => tab.historySession?.conversationId || tab.conversationId;

  const handleRenameTab = useCallback((tabId: string, newTitle: string) => {
    const title = newTitle.trim();
    if (!title) return;
    const tab = tabsRef.current.find((item) => item.id === tabId);
    if (!tab) return;

    const conversationId = conversationKeyOf(tab);
    const projectPath = historyConversationIndex.get(conversationId);
    if (projectPath) {
      ACPBridge.renameHistoryConversation(projectPath, conversationId, title);
      return;
    }

    // Not registered in the history index yet, so the conversation has no prompt. The title
    // lives on the tab until then: metadataTitleOverride makes the first registration use it.
    setTabs((prev) => prev.map((item) => (
      item.id === tabId ? { ...item, title, metadataTitleOverride: title, pendingTitle: title } : item
    )));
  }, [historyConversationIndex]);

  // Registration only forces the title once; renaming marks it user-set, so it also survives sync.
  useEffect(() => {
    const flushedTabIds = new Set<string>();
    tabsRef.current.forEach((tab) => {
      if (!tab.pendingTitle) return;
      const conversationId = conversationKeyOf(tab);
      const projectPath = historyConversationIndex.get(conversationId);
      if (!projectPath) return;
      ACPBridge.renameHistoryConversation(projectPath, conversationId, tab.pendingTitle);
      flushedTabIds.add(tab.id);
    });
    if (flushedTabIds.size === 0) return;
    setTabs((prev) => prev.map((tab) => (
      flushedTabIds.has(tab.id) ? { ...tab, pendingTitle: undefined } : tab
    )));
  }, [historyConversationIndex]);

  useEffect(() => {
    return ACPBridge.onHistoryDeleteRequest((e) => {
      const deletedIds = new Set(e.detail.conversationIds);
      if (deletedIds.size === 0) return;
      const currentTabs = tabsRef.current;
      const toClose = currentTabs.filter(tab => {
        const convId = tab.historySession?.conversationId ?? tab.conversationId;
        return deletedIds.has(convId);
      });
      if (toClose.length === 0) return;

      const closingTabIds = new Set(toClose.map(tab => tab.id));
      const remainingTabs = currentTabs.filter(tab => !closingTabIds.has(tab.id));
      toClose.forEach(tab => {
        cleanupTabUi(tab.id);
      });
      setTabs(remainingTabs);

      if (closingTabIds.has(lastActiveChatIdRef.current)) {
        lastActiveChatIdRef.current = remainingTabs[remainingTabs.length - 1]?.id ?? '';
      }
      if (closingTabIds.has(activeTabIdRef.current)) {
        const activeIndex = currentTabs.findIndex(tab => tab.id === activeTabIdRef.current);
        const fallbackTab = remainingTabs[Math.max(0, activeIndex - 1)] ?? remainingTabs[0];
        if (fallbackTab) {
          activateChat(fallbackTab.id);
        } else {
          setActiveTabId('');
        }
      }
    });
  }, [activateChat, cleanupTabUi]);

  useEffect(() => {
    return ACPBridge.onAdapterDeleted((e) => {
      const deletedId = e.detail.adapterId;
      setTabs(prev => {
        const toClose = prev.filter(tab => {
          const currentAdapter = tabSessionState[tab.id]?.adapterName;
          return currentAdapter ? currentAdapter === deletedId : tab.agentId === deletedId;
        });
        if (toClose.length === 0) return prev;
        toClose.forEach(tab => {
          try { window.__stopAgent?.(tab.conversationId); } catch (_) {}
          cleanupTabUi(tab.id);
        });
        return prev.filter(tab => !toClose.some(c => c.id === tab.id));
      });
    });
  }, [cleanupTabUi, tabSessionState]);

  const runnableAgents = useMemo(() => availableAgents.filter(isAgentRunnable), [availableAgents]);
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
    setTabs((prev) => [...prev, { id: newId, title, conversationId: newConversationId, agentId: resolvedAgentId }]);
    initTabUi(newId);
    activateChat(newId);
  }, [activateChat, initTabUi, lastStableNewTabAgentIdRef, runnableAgents]);

  const handleChatSessionStateChange = useCallback((tabId: string, state: TabSessionState) => {
    setTabSessionState(prev => {
      const current = prev[tabId];
      if (current?.acpSessionId === state.acpSessionId && current?.adapterName === state.adapterName) {
        return prev;
      }
      return { ...prev, [tabId]: state };
    });
    setTabs(prev => prev.map(tab => {
      if (tab.id !== tabId) return tab;
      if (!state.acpSessionId.trim() || !state.adapterName.trim()) return tab;
      const inherited = tab.historySession?.allAdapterNames || tab.inheritedAdapterNames || [];
      const inheritedAdapterNames = normalizeAdapterNames([
        ...inherited,
        state.adapterName,
      ]);
      return { ...tab, inheritedAdapterNames };
    }));

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
    if (!tab) return;

    const currentSession = tabSessionState[tabId];
    const hasConversationToContinue = Boolean(currentSession?.acpSessionId && payload.handoffText.trim());
    if (!hasConversationToContinue) {
      setTabs(prev => prev.map(item => (
        item.id === tabId
          ? { ...item, agentId: payload.agentId, historySession: undefined }
          : item
      )));
      activateChat(tabId);
      return;
    }

    setPendingAgentSwitch({
      tabId,
      targetAgentId: payload.agentId,
      handoffText: payload.handoffText,
      sourceConversationTitle: tab.title,
    });
  }, [activateChat, tabSessionState]);

  const handleContinueInNewTab = useCallback(() => {
    if (!pendingAgentSwitch) return;

    const closingTab = tabsRef.current.find(item => item.id === pendingAgentSwitch.tabId);
    if (closingTab && typeof window.__stopAgent === 'function') {
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
      return [...remaining, { id: newId, title, conversationId: newConversationId, agentId: resolvedAgentId }];
    });
    cleanupTabUi(pendingAgentSwitch.tabId);
    activateChat(newId);
    setPendingAgentSwitch(null);
  }, [activateChat, cleanupTabUi, pendingAgentSwitch, runnableAgents]);

  const handleContinueInCurrentConversation = useCallback(() => {
    if (!pendingAgentSwitch) return;

    const currentSession = tabSessionState[pendingAgentSwitch.tabId];
    if (currentSession?.acpSessionId && currentSession.adapterName) {
      const handoffContext: PendingHandoffContext = {
        id: nextId('handoff'),
        sourceSessionId: currentSession.acpSessionId,
        sourceAgentId: currentSession.adapterName,
        targetAgentId: pendingAgentSwitch.targetAgentId,
        sourceConversationTitle: pendingAgentSwitch.sourceConversationTitle,
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
    activateChat(pendingAgentSwitch.tabId);
    setPendingAgentSwitch(null);
  }, [activateChat, pendingAgentSwitch, tabSessionState]);

  const handleHandoffConsumed = useCallback((tabId: string, handoffId: string) => {
    setPendingHandoffsByTab(prev => {
      const current = prev[tabId];
      if (!current || current.id !== handoffId) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
  }, []);

  const handleForkRequest = useCallback((tabId: string, payload: { agentId: string; messages: Message[]; handoffText: string }) => {
    const sourceTab = tabsRef.current.find(item => item.id === tabId);
    if (!sourceTab) return;
    const resolvedAgentId = runnableAgents.some(agent => agent.id === payload.agentId)
      ? payload.agentId
      : runnableAgents[0]?.id;
    if (!resolvedAgentId) return;

    const newId = nextId('tab');
    const newConversationId = nextId('conv');
    const title = forkedTitle(sourceTab.title);
    const sourceSessionState = tabSessionState[tabId];
    const forkPromptCount = payload.messages.filter((message) => message.role === 'user').length;
    const inheritedAdapterNames = normalizeAdapterNames([
      ...(sourceTab.historySession?.allAdapterNames || []),
      ...(sourceTab.inheritedAdapterNames || []),
      sourceSessionState?.adapterName,
    ]);
    const handoffContext: PendingHandoffContext = {
      id: nextId('handoff'),
      sourceSessionId: sourceSessionState?.acpSessionId || '',
      sourceAgentId: sourceSessionState?.adapterName || sourceTab.agentId || '',
      targetAgentId: resolvedAgentId,
      sourceConversationTitle: sourceTab.title,
      text: payload.handoffText,
    };

    setTabs(prev => [
      ...prev,
      {
        id: newId,
        title,
        conversationId: newConversationId,
        agentId: resolvedAgentId,
        initialMessages: payload.messages,
        inheritedHandoffText: payload.handoffText,
        metadataTitleOverride: title,
        inheritedAdapterNames,
        forkBase: {
          sourceConversationId: sourceTab.historySession?.conversationId || sourceTab.conversationId,
          promptCount: forkPromptCount,
        },
      }
    ]);
    initTabUi(newId);
    setPendingHandoffsByTab(prev => ({
      ...prev,
      [newId]: handoffContext,
    }));
    activateChat(newId);
  }, [activateChat, initTabUi, runnableAgents, tabSessionState]);

  const openSection = useCallback((type: SectionType) => {
    setMountedSections((current) => current.includes(type) ? current : [...current, type]);
    setActiveSection(type);
    setActiveTabId('');
  }, []);

  const closeActiveSection = useCallback(() => {
    setActiveSection(null);
    const lastActiveChat = tabsRef.current.find((tab) => tab.id === lastActiveChatIdRef.current);
    const fallbackChat = lastActiveChat ?? tabsRef.current[tabsRef.current.length - 1];
    if (fallbackChat) {
      activateChat(fallbackChat.id);
    } else {
      setActiveTabId('');
    }
  }, [activateChat]);

  const handleCloseTab = useCallback((id: string) => {
    const closingTab = tabs.find(t => t.id === id);
    if (closingTab && typeof window.__stopAgent === 'function') {
      try {
        window.__stopAgent(closingTab.conversationId);
      } catch (e) {
        console.warn('[App] Failed to stop agent:', e);
      }
    }

    const newTabs = tabs.filter((t) => t.id !== id);
    cleanupTabUi(id);

    setTabs(newTabs);
    if (lastActiveChatIdRef.current === id) {
      lastActiveChatIdRef.current = newTabs[newTabs.length - 1]?.id ?? '';
    }

    if (activeTabId === id) {
      const currentIndex = tabs.findIndex(t => t.id === id);
      if (currentIndex > 0) {
        activateChat(tabs[currentIndex - 1].id);
      } else if (tabs.length > 1) {
        activateChat(tabs[currentIndex + 1].id);
      } else {
        setActiveTabId('');
      }
    }
  }, [activateChat, activeTabId, cleanupTabUi, tabs]);

  const tabUsesAdapter = (tab: ChatTab, adapterId: string) =>
    (tabSessionState[tab.id]?.adapterName || tab.agentId) === adapterId;

  const hasOpenConversationsForAdapter = (adapterId: string) =>
    tabs.some((tab) => tabUsesAdapter(tab, adapterId));

  const handleUpdateAgent = (adapterId: string) => {
    if (typeof window.__updateAgent !== 'function') return;

    const currentTabs = tabsRef.current;
    currentTabs.filter((tab) => tabUsesAdapter(tab, adapterId)).forEach((tab) => {
      try { window.__stopAgent?.(tab.conversationId); } catch (_) {}
      cleanupTabUi(tab.id);
    });
    setTabs(currentTabs.filter((tab) => !tabUsesAdapter(tab, adapterId)));

    window.__updateAgent(adapterId);
  };

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

  const handleCloseAllChats = useCallback(() => {
    tabs.forEach((tab) => {
      try { window.__stopAgent?.(tab.conversationId); } catch (_) {}
      cleanupTabUi(tab.id);
    });
    setTabs([]);
    lastActiveChatIdRef.current = '';
    setActiveTabId('');
  }, [cleanupTabUi, tabs]);

  const handleOpenHistory = useCallback((item: HistorySessionMeta, placeFirst = false) => {
    const conversationKey = item.conversationId;
    const existing = tabsRef.current.find((tab) => {
      if (tab.conversationId === conversationKey) return true;
      return tab.historySession?.conversationId === conversationKey;
    });
    if (existing) {
      activateChat(existing.id);
      return;
    }

    const newId = nextId('tab');
    const title = item.title || 'New';

    const historyTab: ChatTab = {
      id: newId,
      title,
      conversationId: conversationKey,
      agentId: item.adapterName,
      historySession: item,
      inheritedAdapterNames: item.allAdapterNames || [item.adapterName]
    };
    setTabs((prev) => placeFirst ? [historyTab, ...prev] : [...prev, historyTab]);
    initTabUi(newId);
    activateChat(newId);
  }, [activateChat, initTabUi]);

  const handleSelectTab = useCallback((id: string) => {
    activateChat(id);
    markTabReadIfAllowed(id);
  }, [activateChat, markTabReadIfAllowed]);

  const handleUserMessageSent = useCallback((tabId: string) => {
    clearTabUnread(tabId);
  }, [clearTabUnread]);

  return {
    tabs,
    activeTabId,
    activeSection,
    mountedSections,
    tabUi,
    handleRenameTab,
    availableAgents,
    runnableAgents,
    agentAvailabilityResolved,
    historyList,
    historyLoaded,
    pendingAgentSwitch,
    pendingAgentName,
    pendingHandoffsByTab,
    handleSelectTab,
    handleReorderTabs,
    handleCloseTab,
    handleCloseAllChats,
    hasOpenConversationsForAdapter,
    handleUpdateAgent,
    handleNewTab,
    handleOpenHistory,
    openSection,
    closeActiveSection,
    handleUserMessageSent,
    handleAssistantActivity,
    handleAtBottomChange,
    handleCanMarkReadChange,
    handlePermissionRequestChange,
    handleProcessingChange,
    requestAgentSwitch,
    handleHandoffConsumed,
    handleForkRequest,
    handleChatSessionStateChange,
    handleContinueInNewTab,
    handleContinueInCurrentConversation,
    handleCancelAgentSwitch: () => setPendingAgentSwitch(null),
  };
}
