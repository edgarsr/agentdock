import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, History, Pencil, Terminal, Trash2, X } from 'lucide-react';
import type { AgentOption, HistorySessionMeta } from '../../types/chat';
import { ACPBridge } from '../../utils/bridge';
import ConfirmationModal from '../ConfirmationModal';
import { Tooltip } from '../chat/shared/Tooltip';
import { getAgentIcon } from './TabIcons';
import { TabTitleInput } from './TabTitleInput';

const RECENT_PAGE_SIZE = 3;

interface RecentChatsProps {
  historyList: HistorySessionMeta[];
  agents: AgentOption[];
  onOpenConversation: (session: HistorySessionMeta) => void;
  onOpenHistory: () => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}

export function RecentChats({
  historyList,
  agents,
  onOpenConversation,
  onOpenHistory,
  expanded,
  onExpandedChange,
}: RecentChatsProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [pendingDeleteItem, setPendingDeleteItem] = useState<HistorySessionMeta | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const recentConversations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return [...historyList]
      .filter((item) => item.title.toLowerCase().includes(query))
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, RECENT_PAGE_SIZE);
  }, [historyList, searchQuery]);

  useEffect(() => {
    if (historyList.length <= RECENT_PAGE_SIZE) {
      setSearchQuery('');
    }
    if (renamingId && !historyList.some((item) => item.conversationId === renamingId)) {
      setRenamingId(null);
    }
  }, [historyList, renamingId]);

  if (historyList.length === 0) return null;

  const confirmDelete = () => {
    if (!pendingDeleteItem) return;
    ACPBridge.deleteHistoryConversations(
      pendingDeleteItem.projectPath,
      [pendingDeleteItem.conversationId]
    );
    setPendingDeleteItem(null);
  };

  return (
    <div>
      <div className="flex min-h-7 items-center px-3 text-ide-small text-[var(--ide-Label-disabledForeground)]">
        <button
          type="button"
          onClick={() => onExpandedChange(!expanded)}
          className="flex min-w-0 flex-1 items-center self-stretch text-left focus:outline-none"
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
          <span className="ml-1 truncate">Recent Chats</span>
        </button>
        <Tooltip variant="minimal" placement="top" content="View all project chats">
          <button
            type="button"
            onClick={onOpenHistory}
            className="flex h-5 w-6 items-center justify-center rounded text-foreground-secondary
              hover:bg-hover hover:text-foreground focus:outline-none
              focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
            aria-label="View all project chats"
          >
            <History size={14} aria-hidden="true" />
          </button>
        </Tooltip>
      </div>

      <div
        aria-hidden={!expanded}
        {...(!expanded ? { inert: '' } : {})}
        className={`grid overflow-hidden transition-[grid-template-rows] duration-200 ease-in-out ${
        expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
      }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="py-1">
          {historyList.length > RECENT_PAGE_SIZE ? (
            <div className="relative mx-2 mt-1 mb-2 px-2">
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search…"
                aria-label="Search recent chats by title"
                className="h-8 w-full rounded-[4px] border border-border bg-input py-0 pl-2 pr-6 text-ide-small text-foreground
                  placeholder:text-foreground-secondary focus:outline-none"
              />
              {searchQuery ? (
                <button
                  type="button"
                  aria-label="Clear recent chats search"
                  onClick={() => {
                    setSearchQuery('');
                    searchInputRef.current?.focus();
                  }}
                  className="absolute right-4 top-1/2 -translate-y-1/2 rounded-[4px] p-0.5 text-foreground-secondary hover:text-foreground focus:outline-none"
                >
                  <X size={11} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ) : null}

          {recentConversations.map((item) => {
        const isRenaming = renamingId === item.conversationId;
        const canOpenCli = agents.find((agent) => agent.id === item.adapterName)?.cliResumeAvailable === true;
        const canDelete = item.deletable !== false;

        return (
          <div key={item.conversationId} className="group ml-2 mr-2 mb-0.5">
            <div className="relative flex min-h-8 w-full items-stretch rounded-[4px] text-foreground
              before:pointer-events-none before:absolute before:inset-0 before:rounded-[4px] before:bg-background
              before:opacity-0 before:[filter:var(--ide-surface-active-filter)] hover:before:opacity-100 focus-within:before:opacity-100"
            >
              {isRenaming ? (
                <div className="relative z-10 flex min-w-0 flex-1 items-center pl-3">
                  <span className="mr-2 flex items-center justify-center">
                    {getAgentIcon(item.adapterName, agents)}
                  </span>
                  <TabTitleInput
                    initialTitle={item.title}
                    onCommit={(title) => ACPBridge.renameHistoryConversation(
                      item.projectPath,
                      item.conversationId,
                      title
                    )}
                    onClose={() => setRenamingId(null)}
                    className="-ml-1 rounded-[3px] bg-background px-1 text-foreground"
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onOpenConversation(item)}
                  className="relative z-10 flex min-w-0 flex-1 items-center rounded-l-[4px] pl-3 pr-1 text-left focus:outline-none
                    focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                >
                  <span className="mr-2 flex items-center justify-center">
                    {getAgentIcon(item.adapterName, agents)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                </button>
              )}

              {!isRenaming ? (
                <>
                  <div className="relative z-10 w-0 overflow-hidden opacity-0 pointer-events-none
                    group-hover:w-6 group-hover:opacity-100 group-hover:pointer-events-auto
                    group-focus-within:w-6 group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
                  >
                    <Tooltip variant="minimal" placement="top" content="Rename" className="flex h-full w-6">
                      <button
                        type="button"
                        onClick={() => setRenamingId(item.conversationId)}
                        className="flex min-h-8 w-6 shrink-0 items-center justify-center text-foreground-secondary
                          hover:text-foreground focus:outline-none
                          focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                        aria-label={`Rename ${item.title}`}
                      >
                        <Pencil size={12} strokeWidth={2.5} aria-hidden="true" />
                      </button>
                    </Tooltip>
                  </div>

                  {canDelete ? (
                    <div className="relative z-10 w-0 overflow-hidden opacity-0 pointer-events-none
                      group-hover:w-6 group-hover:opacity-100 group-hover:pointer-events-auto
                      group-focus-within:w-6 group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
                    >
                      <Tooltip variant="minimal" placement="top" content="Delete" className="flex h-full w-6">
                        <button
                          type="button"
                          onClick={() => setPendingDeleteItem(item)}
                          className="flex min-h-8 w-6 shrink-0 items-center justify-center text-foreground-secondary
                            hover:text-error focus:outline-none
                            focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                          aria-label={`Delete ${item.title}`}
                        >
                          <Trash2 size={13} className="-translate-y-px" aria-hidden="true" />
                        </button>
                      </Tooltip>
                    </div>
                  ) : null}

                  {canOpenCli ? (
                    <div className="relative z-10 w-0 overflow-hidden opacity-0 pointer-events-none
                      group-hover:w-6 group-hover:opacity-100 group-hover:pointer-events-auto
                      group-focus-within:w-6 group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
                    >
                      <Tooltip variant="minimal" placement="top" content="Open chat in terminal" className="flex h-full w-6">
                        <button
                          type="button"
                          onClick={() => ACPBridge.openHistoryConversationCli(item.projectPath, item.conversationId)}
                          className="flex min-h-8 w-6 shrink-0 items-center justify-center text-foreground-secondary
                            hover:text-foreground focus:outline-none
                            focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                          aria-label={`Open ${item.title} in CLI`}
                        >
                          <Terminal className="h-4 w-4 translate-y-px" aria-hidden="true" />
                        </button>
                      </Tooltip>
                    </div>
                  ) : null}
                  <span className="relative z-10 w-0 shrink-0 group-hover:w-1 group-focus-within:w-1" />
                </>
              ) : null}
            </div>
          </div>
        );
          })}

          </div>
        </div>
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
