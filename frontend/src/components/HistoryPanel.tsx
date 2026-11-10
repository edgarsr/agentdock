import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { conversationKeyOf } from '../types/chat';
import type { AgentOption, ChatTab, HistorySessionMeta, TabUiFlags } from '../types/chat';
import ConfirmationModal from './ConfirmationModal';
import { Archive, ArchiveRestore, Bot, Folder, FolderInput, RefreshCw, Funnel, Pin, Search, Trash2, X } from 'lucide-react';
import { ACPBridge } from '../utils/bridge';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { SectionRowButton, sectionRowButtonClassName } from './ui/SectionList';
import { PopupMenu, popupMenuActions } from './ui/PopupMenu';
import { PopupSubmenu, PopupSubmenuOption, PopupSubmenuSeparator } from './ui/PopupSubmenu';
import { Tooltip } from './chat/shared/Tooltip';
import { HistoryListItem } from './history/HistoryListItem';
import { existingGroup, GroupOptions, historyGroups } from './history/historyGroups';
import { useHistoryPanelController } from './history/useHistoryPanelController';
import { SectionPage } from './ui/SectionPage';

interface HistoryPanelProps {
  availableAgents: AgentOption[];
  tabs: ChatTab[];
  tabUi: Record<string, TabUiFlags>;
  /** Only the archived conversations or only the others. */
  historyList: HistorySessionMeta[];
  historyLoaded: boolean;
  /** Lists the archived conversations, the selection unarchiving them instead. */
  archived: boolean;
  isActive: boolean;
  /** Lists only the group's conversations while it exists; `''` the ungrouped ones, `null` all. */
  group: string | null;
  onGroupChange: (group: string | null) => void;
  onOpenSession: (session: HistorySessionMeta) => void;
}

/** Rows rendered at first and added on reaching the end, so a long history stays light until scrolled through. */
const RENDER_BATCH = 100;

const textButtonClassName = `rounded-[4px] p-1 text-ide-small text-foreground-secondary hover:text-foreground
  focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] focus-visible:outline-none`;
const disabledButtonClassName = 'disabled:pointer-events-none disabled:opacity-50';

/** `null` is all. */
interface FilterOption {
  value: string | null;
  label: string;
  /** Follows a separator. */
  separated?: boolean;
}

/** Filter menu item choosing one of the options in a submenu; it shows the chosen one. */
const filterSubmenu = (
  label: string,
  icon: ReactNode,
  value: string | null,
  options: FilterOption[],
  onSelect: (value: string | null) => void
) => (close: () => void) => (
  <PopupSubmenu key={label} label={label} icon={icon} compact
    value={options.find((option) => option.value === value)?.label}>
    {options.map((option) => (
      <Fragment key={option.value === null ? 'all' : `value:${option.value}`}>
        {option.separated ? <PopupSubmenuSeparator /> : null}
        <PopupSubmenuOption
          label={option.label}
          chosen={option.value === value}
          onClick={() => {
            close();
            onSelect(option.value);
          }}
        />
      </Fragment>
    ))}
  </PopupSubmenu>
);

export default function HistoryPanel({
  availableAgents,
  tabs,
  tabUi,
  historyList,
  historyLoaded,
  archived,
  isActive,
  group: chosenGroup,
  onGroupChange,
  onOpenSession,
}: HistoryPanelProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => historyGroups(historyList), [historyList]);
  const group = existingGroup(groups, chosenGroup);
  const {
    isLoading,
    isSelecting,
    selectedConversationIds,
    pendingDeleteIds,
    agent,
    searchQuery,
    editingId,
    isDeleting,
    deleteErrors,
    adapterDisplay,
    uniqueAgentsInHistory,
    filteredHistoryList,
    snippets,
    isTextSearching,
    resultCount,
    selectedCount,
    filteredConversationIds,
    areAllFilteredSelected,
    formatDate,
    formatConversationLength,
    setAgent,
    setSearchQuery,
    setEditingId,
    confirmDelete,
    refreshHistory,
    toggleSelectAllFiltered,
    openDeleteConfirmation,
    toggleSelection,
    cancelDelete,
    startSelecting,
    stopSelecting,
  } = useHistoryPanelController(
    availableAgents,
    isActive,
    historyList,
    historyLoaded,
    group
  );
  // Opening the history starts a search, except from the section popup sidebar, which focuses the list.
  useEffect(() => {
    if (isActive && !document.activeElement?.closest('[data-section-nav]')) searchInputRef.current?.focus();
  }, [isActive]);

  const [renderLimit, setRenderLimit] = useState(RENDER_BATCH);
  const moreRef = useRef<HTMLDivElement>(null);
  const hasMore = filteredHistoryList.length > renderLimit;
  useEffect(() => setRenderLimit(RENDER_BATCH), [searchQuery, agent, group]);
  // Recreated after each batch, so a batch not filling the view adds the next one.
  useEffect(() => {
    const more = moreRef.current;
    if (!more) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setRenderLimit((limit) => limit + RENDER_BATCH);
    });
    observer.observe(more);
    return () => observer.disconnect();
  }, [renderLimit, hasMore, isLoading]);

  const tabByConversationId = useMemo(() => new Map(tabs.map((tab) => [conversationKeyOf(tab), tab])), [tabs]);
  const hasOpenPendingChat =tabs.some((tab) => pendingDeleteIds.includes(conversationKeyOf(tab)));
  const filterActive = agent !== null || group !== null;
  const selectedItems = historyList.filter((item) => selectedConversationIds.includes(item.conversationId));
  // Pins all once any is unpinned or none is selected, otherwise unpins all.
  const pinSelected = selectedItems.length === 0 || selectedItems.some((item) => !item.pinned);

  return (
    <div className="flex min-h-0 w-full flex-col bg-background text-foreground">
      <SectionPage padding="px-5 pt-1.5 pb-2" toolbar={(
      <div className="flex shrink-0 flex-wrap items-center gap-3 min-h-12 px-4 py-1 border-b border-border">
        <div className="flex min-w-0 flex-auto items-center gap-1.5">
          <div className="relative flex w-32 max-w-56 grow items-center">
            <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2 text-foreground-secondary" />
            <input
              name="history-search"
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search…"
              aria-label="Search chats"
              className="h-7 w-full min-w-0 rounded-[4px] border border-border bg-input pl-7 pr-6 text-ide-small
                text-foreground focus:outline-none"
            />
            {searchQuery ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setSearchQuery('');
                  searchInputRef.current?.focus();
                }}
                className="absolute right-1 rounded-[4px] p-0.5 text-foreground-secondary hover:text-foreground
                  focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] focus-visible:outline-none"
              >
                <X size={12} />
              </button>
            ) : null}
          </div>

          {uniqueAgentsInHistory.length > 1 || groups.length > 0 ? (
            <PopupMenu
              renderTrigger={(trigger) => (
                <Tooltip variant="minimal" content="Filter">
                  <button
                    type="button"
                    aria-label="Filter chats"
                    {...trigger}
                    className={`${sectionRowButtonClassName} ${filterActive ? '!text-foreground' : ''}`}
                  >
                    <Funnel size={14} fill={filterActive ? 'currentColor' : 'none'} />
                  </button>
                </Tooltip>
              )}
            >
              {popupMenuActions([
                ...(uniqueAgentsInHistory.length > 1 ? [filterSubmenu(
                  'Agent',
                  <Bot size={12} aria-hidden="true" />,
                  agent,
                  [
                    { value: null, label: 'All' },
                    ...uniqueAgentsInHistory.map((id) => ({ value: id, label: adapterDisplay.get(id)?.name || id })),
                  ],
                  setAgent
                )] : []),
                ...(groups.length > 0 ? [filterSubmenu(
                  'Group',
                  <Folder size={12} aria-hidden="true" />,
                  group,
                  [
                    { value: null, label: 'All' },
                    ...groups.map((name) => ({ value: name, label: name })),
                    { value: '', label: 'Ungrouped', separated: true },
                  ],
                  onGroupChange
                )] : []),
              ], true)}
            </PopupMenu>
          ) : null}

          <span className="shrink-0 pl-1 text-foreground-secondary text-ide-small max-[499px]:hidden">
            {isSelecting ? `${selectedCount} of ` : ''}{resultCount} chat{resultCount !== 1 ? 's' : ''}
            {isSelecting ? ' selected' : ''}
          </span>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {isSelecting ? (
            <>
              <SectionRowButton
                label={pinSelected ? 'Pin' : 'Unpin'}
                aria-label={pinSelected ? 'Pin selected chats' : 'Unpin selected chats'}
                disabled={selectedCount === 0}
                onClick={() => ACPBridge.updateHistoryConversations(
                  selectedItems[0].projectPath,
                  selectedItems.filter((item) => !item.pinned === pinSelected).map((item) => item.conversationId),
                  { pinned: pinSelected }
                )}
                className={disabledButtonClassName}
              >
                <Pin size={14} className="rotate-45" fill={pinSelected ? 'none' : 'currentColor'} />
              </SectionRowButton>
              <PopupMenu
                renderTrigger={(trigger) => (
                  <Tooltip variant="minimal" content="Move to group">
                    <button
                      type="button"
                      aria-label="Move selected chats to group"
                      disabled={selectedCount === 0}
                      {...trigger}
                      className={`${sectionRowButtonClassName} ${disabledButtonClassName}`}
                    >
                      <FolderInput size={14} />
                    </button>
                  </Tooltip>
                )}
              >
                {(close) => <GroupOptions items={selectedItems} groups={groups} onMove={close} />}
              </PopupMenu>
              <SectionRowButton
                label={archived ? 'Unarchive' : 'Archive'}
                aria-label={archived ? 'Unarchive selected chats' : 'Archive selected chats'}
                disabled={selectedCount === 0}
                onClick={() => ACPBridge.updateHistoryConversations(
                  selectedItems[0].projectPath,
                  selectedItems.map((item) => item.conversationId),
                  { archived: !archived }
                )}
                className={disabledButtonClassName}
              >
                {archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
              </SectionRowButton>
              <SectionRowButton
                label="Delete"
                aria-label="Delete selected chats"
                disabled={!selectedItems.some((item) => item.deletable !== false)}
                onClick={() => openDeleteConfirmation(selectedItems)}
                className={disabledButtonClassName}
              >
                <Trash2 size={14} />
              </SectionRowButton>
              <SectionRowButton label="Cancel" aria-label="Cancel selection" onClick={stopSelecting}>
                <X size={14} />
              </SectionRowButton>
              {filteredConversationIds.length > 0 && (
                <button type="button" onClick={toggleSelectAllFiltered} className={textButtonClassName}>
                  {areAllFilteredSelected ? 'Clear all' : 'Select all'}
                </button>
              )}
            </>
          ) : (
            <button type="button" onClick={startSelecting} className={textButtonClassName}>Select</button>
          )}
          <Tooltip variant="minimal" content="Synchronize history">
            <button
              onClick={refreshHistory}
              disabled={isLoading}
              className={sectionRowButtonClassName}
              aria-label="Refresh history"
            >
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            </button>
          </Tooltip>
        </div>
      </div>
      )}>
      <div className="flex flex-1 flex-col w-full space-y-1">
        {isLoading ? (
          <div className="flex justify-center p-8 text-foreground">Loading history...</div>
        ) : filteredHistoryList.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-foreground">
            {isTextSearching
              ? 'Searching…'
              : searchQuery.trim() || filterActive
                ? 'No matching chats.'
                : archived ? 'No archived chats.' : 'No history available yet.'}
          </div>
        ) : (<>
          {filteredHistoryList.slice(0, renderLimit).map((item) => {
            const conversationId = item.conversationId;
            const tab = tabByConversationId.get(conversationId);
            return (
              <HistoryListItem
                key={conversationId}
                item={item}
                agents={availableAgents}
                isSelecting={isSelecting}
                isSelected={selectedConversationIds.includes(conversationId)}
                isOpen={tab !== undefined}
                status={tab && tabUi[tab.id]}
                conversationLength={formatConversationLength(item.promptCount)}
                groups={groups}
                showGroup={group === null}
                deleteError={deleteErrors[conversationId]}
                searchQuery={searchQuery}
                snippet={snippets?.[conversationId]}
                isEditing={editingId === conversationId}
                formatDate={formatDate}
                onOpenSession={onOpenSession}
                onEditingChange={(editing) => setEditingId(editing ? conversationId : null)}
                onOpenDeleteConfirmation={openDeleteConfirmation}
                onToggleSelection={toggleSelection}
              />
            );
          })}
          {hasMore ? <div ref={moreRef} className="h-px" /> : null}
        </>)}
      </div>
      </SectionPage>

      <ConfirmationModal
        isOpen={pendingDeleteIds.length > 0}
        title={pendingDeleteIds.length > 1 ? 'Delete Chats' : 'Delete Chat'}
        message={
          (pendingDeleteIds.length > 1
            ? `Do you want to delete these ${pendingDeleteIds.length} chats?`
            : 'Do you want to delete this chat?') + (hasOpenPendingChat
              ? pendingDeleteIds.length > 1
                ? '\nOpen chats in this selection will be closed before deletion.'
                : '\nThis chat is open and will be closed before deletion.'
              : '')
        }
        onConfirm={confirmDelete}
        confirmLabel="Yes"
        cancelLabel="No"
        onCancel={cancelDelete}
      />

      {isDeleting && (
        <div className="absolute inset-0 z-[90] flex items-center justify-center transition-all duration-200">
          <div className="relative flex flex-col items-center gap-3 bg-[var(--ide-Panel-background)] border border-border p-5 rounded text-foreground shadow-popup">
            <LoadingSpinner className="w-6 h-6 text-foreground-secondary" />
            <span className="text-ide-small font-medium leading-none mt-1">Deleting...</span>
          </div>
        </div>
      )}
    </div>
  );
}
