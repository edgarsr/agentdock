import { useMemo, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { EllipsisVertical, Pencil, X } from 'lucide-react';
import { conversationKeyOf } from '../../types/chat';
import type { AgentOption, ChatTab, HistorySessionMeta, TabUiFlags } from '../../types/chat';
import { ACPBridge } from '../../utils/bridge';
import { focusChatOutput } from '../../hooks/useShortcuts';
import ConfirmationModal from '../ConfirmationModal';
import { PopupMenu, popupMenuActions } from '../ui/PopupMenu';
import { Tooltip } from '../chat/shared/Tooltip';
import { getTabIcon, PinIcon } from './TabIcons';
import { TabTitleInput } from './TabTitleInput';
import { useTabReordering } from './useTabReordering';
import { conversationMenuActions, historyGroups } from '../history/historyGroups';
import { menuRowClassName, rowButtonClassName, rowFocusClassName, RowAction, sidebarRowClassName } from './rows';

export interface OpenChatListProps {
  /** Open chats and closed pinned ones. */
  chats: ChatTab[];
  historyList: HistorySessionMeta[];
  tabUi: Record<string, TabUiFlags>;
  activeTabId: string;
  agents: AgentOption[];
  onSelectTab: (id: string) => void;
  onReorderTabs: (draggedId: string, targetId: string, position: 'before' | 'after') => void;
  onCloseTab: (id: string) => void;
  onCloseAllChats: () => void;
  onRenameTab: (tabId: string, title: string) => void;
}

/**
 * An open chat's permission request, reply in progress, queued prompts or unread reply, the first of them; `className`
 * places it.
 */
export function ChatStatusIndicator({ flags, tooltipPlacement, className }: {
  flags: TabUiFlags | undefined;
  tooltipPlacement?: 'top' | 'bottom';
  className: string;
}) {
  const box = 'flex h-3.5 w-3.5 shrink-0 items-center justify-center self-center';
  if (flags?.warning) return <span className={`${box} ${className}`}><span className="h-2 w-2 rounded-full bg-warning" /></span>;
  if (flags?.processing) return <span className={`${box} ${className}`}><span className="h-2 w-2 rounded-full bg-foreground-secondary animate-pulse" /></span>;
  if (flags?.queued) {
    return (
      <Tooltip variant="minimal" placement={tooltipPlacement} content="Queued prompts"
        className={`shrink-0 self-center cursor-default ${className}`}>
        <span data-open-chat-status role="img" aria-label="Queued prompts" className={box}>
          <span className="h-2 w-2 rounded-full border border-foreground-secondary" />
        </span>
      </Tooltip>
    );
  }
  if (flags?.unread) return <span className={`${box} ${className}`}><span className="h-2 w-2 rounded-full bg-sky-500" /></span>;
  return null;
}

/**
 * The header names the listed chats and offers "Close all" while any chat is open. Pinned chats always show
 * the pin (unpinning them) before the status indicator; closed ones have no close button. In the sidebar rows can be
 * reordered by dragging, and pinning, renaming, moving to a group, opening in the terminal and deleting sit in a row
 * menu; in the tab bar menu (`onAction` given, closing the menu), where a nested menu would be awkward, pin and rename
 * are row buttons.
 */
export function OpenChatList({
  chats,
  historyList,
  tabUi,
  activeTabId,
  agents,
  onSelectTab,
  onReorderTabs,
  onCloseTab,
  onCloseAllChats,
  onRenameTab,
  onAction,
}: OpenChatListProps & { onAction?: () => void }) {
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [pendingDeleteChat, setPendingDeleteChat] = useState<{
    conversationId: string;
    projectPath: string;
    open: boolean;
  } | null>(null);
  const {
    listRef,
    dropTarget,
    startReordering,
    shouldSuppressClick,
  } = useTabReordering('vertical', onReorderTabs);
  const sidebar = !onAction;
  const itemRole = onAction ? 'menuitem' : undefined;
  const tooltipPlacement = sidebar ? 'top' : 'bottom';
  const historyByConversationId = new Map(historyList.map((item) => [item.conversationId, item]));
  const groups = useMemo(() => historyGroups(historyList), [historyList]);

  if (chats.length === 0) return null;

  const hasPinned = chats.some((chat) => historyByConversationId.get(conversationKeyOf(chat))?.pinned);
  const openCount = chats.filter((chat) => !chat.closed).length;
  const heading = !hasPinned ? 'Open chats' : openCount === 0 ? 'Pinned chats' : 'Pinned & open chats';

  // React events bubble out of the portaled row menu too, hence `[role=menu]`.
  const handlePointerDown = (id: string, event: ReactPointerEvent<HTMLDivElement>) => {
    if (!sidebar || event.button !== 0
      || (event.target as HTMLElement).closest('[data-row-action], [data-open-chat-status], input, [role=menu]')) {
      return;
    }
    startReordering(id, event);
  };

  return (
    <div className={sidebar ? undefined : 'mb-1'}>
      <div className="flex min-h-7 items-center pl-3.5 pr-3 text-ide-small text-[var(--ide-Label-disabledForeground)]">
        <span className="min-w-0 flex-1 truncate">{heading}</span>
        {openCount > 0 ? (
          <Tooltip variant="minimal" placement="bottom" content="Close all">
            <button
              type="button"
              onClick={() => {
                onCloseAllChats();
                onAction?.();
              }}
              className={`flex h-5 w-6 items-center justify-center rounded text-foreground-secondary hover:text-foreground ${rowFocusClassName}`}
              aria-label="Close all"
              role={itemRole}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </Tooltip>
        ) : null}
      </div>

      <div ref={listRef} className={sidebar ? 'pb-1' : undefined}>
        {chats.map((tab) => {
          const flags = tabUi[tab.id];
          const hasStatus = flags?.warning || flags?.processing || flags?.queued || flags?.unread;
          const conversationId = conversationKeyOf(tab);
          const historyItem = historyByConversationId.get(conversationId);
          const pinned = historyItem?.pinned === true;
          const pinLabel = pinned ? 'Unpin' : 'Pin';
          const togglePin = historyItem
            ? () => ACPBridge.updateHistoryConversations(historyItem.projectPath, [conversationId], { pinned: !pinned })
            : undefined;
          // Pinned chats show the pin, the tab bar menu also offers it on unpinned ones.
          const showPinButton = togglePin && (pinned || !sidebar);
          // Resuming in the terminal suits only closed chats.
          const canOpenCli = !!tab.closed && agents.some((agent) => agent.id === historyItem?.adapterName && agent.cliResumeAvailable);
          const isActive = tab.id === activeTabId;

          return (
            <div
              key={tab.id}
              data-reorder-tab-id={tab.id}
              onPointerDown={(event) => handlePointerDown(tab.id, event)}
              className={`group ${sidebar
                ? `mx-2 mb-0.5 cursor-grab select-none active:cursor-grabbing ${sidebarRowClassName(isActive)}`
                : menuRowClassName(isActive)}`}
            >
              {dropTarget?.id === tab.id && dropTarget.position === 'before' ? (
                <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-30 h-px bg-primary" />
              ) : null}
              {dropTarget?.id === tab.id && dropTarget.position === 'after' ? (
                <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-px bg-primary" />
              ) : null}
              {renamingTabId === tab.id ? (
                <div className="flex min-h-8 min-w-0 flex-1 items-center pl-2">
                  <span className="mr-2 flex items-center justify-center">
                    {getTabIcon(tab, agents)}
                  </span>
                  <TabTitleInput
                    initialTitle={tab.title}
                    onCommit={(title) => onRenameTab(tab.id, title)}
                    onClose={() => setRenamingTabId(null)}
                    className="-ml-1 rounded-[3px] bg-background px-1 text-foreground"
                  />
                </div>
              ) : (
                <>
                  <button
                    onClick={(event) => {
                      if (shouldSuppressClick(tab.id)) return;
                      onSelectTab(tab.id);
                      // Not on a double click's second click, so the focus stays in the rename input it opens.
                      if (sidebar && event.detail < 2) focusChatOutput();
                      onAction?.();
                    }}
                    className={rowButtonClassName}
                    role={itemRole}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <span className="flex items-center justify-center">
                      {getTabIcon(tab, agents)}
                    </span>
                    <span className="min-w-0 flex-1 truncate pr-1 group-reveal:pr-0" onDoubleClick={() => setRenamingTabId(tab.id)}>{tab.title}</span>
                  </button>
                  {sidebar ? (
                    <PopupMenu
                      renderTrigger={(trigger) => (
                        <RowAction label={`More actions for ${tab.title}`} tooltip="More actions" menu={false}
                          placement={tooltipPlacement} trigger={trigger}>
                          <EllipsisVertical size={14} aria-hidden="true" />
                        </RowAction>
                      )}
                    >
                      {popupMenuActions(conversationMenuActions(historyItem, {
                        groups,
                        canOpenCli,
                        onRename: () => setRenamingTabId(tab.id),
                        onDelete: () => historyItem && setPendingDeleteChat({
                          conversationId,
                          projectPath: historyItem.projectPath,
                          open: !tab.closed,
                        }),
                      }), true)}
                    </PopupMenu>
                  ) : (
                    <RowAction label={`Rename ${tab.title}`} tooltip="Rename" menu placement={tooltipPlacement}
                      onClick={() => setRenamingTabId(tab.id)}>
                      <Pencil size={12} strokeWidth={2.5} aria-hidden="true" />
                    </RowAction>
                  )}
                  {tab.closed ? null : (
                    <RowAction label={`Close ${tab.title}`} tooltip="Close" menu={!sidebar} placement={tooltipPlacement}
                      className={hasStatus || showPinButton ? '' : 'group-reveal:mr-1'}
                      onClick={() => onCloseTab(tab.id)}>
                      <X size={14} aria-hidden="true" />
                    </RowAction>
                  )}
                  {showPinButton ? (
                    <RowAction label={`${pinLabel} ${tab.title}`} tooltip={pinLabel} menu={!sidebar} visible={pinned}
                      placement={tooltipPlacement} className={hasStatus ? '' : pinned ? 'mr-1' : 'group-reveal:mr-1'}
                      onClick={togglePin}>
                      <PinIcon pinned={pinned} />
                    </RowAction>
                  ) : null}
                </>
              )}
              <ChatStatusIndicator flags={flags} tooltipPlacement={tooltipPlacement} className="ml-1 mr-2" />
            </div>
          );
        })}
      </div>
      <ConfirmationModal
        isOpen={pendingDeleteChat !== null}
        title="Delete Chat"
        message={`Do you want to delete this chat?${
          pendingDeleteChat?.open ? '\nThis chat is open and will be closed before deletion.' : ''
        }`}
        onConfirm={() => {
          if (!pendingDeleteChat) return;
          ACPBridge.deleteHistoryConversations(
            pendingDeleteChat.projectPath,
            [pendingDeleteChat.conversationId]
          );
          setPendingDeleteChat(null);
        }}
        confirmLabel="Yes"
        cancelLabel="No"
        onCancel={() => setPendingDeleteChat(null)}
      />
    </div>
  );
}
