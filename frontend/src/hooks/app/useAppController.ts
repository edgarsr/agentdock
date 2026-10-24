import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChatTab,
  HistorySessionMeta,
  Message,
  PendingHandoffContext,
  SectionType,
  conversationKeyOf,
  isAgentRunnable,
} from '../../types/chat';
import { ACPBridge } from '../../utils/bridge';
import { uiWorkspace } from '../../utils/uiWorkspace';
import { useAvailableAgents } from '../useAvailableAgents';
import { useHistoryConversationIndex } from '../useHistoryConversationIndex';
import { useHistoryList } from '../useHistoryList';
import { useHistoryTitleSync } from '../useHistoryTitleSync';
import { useAppTabUiState } from './useAppTabUiState';

let tabCounter = 0;

function nextId(prefix: string): string {
  return `${prefix}-${++tabCounter}-${Date.now()}`;
}

/** Chat continuing a history conversation; `closed` lists a pinned one without opening it. */
function historyChat(item: HistorySessionMeta, closed = false): ChatTab {
  return {
    id: nextId('tab'),
    title: item.title || 'New',
    conversationId: item.conversationId,
    agentId: item.adapterName,
    historySession: item,
    inheritedAdapterNames: item.allAdapterNames || [item.adapterName],
    closed,
  };
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
  /** Open chats and closed pinned ones, in the order of the chat list; the tab bar shows the open ones. */
  const [chats, setChats] = useState<ChatTab[]>([]);
  const tabs = useMemo(() => chats.filter((chat) => !chat.closed), [chats]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const [activeSection, setActiveSection] = useState<SectionType | null>(null);
  const [mountedSections, setMountedSections] = useState<SectionType[]>([]);
  const settingsSectionRef = useRef<SectionType>('management');
  const { availableAgents, adaptersResolved, lastStableNewTabAgentIdRef } = useAvailableAgents();
  const agentAvailabilityResolved = useMemo(
    () => adaptersResolved && availableAgents.every((agent) => agent.downloadedKnown === true),
    [adaptersResolved, availableAgents]
  );
  const { historyList, historyLoaded } = useHistoryList(agentAvailabilityResolved);
  const [tabSessionState, setTabSessionState] = useState<Record<string, TabSessionState>>({});
  const [pendingAgentSwitch, setPendingAgentSwitch] = useState<PendingAgentSwitch | null>(null);
  const [pendingCloseTabIds, setPendingCloseTabIds] = useState<string[] | null>(null);
  const [pendingHandoffsByTab, setPendingHandoffsByTab] = useState<Record<string, PendingHandoffContext>>({});
  const pendingConversationContinuationsRef = useRef<Record<string, PendingConversationContinuation>>({});
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);

  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const tabSessionStateRef = useRef(tabSessionState);
  tabSessionStateRef.current = tabSessionState;

  const activateChat = useCallback((id: string) => {
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
    handleCanMarkReadChange,
    handlePermissionRequestChange,
    handleProcessingChange,
    handleQueuedChange,
  } = useAppTabUiState(activeTabId, activeTabIdRef);

  // A reloaded page, or one taking the UI over, continues with the chats the previous page had.
  useEffect(() => {
    let active = true;
    uiWorkspace.load().then((workspace) => {
      if (!active) return;
      if (workspace) {
        setChats(workspace.chats.map((chat) => (chat.closed ? chat : { ...chat, restored: true })));
        workspace.chats.forEach((chat) => { if (!chat.closed) initTabUi(chat.id); });
        setActiveTabId(workspace.activeTabId || '');
        setPendingHandoffsByTab(workspace.pendingHandoffsByTab || {});
      }
      setWorkspaceLoaded(true);
    });
    return () => { active = false; };
  }, [initTabUi]);

  useEffect(() => {
    if (workspaceLoaded) uiWorkspace.setApp({ chats, activeTabId, pendingHandoffsByTab });
  }, [workspaceLoaded, chats, activeTabId, pendingHandoffsByTab]);

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

  useHistoryTitleSync(setChats, historyList);
  const historyConversationIndex = useHistoryConversationIndex(historyList);

  /**
   * Removes the given tabs, pinned ones staying listed as closed; if the active one is among them, its left open
   * neighbour becomes active.
   */
  const removeTabs = useCallback((closingTabs: ChatTab[]) => {
    const closingIds = new Set(closingTabs.map((tab) => tab.id));
    const currentTabs = chatsRef.current.filter((chat) => !chat.closed);
    const remainingTabs = currentTabs.filter((tab) => !closingIds.has(tab.id));
    closingTabs.forEach((tab) => cleanupTabUi(tab.id));
    setChats(chatsRef.current.flatMap((chat) => {
      if (!closingIds.has(chat.id)) return [chat];
      const item = historyConversationIndex.get(conversationKeyOf(chat));
      return item?.pinned ? [historyChat(item, true)] : [];
    }));
    if (closingIds.has(activeTabIdRef.current)) {
      const activeIndex = currentTabs.findIndex((tab) => tab.id === activeTabIdRef.current);
      setActiveTabId((remainingTabs[Math.max(0, activeIndex - 1)] ?? remainingTabs[0])?.id ?? '');
    }
  }, [cleanupTabUi, historyConversationIndex]);

  // Newly pinned conversations (on the first history load all pinned ones, by date) move to the top, unpinned open
  // ones move after the last pinned chat, and closed ones no longer pinned (or deleted) are dropped.
  const pinnedIdsRef = useRef(new Set<string>());
  useEffect(() => {
    const previous = pinnedIdsRef.current;
    const pinnedItems = historyList.filter((item) => item.pinned);
    const pinned = new Set(pinnedItems.map((item) => item.conversationId));
    pinnedIdsRef.current = pinned;
    setChats((prev) => {
      const isPinned = (chat: ChatTab) => pinned.has(conversationKeyOf(chat));
      const top = pinnedItems.filter((item) => !previous.has(item.conversationId)).map((item) => (
        prev.find((chat) => conversationKeyOf(chat) === item.conversationId) ?? historyChat(item, true)
      ));
      const unpinned = prev.filter((chat) => !chat.closed && !isPinned(chat) && previous.has(conversationKeyOf(chat)));
      const next = [...top, ...prev.filter((chat) => (
        !top.includes(chat) && !unpinned.includes(chat) && (!chat.closed || isPinned(chat))
      ))];
      const lastPinnedIndex = next.reduce((last, chat, index) => (isPinned(chat) ? index : last), -1);
      next.splice(lastPinnedIndex + 1, 0, ...unpinned);
      return next.length === prev.length && next.every((chat, index) => chat === prev[index]) ? prev : next;
    });
  }, [historyList]);

  const handleRenameTab = useCallback((tabId: string, newTitle: string) => {
    const title = newTitle.trim();
    if (!title) return;
    const tab = chatsRef.current.find((item) => item.id === tabId);
    if (!tab) return;

    const conversationId = conversationKeyOf(tab);
    const projectPath = historyConversationIndex.get(conversationId)?.projectPath;
    if (projectPath) {
      setChats((prev) => prev.map((item) => (
        item.id === tabId ? { ...item, title } : item
      )));
      ACPBridge.updateHistoryConversations(projectPath, [conversationId], { newTitle: title });
      return;
    }

    // Not registered in the history index yet, so the conversation has no prompt. The title
    // lives on the tab until then: metadataTitleOverride makes the first registration use it.
    setChats((prev) => prev.map((item) => (
      item.id === tabId ? { ...item, title, metadataTitleOverride: title, pendingTitle: title } : item
    )));
  }, [historyConversationIndex]);

  // Registration only forces the title once; renaming marks it user-set, so it also survives sync.
  useEffect(() => {
    const flushedTabIds = new Set<string>();
    chatsRef.current.forEach((tab) => {
      if (!tab.pendingTitle) return;
      const conversationId = conversationKeyOf(tab);
      const projectPath = historyConversationIndex.get(conversationId)?.projectPath;
      if (!projectPath) return;
      ACPBridge.updateHistoryConversations(projectPath, [conversationId], { newTitle: tab.pendingTitle });
      flushedTabIds.add(tab.id);
    });
    if (flushedTabIds.size === 0) return;
    setChats((prev) => prev.map((tab) => (
      flushedTabIds.has(tab.id) ? { ...tab, pendingTitle: undefined } : tab
    )));
  }, [historyConversationIndex]);

  useEffect(() => {
    return ACPBridge.onHistoryDeleteRequest((e) => {
      // The backend stops the deleted conversations itself.
      const deletedIds = new Set(e.detail.conversationIds);
      const toClose = chatsRef.current.filter((tab) => deletedIds.has(conversationKeyOf(tab)));
      if (toClose.length > 0) removeTabs(toClose);
    });
  }, [removeTabs]);

  const runnableAgents = useMemo(() => availableAgents.filter(isAgentRunnable), [availableAgents]);
  const pendingAgentName = pendingAgentSwitch
    ? (availableAgents.find((agent) => agent.id === pendingAgentSwitch.targetAgentId)?.name || pendingAgentSwitch.targetAgentId)
    : 'the selected agent';

  const defaultNewTabAgentId = lastStableNewTabAgentIdRef.current
    || runnableAgents.find(agent => agent.isLastUsed)?.id
    || runnableAgents[0]?.id;

  const handleNewTab = useCallback((agentId?: string) => {
    const resolvedAgentId = runnableAgents.some(agent => agent.id === agentId)
      ? agentId
      : defaultNewTabAgentId;
    if (!resolvedAgentId) {
      return;
    }
    const newId = nextId('tab');
    const newConversationId = nextId('conv');
    const title = 'New';
    setChats((prev) => [...prev, { id: newId, title, conversationId: newConversationId, agentId: resolvedAgentId }]);
    initTabUi(newId);
    activateChat(newId);
  }, [activateChat, defaultNewTabAgentId, initTabUi, runnableAgents]);

  const handleChatSessionStateChange = useCallback((tabId: string, state: TabSessionState) => {
    setTabSessionState(prev => {
      const current = prev[tabId];
      if (current?.acpSessionId === state.acpSessionId && current?.adapterName === state.adapterName) {
        return prev;
      }
      return { ...prev, [tabId]: state };
    });
    setChats(prev => prev.map(tab => {
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

    const tab = chatsRef.current.find(item => item.id === tabId);
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
    const tab = chatsRef.current.find(item => item.id === tabId);
    if (!tab) return;

    const currentSession = tabSessionState[tabId];
    const hasConversationToContinue = Boolean(currentSession?.acpSessionId && payload.handoffText.trim());
    if (!hasConversationToContinue) {
      setChats(prev => prev.map(item => (
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

    const closingTab = chatsRef.current.find(item => item.id === pendingAgentSwitch.tabId);
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

    setChats(prev => {
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

    setChats(prev => prev.map(tab => (
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
    const sourceTab = chatsRef.current.find(item => item.id === tabId);
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

    setChats(prev => [
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
    if (type !== 'history' && type !== 'archive') settingsSectionRef.current = type;
    setMountedSections((current) => current.includes(type) ? current : [...current, type]);
    setActiveSection(type);
  }, []);

  // "Settings" reopens the last section opened other than the history.
  const openSettings = useCallback(() => openSection(settingsSectionRef.current), [openSection]);

  const closeActiveSection = useCallback(() => setActiveSection(null), []);

  const closeTabs = useCallback((ids: string[]) => {
    const closingTabs = chatsRef.current.filter((tab) => ids.includes(tab.id));
    closingTabs.forEach((tab) => {
      try {
        window.__stopAgent?.(tab.conversationId);
      } catch (e) {
        console.warn('[App] Failed to stop agent:', e);
      }
    });
    removeTabs(closingTabs);
  }, [removeTabs]);

  const requestCloseTabs = useCallback((ids: string[]) => {
    if (ids.some((id) => tabUi[id]?.processing || tabUi[id]?.queued)) {
      setPendingCloseTabIds(ids);
    } else {
      closeTabs(ids);
    }
  }, [closeTabs, tabUi]);

  const handleCloseTab = useCallback((id: string) => requestCloseTabs([id]), [requestCloseTabs]);

  const handleConfirmCloseTabs = () => {
    if (pendingCloseTabIds) closeTabs(pendingCloseTabIds);
    setPendingCloseTabIds(null);
  };

  const tabUsesAdapter = useCallback((tab: ChatTab, adapterId: string) => (
    !tab.closed && (tabSessionStateRef.current[tab.id]?.adapterName || tab.agentId) === adapterId
  ), []);

  const hasOpenConversationsForAdapter = (adapterId: string) =>
    tabs.some((tab) => tabUsesAdapter(tab, adapterId));

  /** Stops and closes the open chats of the adapter. */
  const closeAdapterTabs = useCallback((adapterId: string) => {
    closeTabs(chatsRef.current.filter((tab) => tabUsesAdapter(tab, adapterId)).map((tab) => tab.id));
  }, [closeTabs, tabUsesAdapter]);

  useEffect(() => ACPBridge.onAdapterDeleted((e) => closeAdapterTabs(e.detail.adapterId)), [closeAdapterTabs]);

  const handleUpdateAgent = (adapterId: string) => {
    if (typeof window.__updateAgent !== 'function') return;
    closeAdapterTabs(adapterId);
    window.__updateAgent(adapterId);
  };

  const handleReorderTabs = useCallback((draggedId: string, targetId: string, position: 'before' | 'after') => {
    if (draggedId === targetId) {
      return;
    }

    setChats((prev) => {
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
    requestCloseTabs(tabs.map((tab) => tab.id));
  }, [requestCloseTabs, tabs]);

  /** Opens a history conversation; a closed pinned chat opens in its place in the list. */
  const handleOpenHistory = useCallback((item: HistorySessionMeta) => {
    const conversationKey = item.conversationId;
    const existing = chatsRef.current.find((tab) => {
      if (tab.conversationId === conversationKey) return true;
      return tab.historySession?.conversationId === conversationKey;
    });
    if (existing && !existing.closed) {
      activateChat(existing.id);
      return;
    }

    const historyTab = historyChat(item);
    setChats((prev) => (existing
      ? prev.map((chat) => (chat.id === existing.id ? historyTab : chat))
      : [...prev, historyTab]));
    initTabUi(historyTab.id);
    activateChat(historyTab.id);
  }, [activateChat, initTabUi]);

  const handleSelectTab = useCallback((id: string) => {
    const chat = chatsRef.current.find((item) => item.id === id);
    const closedItem = chat?.closed ? historyConversationIndex.get(conversationKeyOf(chat)) : undefined;
    if (closedItem) {
      handleOpenHistory(closedItem);
      return;
    }
    activateChat(id);
    markTabReadIfAllowed(id);
  }, [activateChat, handleOpenHistory, historyConversationIndex, markTabReadIfAllowed]);

  const handleUserMessageSent = useCallback((tabId: string) => {
    clearTabUnread(tabId);
  }, [clearTabUnread]);

  return {
    workspaceLoaded,
    chats,
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
    pendingCloseTabIds,
    handleConfirmCloseTabs,
    handleCancelCloseTabs: () => setPendingCloseTabIds(null),
    pendingAgentName,
    pendingHandoffsByTab,
    handleSelectTab,
    /** Shows the start page; the open chats stay open. */
    handleShowHome: () => activateChat(''),
    handleReorderTabs,
    handleCloseTab,
    handleCloseAllChats,
    hasOpenConversationsForAdapter,
    handleUpdateAgent,
    defaultNewTabAgentId,
    handleNewTab,
    handleOpenHistory,
    openSection,
    openSettings,
    closeActiveSection,
    handleUserMessageSent,
    handleAssistantActivity,
    handleCanMarkReadChange,
    handlePermissionRequestChange,
    handleProcessingChange,
    handleQueuedChange,
    requestAgentSwitch,
    handleHandoffConsumed,
    handleForkRequest,
    handleChatSessionStateChange,
    handleContinueInNewTab,
    handleContinueInCurrentConversation,
    handleCancelAgentSwitch: () => setPendingAgentSwitch(null),
  };
}
