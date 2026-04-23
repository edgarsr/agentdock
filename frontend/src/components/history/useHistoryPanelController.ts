import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { ACPBridge } from '../../utils/bridge';
import type { AgentOption, HistorySessionMeta } from '../../types/chat';

function getItemAgents(item: HistorySessionMeta): string[] {
  return item.allAdapterNames && item.allAdapterNames.length > 0
    ? item.allAdapterNames
    : [item.adapterName];
}

function formatDate(ms: number) {
  const d = new Date(ms);
  const now = new Date();
  const isToday = d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear();

  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const timeStr = `${hours}:${minutes}`;

  if (isToday) return `Today ${timeStr}`;
  if (isYesterday) return `Yesterday ${timeStr}`;
  
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year} ${timeStr}`;
}

function formatConversationLength(promptCount?: number) {
  if (promptCount == null || promptCount <= 0) return null;
  return `${promptCount} prompt${promptCount === 1 ? '' : 's'}`;
}

export function useHistoryPanelController(availableAgents: AgentOption[]) {
  const [historyList, setHistoryList] = useState<HistorySessionMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedConversationIds, setSelectedConversationIds] = useState<string[]>([]);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [deleteProjectPath, setDeleteProjectPath] = useState<string>('');
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});
  const filterButtonRef = useRef<HTMLButtonElement | null>(null);
  const filterOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const unsubHistory = ACPBridge.onHistoryList((e) => {
      const list = Array.isArray(e.detail.list) ? e.detail.list : [];
      setHistoryList(list);
      setSelectedConversationIds((prev) => prev.filter((id) => list.some((item) => item.conversationId === id)));
      setDeleteErrors((prev) => Object.fromEntries(
        Object.entries(prev).filter(([conversationId]) => list.some((item) => item.conversationId === conversationId))
      ));
      setIsLoading(false);
    });

    const unsubDeleteResult = ACPBridge.onHistoryDeleteResult((e) => {
      const result = e.detail.result;
      const failures = Array.isArray(result.failures) ? result.failures : [];
      setDeleteErrors((prev) => {
        const next = { ...prev };
        (result.requestedConversationIds || []).forEach((conversationId) => {
          delete next[conversationId];
        });
        failures.forEach((failure) => {
          if (failure?.conversationId && failure?.message) {
            next[failure.conversationId] = failure.message;
          }
        });
        return next;
      });
      setIsDeleting(false);
    });

    ACPBridge.requestHistoryList();
    const intervalId = window.setInterval(() => {
      ACPBridge.requestHistoryList();
    }, 30_000);

    return () => {
      window.clearInterval(intervalId);
      unsubDeleteResult();
      unsubHistory();
    };
  }, []);

  const adapterDisplay = useMemo(() => {
    const map = new Map<string, AgentOption>();
    availableAgents.forEach((a) => map.set(a.id, a));
    return map;
  }, [availableAgents]);

  const uniqueAgentsInHistory = useMemo(() => {
    const agentIds = new Set<string>();
    historyList.forEach((item) => {
      getItemAgents(item).forEach((agentId) => agentIds.add(agentId));
    });
    return Array.from(agentIds);
  }, [historyList]);

  const filteredHistoryList = useMemo(() => {
    if (selectedAgents.length === 0) return historyList;
    return historyList.filter((item) => {
      return getItemAgents(item).some((a) => selectedAgents.includes(a));
    });
  }, [historyList, selectedAgents]);

  const selectedAgentLabel = useMemo(() => {
    if (selectedAgents.length !== 1) return '';
    const agent = adapterDisplay.get(selectedAgents[0]);
    return agent?.name || selectedAgents[0];
  }, [adapterDisplay, selectedAgents]);

  useEffect(() => {
    if (!isFilterOpen) return;
    const selectedIndex = uniqueAgentsInHistory.findIndex((agentId) => selectedAgents.includes(agentId));
    const targetIndex = selectedIndex >= 0 ? selectedIndex : 0;
    requestAnimationFrame(() => {
      filterOptionRefs.current[targetIndex]?.focus();
    });
  }, [isFilterOpen, selectedAgents, uniqueAgentsInHistory]);

  const selectedCount = selectedConversationIds.length;
  const filteredConversationIds = filteredHistoryList.map((item) => item.conversationId);
  const areAllFilteredSelected = filteredConversationIds.length > 0 &&
    filteredConversationIds.every((conversationId) => selectedConversationIds.includes(conversationId));

  const toggleSelection = (conversationId: string) => {
    setSelectedConversationIds((prev) =>
      prev.includes(conversationId) ? prev.filter((id) => id !== conversationId) : [...prev, conversationId]
    );
  };

  const confirmDelete = () => {
    if (pendingDeleteIds.length === 0 || !deleteProjectPath) return;
    const deleteIds = [...pendingDeleteIds];
    setIsDeleting(true);
    setDeleteErrors((prev) => {
      const next = { ...prev };
      deleteIds.forEach((conversationId) => {
        delete next[conversationId];
      });
      return next;
    });
    ACPBridge.deleteHistoryConversations(deleteProjectPath, deleteIds);
    setPendingDeleteIds([]);
    setDeleteProjectPath('');
    setSelectedConversationIds((prev) => prev.filter((id) => !deleteIds.includes(id)));
  };

  const refreshHistory = () => {
    setIsLoading(true);
    setDeleteErrors({});
    ACPBridge.syncHistoryList();
  };

  const toggleSelectAllFiltered = () => {
    if (filteredConversationIds.length === 0) return;
    setSelectedConversationIds((prev) => {
      if (areAllFilteredSelected) {
        return prev.filter((conversationId) => !filteredConversationIds.includes(conversationId));
      }

      const next = new Set(prev);
      filteredConversationIds.forEach((conversationId) => next.add(conversationId));
      return Array.from(next);
    });
  };

  const openDeleteConfirmation = (items: HistorySessionMeta[]) => {
    if (items.length === 0) return;
    setPendingDeleteIds(items.map((item) => item.conversationId));
    setDeleteProjectPath(items[0].projectPath);
  };

  const startEditing = (item: HistorySessionMeta, e: MouseEvent) => {
    e.stopPropagation();
    setEditingId(item.conversationId);
    setEditTitle(item.title);
  };

  const submitRename = (projectPath: string, conversationId: string) => {
    if (!editTitle.trim()) {
      setEditingId(null);
      return;
    }
    
    setHistoryList(prev => prev.map(item => 
      item.conversationId === conversationId ? { ...item, title: editTitle.trim() } : item
    ));
    
    ACPBridge.renameHistoryConversation(projectPath, conversationId, editTitle.trim());
    setEditingId(null);
  };

  const handleEditKeyDown = (e: KeyboardEvent<HTMLInputElement>, projectPath: string, conversationId: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      submitRename(projectPath, conversationId);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setEditingId(null);
    }
  };

  const closeFilter = (restoreFocus = false) => {
    setIsFilterOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => {
        filterButtonRef.current?.focus();
      });
    }
  };

  const handleFilterButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setIsFilterOpen(true);
  };

  const handleFilterOptionKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    agentId: string,
    index: number
  ) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeFilter(true);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setSelectedAgents([agentId]);
      closeFilter(true);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      filterOptionRefs.current[(index + 1) % uniqueAgentsInHistory.length]?.focus();
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      filterOptionRefs.current[(index - 1 + uniqueAgentsInHistory.length) % uniqueAgentsInHistory.length]?.focus();
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      filterOptionRefs.current[0]?.focus();
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      filterOptionRefs.current[uniqueAgentsInHistory.length - 1]?.focus();
    }
  };

  const cancelDelete = () => {
    setPendingDeleteIds([]);
    setDeleteProjectPath('');
  };

  return {
    historyList,
    isLoading,
    selectedConversationIds,
    pendingDeleteIds,
    selectedAgents,
    isFilterOpen,
    editingId,
    editTitle,
    isDeleting,
    deleteErrors,
    filterButtonRef,
    filterOptionRefs,
    adapterDisplay,
    uniqueAgentsInHistory,
    filteredHistoryList,
    selectedAgentLabel,
    selectedCount,
    filteredConversationIds,
    areAllFilteredSelected,
    formatDate,
    formatConversationLength,
    setSelectedAgents,
    setIsFilterOpen,
    setEditTitle,
    setEditingId,
    closeFilter,
    confirmDelete,
    refreshHistory,
    toggleSelectAllFiltered,
    openDeleteConfirmation,
    startEditing,
    submitRename,
    handleEditKeyDown,
    handleFilterButtonKeyDown,
    handleFilterOptionKeyDown,
    toggleSelection,
    cancelDelete,
  };
}
