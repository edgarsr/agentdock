import { useEffect, useMemo, useRef, useState } from 'react';
import { ACPBridge } from '../utils/bridge';
import type { AgentOption, HistorySessionMeta } from '../types/chat';
import ConfirmationModal from './ConfirmationModal';
import { RefreshCw, Trash2, Funnel, Pencil, Check, X, Terminal } from 'lucide-react';
import { Button } from './ui/Button';
import { Checkbox } from './ui/Checkbox';
import { Tooltip } from './chat/shared/Tooltip';

interface HistoryPanelProps {
  availableAgents: AgentOption[];
  onOpenSession: (session: HistorySessionMeta) => void;
}

function getItemAgents(item: HistorySessionMeta): string[] {
  return item.allAdapterNames && item.allAdapterNames.length > 0
    ? item.allAdapterNames
    : [item.adapterName];
}

function handleHistoryRowKeyDown(
  event: React.KeyboardEvent<HTMLDivElement>,
  disabled: boolean,
  onActivate: () => void
) {
  if (disabled || (event.key !== 'Enter' && event.key !== ' ')) return;
  event.preventDefault();
  event.stopPropagation();
  onActivate();
}

export default function HistoryPanel({ availableAgents, onOpenSession }: HistoryPanelProps) {
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
      setIsDeleting(false);
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

  const formatDate = (ms: number) => {
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
  };

  const formatConversationLength = (promptCount?: number) => {
    if (promptCount == null || promptCount <= 0) return null;
    return `${promptCount} prompt${promptCount === 1 ? '' : 's'}`;
  };

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

  const startEditing = (item: HistorySessionMeta, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(item.conversationId);
    setEditTitle(item.title);
  };

  const submitRename = (projectPath: string, conversationId: string) => {
    if (!editTitle.trim()) {
      setEditingId(null);
      return;
    }
    
    // Optimistic update
    setHistoryList(prev => prev.map(item => 
      item.conversationId === conversationId ? { ...item, title: editTitle.trim() } : item
    ));
    
    ACPBridge.renameHistoryConversation(projectPath, conversationId, editTitle.trim());
    setEditingId(null);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent, projectPath: string, conversationId: string) => {
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

  const handleFilterButtonKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setIsFilterOpen(true);
  };

  const handleFilterOptionKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
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

  return (
    <div className="flex flex-col h-full bg-background text-foreground z-10 w-full overflow-hidden relative pb-4">
      <div className="flex items-center justify-between min-h-12 px-3 py-1 border-b border-border shrink-0 relative z-20">
        <div className="flex items-center gap-2">
          <Tooltip variant="minimal" content="Synchronize history">
            <button
              onClick={refreshHistory}
              disabled={isLoading}
              className={`rounded-[4px] p-1 text-foreground-secondary transition-colors hover:text-foreground focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] focus-visible:outline-none ${isLoading ? 'animate-spin' : ''}`}
              aria-label="Refresh history"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </Tooltip>

          <div className="relative flex items-center gap-1.5">
            <Tooltip variant="minimal" content="Filter by AI agent">
              <button
                type="button"
                ref={filterButtonRef}
                onClick={() => setIsFilterOpen(!isFilterOpen)}
                onKeyDown={handleFilterButtonKeyDown}
                aria-label="Filter by AI agent"
                className={`rounded-[4px] p-1 text-foreground-secondary transition-colors focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] focus-visible:outline-none ${
                  isFilterOpen || selectedAgents.length > 0
                    ? 'text-foreground'
                    : 'text-foreground-secondary hover:text-foreground'
                }`}
              >
                <Funnel className="h-4 w-4" />
              </button>
            </Tooltip>

            {selectedAgents.length > 0 ? (
              <div className="flex items-center gap-1 mt-[1px]">
                <span className="max-w-[140px] truncate text-ide-small text-foreground">
                  {selectedAgentLabel}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedAgents([]);
                    closeFilter();
                  }}
                  className="rounded-[4px] mt-[-1px] p-0.5 text-foreground-secondary hover:text-foreground focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] focus-visible:outline-none"
                  aria-label="Clear agent filter"
                >
                  <X size={12} />
                </button>
              </div>
            ) : null}
            
            {isFilterOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => closeFilter()} />
                <div
                  role="listbox"
                  aria-label="Filter by AI agent"
                  className="absolute top-full left-0 mt-1 z-50 min-w-max overflow-hidden rounded-[7px] border border-border bg-background p-1"
                >
                  {uniqueAgentsInHistory.map((agentId, index) => {
                    const agent = adapterDisplay.get(agentId);
                    const label = agent?.name || agentId;
                    const isSelected = selectedAgents.includes(agentId);
                    return (
                      <button 
                        key={agentId}
                        ref={(element) => {
                          filterOptionRefs.current[index] = element;
                        }}
                        role="option"
                        aria-selected={isSelected}
                        className={`flex w-full items-center rounded-[4px] my-0.5 px-3 py-1 text-left text-ide-small whitespace-nowrap transition-colors 
                          focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] focus-visible:outline-none 
                          ${isSelected ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'}`}
                        onClick={() => {
                          setSelectedAgents([agentId]);
                          closeFilter();
                        }}
                        onKeyDown={(event) => handleFilterOptionKeyDown(event, agentId, index)}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
          
          <span className="pl-1 text-foreground-secondary max-[399px]:hidden">
            {filteredHistoryList.length} chat{filteredHistoryList.length !== 1 ? 's' : ''}
          </span>
        </div>
        
        <div className="flex items-center gap-3 shrink-0">
          {selectedCount > 0 && (
            <Button
              onClick={() => openDeleteConfirmation(historyList.filter((item) => selectedConversationIds.includes(item.conversationId)))}
              variant="danger"
              className="max-h-8"
            >
              Delete ({selectedCount})
            </Button>
          )}

          {filteredConversationIds.length > 0 && (
            <button
              type="button"
              onClick={toggleSelectAllFiltered}
              className="text-ide-small text-link hover:underline p-1 rounded-[4px] focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
            >
              {areAllFilteredSelected ? 'Clear all' : 'Select all'}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto w-full space-y-1 mt-1">
        <div className="max-w-[1200px] mx-auto w-full min-h-full flex flex-col">
        {isLoading ? (
          <div className="flex justify-center p-8 text-foreground">Loading history...</div>
        ) : filteredHistoryList.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-foreground">
            <p className="text-sm italic">No history available yet.</p>
          </div>
        ) : (
          filteredHistoryList.map((item) => {
            const conversationId = item.conversationId;
            const isSelected = selectedConversationIds.includes(conversationId);
            const conversationLength = formatConversationLength(item.promptCount);
            const deleteError = deleteErrors[conversationId];
            
            const itemAgents = getItemAgents(item);
            
            const otherAgents = itemAgents.filter(a => a !== item.adapterName);

            const mainAgent = adapterDisplay.get(item.adapterName);
            const mainLabel = mainAgent?.name || item.adapterName;
            const canOpenCli = !!mainAgent?.cliAvailable;

            return (
              <div
                key={conversationId}
                className="group relative"
              >
                <div className="min-h-[56px] border-b border-border flex items-center gap-3 max-[400px]:gap-2 py-1 px-4">
                  <div
                    role="button"
                    tabIndex={editingId === conversationId ? -1 : 0}
                    className="flex min-w-0 flex-1 items-center gap-3 max-[400px]:gap-2 cursor-pointer rounded-[4px] focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] focus-visible:outline-none"
                    onClick={() => { if (editingId !== conversationId) onOpenSession(item); }}
                    onKeyDown={(event) => handleHistoryRowKeyDown(
                      event,
                      editingId === conversationId,
                      () => onOpenSession(item)
                    )}
                  >
                    <div className="flex flex-col items-center shrink-0 gap-0.5 pt-0.5 mx-0.5 max-[350px]:hidden">
                      {mainAgent?.iconPath ? (
                        <img src={mainAgent.iconPath} alt={mainLabel} className="h-8 w-8 object-contain opacity-80" />
                      ) : (
                        <div className="flex items-center justify-center rounded bg-background border border-border font-bold uppercase shrink-0 h-8 w-8 text-base">
                          {mainLabel.slice(0, 1)}
                        </div>
                      )}

                      {otherAgents.length > 0 && (
                        <div className="flex flex-wrap items-center justify-center gap-0.5 w-full">
                          {otherAgents.map((agentId, idx) => {
                            const adapter = adapterDisplay.get(agentId);
                            const iconLabel = adapter?.name || agentId;
                            if (adapter?.iconPath) {
                              return (
                                <img
                                  key={idx}
                                  src={adapter.iconPath}
                                  alt={iconLabel}
                                  className="h-4 w-4 object-contain opacity-70 group-hover:opacity-100 transition-opacity"
                                />
                              );
                            }
                            return (
                              <div key={idx} className="flex h-4 min-w-4 items-center justify-center rounded bg-background border border-border text-[9px] font-bold uppercase shrink-0 opacity-70 group-hover:opacity-100">
                                {iconLabel.slice(0, 1)}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1 flex flex-col justify-center py-0.5">
                      {editingId === conversationId ? (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            spellCheck={false}
                            autoFocus
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            onKeyDown={(e) => handleEditKeyDown(e, item.projectPath, conversationId)}
                            className="-ml-1 h-auto min-w-0 flex-1 border-none bg-background px-1 py-0.5 text-ide-small focus:border-none focus:shadow-none border-none"
                          />
                          <button
                            onClick={(e) => { e.stopPropagation(); submitRename(item.projectPath, conversationId); }}
                            className="rounded border border-[var(--ide-Button-startBorderColor)] bg-background p-1 text-foreground-secondary transition-colors hover:text-primary focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] focus-visible:outline-none"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditingId(null); }}
                            className="rounded border border-[var(--ide-Button-startBorderColor)] bg-background p-1 text-foreground-secondary transition-colors hover:text-error focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] focus-visible:outline-none"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <div className="py-0.5 text-ide-small truncate">{item.title}</div>
                      )}
                      <div className="flex items-center gap-2 text-xs text-foreground-secondary">
                        <span>{formatDate(item.updatedAt)}</span>
                        {conversationLength || item.modelId ? (
                          <span className="opacity-50">&bull;</span>
                        ) : null}
                        {conversationLength ? <span>{conversationLength}</span> : null}
                        {item.modelId ? <span>{item.modelId}</span> : null}
                      </div>
                      {deleteError ? (
                        <div className="mt-1 text-xs text-error">
                          {deleteError}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div 
                    className="flex shrink-0 items-center self-stretch gap-1 relative z-10 ml-2"
                    onClick={(e) => e.stopPropagation()}
                  >

                    <Tooltip variant="minimal" content="Rename chat">
                      <button
                        onClick={(e) => startEditing(item, e)}
                        className="m-0.5 rounded-[4px] p-0.5 text-foreground-secondary opacity-0 transition-opacity hover:text-primary group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] focus-visible:outline-none"
                        aria-label="Rename chat"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    </Tooltip>

                    <Tooltip variant="minimal" content="Delete chat">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openDeleteConfirmation([item]);
                        }}
                        className="m-0.5 rounded-[4px] p-0.5 text-foreground-secondary opacity-0 transition-opacity hover:text-error group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] focus-visible:outline-none"
                        aria-label="Delete chat"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </Tooltip>

                    {canOpenCli && (
                      <Tooltip variant="minimal" content="Open chat in CLI">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            ACPBridge.openHistoryConversationCli(item.projectPath, conversationId);
                          }}
                          className="m-0.5 rounded-[4px] p-0.5 text-foreground-secondary opacity-0 transition-opacity hover:text-primary group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] focus-visible:outline-none"
                          aria-label="Open chat in CLI"
                        >
                          <Terminal className="w-5 h-5" />
                        </button>
                      </Tooltip>
                    )}

                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleSelection(conversationId)}
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0 ml-2 mt-[-2px]"
                      aria-label={`Select ${item.title}`}
                    />
                  </div>
                </div>
              </div>
            );
          })
        )}
        </div>
      </div>

      <ConfirmationModal
        isOpen={pendingDeleteIds.length > 0}
        title={pendingDeleteIds.length > 1 ? 'Delete Chats' : 'Delete Chat'}
        message={
          pendingDeleteIds.length > 1
            ? `Do you want to delete these ${pendingDeleteIds.length} chats?`
            : 'Do you want to delete this chat?'
        }
        onConfirm={confirmDelete}
        confirmLabel="Yes"
        cancelLabel="No"
        onCancel={() => {
          setPendingDeleteIds([]);
          setDeleteProjectPath('');
        }}
      />

      {(pendingDeleteIds.length > 0 || isDeleting) && (
        <div className="absolute inset-0 z-[90] flex items-center justify-center bg-black/40 transition-all duration-200">
          {isDeleting && (
            <div className="flex flex-col items-center gap-3 bg-[#2b2d30] border border-[#3b3b3b] p-5 rounded-lg shadow-xl text-[#DFDFDF]">
              <RefreshCw className="w-6 h-6 animate-spin text-[#3574F0]" />
              <span className="text-sm font-medium leading-none mt-1">Deleting...</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
