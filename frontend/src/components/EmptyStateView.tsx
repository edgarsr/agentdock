import { useEffect, useMemo, useState } from 'react';
import { Bot, Check, Pencil, Terminal, Trash2, X } from 'lucide-react';
import type { AgentOption, HistoryDeleteResultPayload, HistorySessionMeta } from '../types/chat';
import { ACPBridge } from '../utils/bridge';
import { sanitizeSvg } from '../utils/sanitizeHtml';
import { Button } from './ui/Button';
import ConfirmationModal from './ConfirmationModal';
import { Tooltip } from './chat/shared/Tooltip';

const HISTORY_POLL_INTERVAL_MS = 5000;

interface EmptyStateViewProps {
  availableAgents: AgentOption[];
  runnableAgents: AgentOption[];
  adaptersResolved: boolean;
  onStartWithAgent: (agentId: string) => void;
  onOpenRecentConversation: (session: HistorySessionMeta) => void;
  onOpenHistory: () => void;
  onOpenManagement: () => void;
}

function AgentIcon({ agent, size = 'md' }: { agent?: AgentOption; size?: 'md' | 'lg' }) {
  const sizeClassName = size === 'lg' ? 'h-9 w-9' : 'h-full w-full';

  if (agent?.iconPath) {
    if (agent.iconPath.startsWith('<svg')) {
      return (
        <div
          className={`${sizeClassName} shrink-0 text-foreground [&>svg]:block [&>svg]:h-full [&>svg]:w-full`}
          dangerouslySetInnerHTML={{ __html: sanitizeSvg(agent.iconPath) }}
        />
      );
    }
    return <img src={agent.iconPath} alt="" className={`${sizeClassName} shrink-0 object-contain`} />;
  }

  return <Bot className={`${sizeClassName} shrink-0 text-foreground-secondary`} />;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.getDate() === now.getDate()
    && date.getMonth() === now.getMonth()
    && date.getFullYear() === now.getFullYear();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.getDate() === yesterday.getDate()
    && date.getMonth() === yesterday.getMonth()
    && date.getFullYear() === yesterday.getFullYear();

  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const time = `${hours}:${minutes}`;

  if (isToday) return `Today ${time}`;
  if (isYesterday) return `Yesterday ${time}`;

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year} ${time}`;
}

function formatPromptCount(promptCount?: number): string | null {
  if (promptCount == null || promptCount <= 0) return null;
  return `${promptCount} prompt${promptCount === 1 ? '' : 's'}`;
}

function handleRecentChatKeyDown(
  event: React.KeyboardEvent<HTMLDivElement>,
  disabled: boolean,
  onActivate: () => void
) {
  if (disabled || (event.key !== 'Enter' && event.key !== ' ')) return;
  event.preventDefault();
  event.stopPropagation();
  onActivate();
}

export function EmptyStateView({
  availableAgents,
  runnableAgents,
  adaptersResolved,
  onStartWithAgent,
  onOpenRecentConversation,
  onOpenHistory,
  onOpenManagement,
}: EmptyStateViewProps) {
  const [historyList, setHistoryList] = useState<HistorySessionMeta[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [pendingDeleteItem, setPendingDeleteItem] = useState<HistorySessionMeta | null>(null);
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});
  const [isDocumentVisible, setIsDocumentVisible] = useState(
    typeof document === 'undefined' ? true : document.visibilityState === 'visible'
  );

  useEffect(() => {
    const sameHistoryList = (left: HistorySessionMeta[], right: HistorySessionMeta[]) => {
      if (left.length !== right.length) return false;
      return left.every((item, index) => {
        const other = right[index];
        return other
          && item.conversationId === other.conversationId
          && item.title === other.title
          && item.updatedAt === other.updatedAt
          && item.promptCount === other.promptCount
          && item.modelId === other.modelId
          && item.adapterName === other.adapterName;
      });
    };

    const unsubscribeHistory = ACPBridge.onHistoryList((event) => {
      const list = Array.isArray(event.detail.list) ? event.detail.list : [];
      setHistoryList((prev) => sameHistoryList(prev, list) ? prev : list);
      setDeleteErrors((prev) => Object.fromEntries(
        Object.entries(prev).filter(([conversationId]) => list.some((item) => item.conversationId === conversationId))
      ));
      if (editingId && !list.some((item) => item.conversationId === editingId)) {
        setEditingId(null);
      }
    });

    const unsubscribeDelete = ACPBridge.onHistoryDeleteResult((event: CustomEvent<{ result: HistoryDeleteResultPayload }>) => {
      const result = event.detail.result;
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
    });

    const requestHistory = () => {
      if (!adaptersResolved || !isDocumentVisible) return;
      ACPBridge.requestHistoryList();
    };

    requestHistory();
    const intervalId = window.setInterval(requestHistory, HISTORY_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
      unsubscribeDelete();
      unsubscribeHistory();
    };
  }, [editingId, isDocumentVisible, adaptersResolved]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const visible = document.visibilityState === 'visible';
      setIsDocumentVisible(visible);
      if (visible && adaptersResolved) {
        ACPBridge.requestHistoryList();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [adaptersResolved]);

  const recentConversations = useMemo(() => {
    return [...historyList]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 3);
  }, [historyList]);

  const agentsById = useMemo(() => {
    return new Map(availableAgents.map((agent) => [agent.id, agent]));
  }, [availableAgents]);

  const submitRename = (projectPath: string, conversationId: string) => {
    if (!editTitle.trim()) {
      setEditingId(null);
      return;
    }

    setHistoryList((prev) => prev.map((item) => (
      item.conversationId === conversationId ? { ...item, title: editTitle.trim() } : item
    )));
    ACPBridge.renameHistoryConversation(projectPath, conversationId, editTitle.trim());
    setEditingId(null);
  };

  const handleEditKeyDown = (event: React.KeyboardEvent, projectPath: string, conversationId: string) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      submitRename(projectPath, conversationId);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setEditingId(null);
    }
  };

  const confirmDelete = () => {
    if (!pendingDeleteItem) return;
    setDeleteErrors((prev) => {
      const next = { ...prev };
      delete next[pendingDeleteItem.conversationId];
      return next;
    });
    ACPBridge.deleteHistoryConversations(pendingDeleteItem.projectPath, [pendingDeleteItem.conversationId]);
    setPendingDeleteItem(null);
  };

  return (
    <div className="absolute inset-0 z-10 overflow-y-auto bg-background">
      <div className="mx-auto flex min-h-full w-full max-w-[1200px] flex-col sm:px-6 px-4 pb-4">
        <div className="flex flex-1 items-center justify-center pt-12 pb-16">
          <div className="flex flex-col items-center text-center">
            {runnableAgents.length > 0 ? (
              <>
                <h1 className="text-ide-h3">Select an AI agent to start a new chat</h1>

                <div className="mt-8 inline-grid w-fit gap-3 self-center">
                  {runnableAgents.map((agent) => (
                    <Button
                      key={agent.id}
                      onClick={() => onStartWithAgent(agent.id)}
                      variant="secondary"
                      className="w-full min-w-0 pl-[0.78em] [&>span:first-child]:w-auto text-ide-small font-semibold"
                      leftIcon={<AgentIcon agent={agent} />}
                    >
                      {agent.name}
                    </Button>
                  ))}
                </div>
              </>
            ) : adaptersResolved ? (
              <>
                <p className="mt-8 max-w-[300px] text-foreground-secondary">
                  Install at least one AI agent from Service Providers to start a new chat.
                </p>
                <div className="mt-6">
                  <Button onClick={onOpenManagement} variant="secondary">Service Providers</Button>
                </div>
              </>
            ) : (
              <div className="h-[92px]" />
            )}
          </div>
        </div>

        {recentConversations.length > 0 && (
          <div>
            <div className="flex items-center justify-between gap-3">
              <div className="ml-1 text-ide-small">Recent chats</div>
              <button
                type="button"
                onClick={onOpenHistory}
                className="text-ide-small rounded-[4px] p-1 text-link hover:underline
                  focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
              >
                View all
              </button>
            </div>

            <div className="mt-2 flex flex-col">
              {recentConversations.map((item) => {
                const conversationId = item.conversationId;
                const conversationLength = formatPromptCount(item.promptCount);
                const deleteError = deleteErrors[conversationId];
                const mainAgent = agentsById.get(item.adapterName);
                const mainLabel = mainAgent?.name || item.adapterName;
                const canOpenCli = !!mainAgent?.cliAvailable;

                return (
                  <div key={conversationId} className="group relative">
                    <div className="flex items-center py-1.5 border-t border-border">
                      <div
                        role="button"
                        tabIndex={editingId === conversationId ? -1 : 0}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-[4px]
                          focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] focus-visible:outline-none"
                        onClick={() => { if (editingId !== conversationId) onOpenRecentConversation(item); }}
                        onKeyDown={(event) => handleRecentChatKeyDown(
                          event,
                          editingId === conversationId,
                          () => onOpenRecentConversation(item)
                        )}
                      >
                        <div className="flex min-w-[42px] shrink-0 items-center justify-center">
                          {mainAgent?.iconPath ? (
                            <img src={mainAgent.iconPath} alt={mainLabel} className="h-6 w-6 object-contain opacity-80" />
                          ) : (
                            <div className="flex h-9 w-9 items-center justify-center rounded border border-border bg-background text-base font-bold uppercase">
                              {mainLabel.slice(0, 1)}
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1 py-0.5">
                          {editingId === conversationId ? (
                            <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                              <input
                                type="text"
                                spellCheck={false}
                                autoFocus
                                value={editTitle}
                                onChange={(event) => setEditTitle(event.target.value)}
                                onKeyDown={(event) => handleEditKeyDown(event, item.projectPath, conversationId)}
                                className="h-auto min-w-0 flex-1 border-none bg-background px-1 py-0.5 text-ide-small focus:border-none focus:shadow-none border-none"
                              />
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  submitRename(item.projectPath, conversationId);
                                }}
                                className="rounded border border-[var(--ide-Button-startBorderColor)] bg-background
                                  px-1 py-0.5 text-foreground-secondary transition-colors hover:text-primary
                                  focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] focus-visible:outline-none"
                              >
                                <Check size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setEditingId(null);
                                }}
                                className="rounded border border-[var(--ide-Button-startBorderColor)] bg-background
                                  px-1 py-0.5 text-foreground-secondary transition-colors hover:text-error
                                  focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] focus-visible:outline-none"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          ) : (
                            <div className="truncate py-0.5 text-ide-small font-semibold">{item.title}</div>
                          )}

                          <div className="flex items-center gap-2 text-xs text-foreground-secondary">
                            <span>{formatDate(item.updatedAt)}</span>
                            {conversationLength || item.modelId ? <span className="opacity-50">&bull;</span> : null}
                            {conversationLength ? <span>{conversationLength}</span> : null}
                            {item.modelId ? <span>{item.modelId}</span> : null}
                          </div>

                          {deleteError ? <div className="mt-1 text-xs text-error">{deleteError}</div> : null}
                        </div>
                      </div>

                      <div className="relative z-10 ml-4 hidden shrink-0 items-center gap-1 min-[350px]:flex" onClick={(event) => event.stopPropagation()}>
                        <Tooltip variant="minimal" content="Rename chat">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(conversationId);
                              setEditTitle(item.title);
                            }}
                            className="rounded-[4px] p-1 text-foreground-secondary opacity-0 transition-opacity
                              hover:text-primary group-hover:opacity-100 group-focus-within:opacity-100
                              focus-visible:opacity-100 focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]
                              focus-visible:outline-none"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        </Tooltip>
                        <Tooltip variant="minimal" content="Delete chat">
                          <button
                            type="button"
                            onClick={() => setPendingDeleteItem(item)}
                            className="rounded-[4px] p-1 text-foreground-secondary opacity-0 transition-opacity
                              hover:text-error group-hover:opacity-100 group-focus-within:opacity-100
                              focus-visible:opacity-100 focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]
                              focus-visible:outline-none"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </Tooltip>
                        {canOpenCli && (
                          <Tooltip variant="minimal" content="Open chat in CLI">
                            <button
                              type="button"
                              onClick={() => ACPBridge.openHistoryConversationCli(item.projectPath, conversationId)}
                              className="rounded-[4px] p-1 text-foreground-secondary opacity-0 transition-opacity
                                hover:text-primary group-hover:opacity-100 group-focus-within:opacity-100
                                focus-visible:opacity-100 focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]
                                focus-visible:outline-none"
                            >
                              <Terminal className="h-4 w-4" />
                            </button>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <ConfirmationModal
        isOpen={pendingDeleteItem !== null}
        title="Delete Chat"
        message="Do you want to delete this chat?"
        onConfirm={confirmDelete}
        confirmLabel="Yes"
        cancelLabel="No"
        onCancel={() => setPendingDeleteItem(null)}
      />
    </div>
  );
}
