import { RefObject, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { ChevronDown, ChevronRight, Pencil, Plus, Terminal, Trash2, X } from 'lucide-react';
import {
  AgentOption,
  ChatTab,
  DEFAULT_SIDEBAR_EXPANDED_SECTIONS,
  HistorySessionMeta,
  SidebarSectionId,
  TabUiFlags,
} from '../../types/chat';
import { ACPBridge } from '../../utils/bridge';
import ConfirmationModal from '../ConfirmationModal';
import { Tooltip } from '../chat/shared/Tooltip';
import { ChatSpinnerIcon } from '../chat/ChatLoadingIndicator';
import { getAgentIcon, getTabIcon } from './TabIcons';
import { moveMenuFocus } from './menuFocus';
import { TabTitleInput } from './TabTitleInput';
import { useTabReordering } from './useTabReordering';
import { NavigationActions, NavigationActionsProps } from './NavigationActions';
import { RecentChats } from './RecentChats';

interface NavigationMenuProps extends Omit<NavigationActionsProps, 'onAction'> {
  menuListRef: RefObject<HTMLDivElement>;
  menuButtonRef: RefObject<HTMLButtonElement>;
  tabs: ChatTab[];
  activeTabId: string;
  tabUi: Record<string, TabUiFlags>;
  agents: AgentOption[];
  runnableAgents: AgentOption[];
  onCloseTab: (id: string) => void;
  onCloseAllChats: () => void;
  onSelectTab: (id: string) => void;
  onReorderTabs: (draggedId: string, targetId: string, position: 'before' | 'after') => void;
  onNewTabWithAgent: (agentId: string) => void;
  onRenameTab: (tabId: string, title: string) => void;
  onCloseMenu: () => void;
}

export function NavigationMenu({
  menuListRef,
  menuButtonRef,
  onCloseMenu,
  ...contentProps
}: NavigationMenuProps) {
  return (
    <div
      ref={menuListRef}
      className="absolute top-full right-0 mt-1 w-[250px] max-w-[calc(100vw-1rem)] max-h-[calc(100vh-4rem)] overflow-y-auto whitespace-nowrap bg-background
        border border-[var(--ide-Button-startBorderColor)] rounded-[8px] py-1.5 z-50 text-ide-small"
      role="menu"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onCloseMenu();
          menuButtonRef.current?.focus();
          return;
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          moveMenuFocus(menuListRef.current, 1);
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          moveMenuFocus(menuListRef.current, -1);
        }
      }}
    >
      <TabNavigationContent {...contentProps} onAction={onCloseMenu} />
    </div>
  );
}

type TabNavigationContentProps = Omit<NavigationMenuProps, 'menuListRef' | 'menuButtonRef' | 'onCloseMenu'> & {
  onAction?: () => void;
  onNewTab?: () => void;
  historyList?: HistorySessionMeta[];
  onOpenRecentConversation?: (session: HistorySessionMeta) => void;
  pinActionsToBottom?: boolean;
  sidebarExpandedSections?: SidebarSectionId[];
  onSidebarSectionExpandedChange?: (section: SidebarSectionId, expanded: boolean) => void;
};

export function TabNavigationContent({
  tabs,
  tabUi,
  activeTabId,
  agents,
  runnableAgents,
  onSelectTab,
  onReorderTabs,
  onCloseTab,
  onCloseAllChats,
  onNewTabWithAgent,
  onRenameTab,
  onAction,
  onNewTab,
  historyList,
  onOpenRecentConversation,
  pinActionsToBottom = false,
  sidebarExpandedSections,
  onSidebarSectionExpandedChange,
  ...navigationActions
}: TabNavigationContentProps) {
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const {
    listRef: openChatsListRef,
    dropTarget,
    startReordering,
    shouldSuppressClick,
  } = useTabReordering('vertical', onReorderTabs);
  const [pendingDeleteChat, setPendingDeleteChat] = useState<{
    conversationId: string;
    projectPath: string;
  } | null>(null);
  const [openChatsExpanded, setOpenChatsExpanded] = useState(true);
  const itemRole = onAction ? 'menuitem' : undefined;
  const tooltipPlacement = pinActionsToBottom ? 'top' : 'bottom';
  const expandedSections = sidebarExpandedSections ?? DEFAULT_SIDEBAR_EXPANDED_SECTIONS;
  const newChatExpanded = !pinActionsToBottom || expandedSections.includes('new-chat');
  const recentChatsExpanded = !pinActionsToBottom || expandedSections.includes('recent-chats');
  const sectionsExpanded = !pinActionsToBottom || expandedSections.includes('sections');
  const setSectionExpanded = (section: SidebarSectionId, expanded: boolean) => {
    onSidebarSectionExpandedChange?.(section, expanded);
  };
  const handleOpenChatPointerDown = (id: string, event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pinActionsToBottom || event.button !== 0
      || (event.target as HTMLElement).closest('[data-open-chat-action], input')) {
      return;
    }
    startReordering(id, event);
  };
  const historyByConversationId = new Map(
    (historyList ?? []).map((item) => [item.conversationId, item])
  );
  const showOpenChats = tabs.length > 0;
  const openConversationIds = new Set(tabs.map((tab) => tab.historySession?.conversationId || tab.conversationId));
  const recentHistoryList = (historyList ?? []).filter((item) => !openConversationIds.has(item.conversationId));
  const showRecentChats = pinActionsToBottom && recentHistoryList.length > 0 && !!onOpenRecentConversation;
  const recentChats = showRecentChats && onOpenRecentConversation ? (
    <RecentChats
      historyList={recentHistoryList}
      agents={agents}
      onOpenConversation={onOpenRecentConversation}
      onOpenHistory={navigationActions.onOpenHistory}
      expanded={recentChatsExpanded}
      onExpandedChange={(expanded) => setSectionExpanded('recent-chats', expanded)}
    />
  ) : null;

  return (
    <div className={pinActionsToBottom ? 'flex min-h-full flex-col' : undefined}>
      <div className="flex flex-col">
        <div className="order-2">
          {recentChats}
          {showOpenChats && showRecentChats ? <div className="mx-2 my-1 h-px bg-border" /> : null}
          {showOpenChats ? (
            <div className={pinActionsToBottom ? undefined : 'mb-1'}>
              <div className={`flex min-h-7 items-center text-ide-small text-[var(--ide-Label-disabledForeground)] ${
                pinActionsToBottom ? 'pl-3 pr-3' : 'pl-5 pr-3'
              }`}>
                {pinActionsToBottom ? (
                  <button
                    type="button"
                    onClick={() => setOpenChatsExpanded((expanded) => !expanded)}
                    className="flex min-w-0 flex-1 items-center self-stretch text-left focus:outline-none"
                    aria-expanded={openChatsExpanded}
                  >
                    {openChatsExpanded ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
                    <span className="ml-1">Open Chats</span>
                  </button>
                ) : <span className="min-w-0 flex-1">Open Chats</span>}
                {tabs.length > 0 ? (
                  <Tooltip variant="minimal" placement={tooltipPlacement} content="Close all open chats">
                    <button
                      type="button"
                      onClick={() => {
                        onCloseAllChats();
                        onAction?.();
                      }}
                      className="flex h-5 w-6 items-center justify-center rounded text-foreground-secondary
                        hover:text-foreground focus:outline-none
                        focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                      aria-label="Close all open chats"
                      role={itemRole}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </Tooltip>
                ) : null}
              </div>

              <div
                aria-hidden={!openChatsExpanded}
                {...(!openChatsExpanded ? { inert: '' } : {})}
                className={`grid overflow-hidden transition-[grid-template-rows] duration-200 ease-in-out ${
                openChatsExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
              }`}
              >
                <div className="min-h-0 overflow-hidden">
                  <div ref={openChatsListRef} className={pinActionsToBottom ? 'py-1' : undefined}>
                  {tabs.map((tab) => {
                    const flags = tabUi[tab.id];
                    const hasWarning = flags?.warning;
                    const hasProcessing = flags?.processing;
                    const hasUnread = flags?.unread;
                    const hasStatus = hasWarning || hasProcessing || hasUnread;
                    const conversationId = tab.historySession?.conversationId || tab.conversationId;
                    const deleteProjectPath = tab.historySession?.projectPath
                      || historyByConversationId.get(conversationId)?.projectPath;
                    const activeClassName = tab.id === activeTabId
                      ? 'relative text-foreground before:pointer-events-none before:absolute before:inset-0 before:rounded-[4px] before:bg-background before:[filter:var(--ide-surface-active-filter)]'
                      : 'relative text-foreground before:pointer-events-none before:absolute before:inset-0 before:rounded-[4px] before:bg-background before:opacity-0 before:[filter:var(--ide-surface-active-filter)] hover:before:opacity-100 focus-within:before:opacity-100';
                    const statusIndicator = hasWarning ? (
                      <span className="relative z-10 ml-1 mr-3 h-2 w-2 shrink-0 self-center rounded-full bg-warning" />
                    ) : hasProcessing ? (
                      <span className="relative z-10 ml-1 mr-2 flex shrink-0 self-center text-foreground-secondary">
                        <ChatSpinnerIcon size={14} />
                      </span>
                    ) : hasUnread ? (
                      <span className="relative z-10 ml-1 mr-3 h-2 w-2 shrink-0 self-center rounded-full bg-sky-500" />
                    ) : null;

                    return (
                      <div
                        key={tab.id}
                        data-reorder-tab-id={tab.id}
                        onPointerDown={(event) => handleOpenChatPointerDown(tab.id, event)}
                        className={`group mx-2 mb-0.5 flex items-stretch rounded-[4px] ${activeClassName} ${
                          pinActionsToBottom ? 'cursor-grab select-none active:cursor-grabbing' : ''
                        }`}
                      >
                        {dropTarget?.id === tab.id && dropTarget.position === 'before' ? (
                          <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-30 h-px bg-primary" />
                        ) : null}
                        {dropTarget?.id === tab.id && dropTarget.position === 'after' ? (
                          <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-px bg-primary" />
                        ) : null}
                        {renamingTabId === tab.id ? (
                          <div className="relative z-10 flex min-h-8 min-w-0 flex-1 items-center pl-3">
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
                          <button
                            onClick={() => {
                              if (shouldSuppressClick(tab.id)) return;
                              onSelectTab(tab.id);
                              onAction?.();
                            }}
                            className="relative z-10 flex min-h-8 min-w-0 flex-1 items-center rounded-l-[4px] pl-3 pr-2 text-left focus:outline-none
                              focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                            role={itemRole}
                            aria-current={tab.id === activeTabId ? 'page' : undefined}
                          >
                            <span className="mr-2 flex items-center justify-center">
                              {getTabIcon(tab, agents)}
                            </span>
                            <span
                              className="min-w-0 flex-1 truncate"
                              onDoubleClick={() => {
                                setRenamingTabId(tab.id);
                              }}
                            >{tab.title}</span>
                          </button>
                        )}

                        {renamingTabId !== tab.id ? (
                          <div className="relative z-10 w-0 overflow-hidden opacity-0 pointer-events-none
                            group-hover:w-6 group-hover:opacity-100 group-hover:pointer-events-auto
                            group-focus-within:w-6 group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
                          >
                            <Tooltip variant="minimal" placement={tooltipPlacement} content="Rename" className="flex h-full w-6">
                              <button
                                type="button"
                                data-open-chat-action="true"
                                onClick={() => setRenamingTabId(tab.id)}
                                className="flex min-h-8 w-6 shrink-0 items-center justify-center text-foreground-secondary
                                  hover:text-foreground focus:outline-none
                                  focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                                role={itemRole}
                                aria-label={`Rename ${tab.title}`}
                              >
                                <Pencil size={12} strokeWidth={2.5} aria-hidden="true" />
                              </button>
                            </Tooltip>
                          </div>
                        ) : null}

                        {pinActionsToBottom && deleteProjectPath && renamingTabId !== tab.id ? (
                          <div className="relative z-10 w-0 overflow-hidden opacity-0 pointer-events-none
                            group-hover:w-6 group-hover:opacity-100 group-hover:pointer-events-auto
                            group-focus-within:w-6 group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
                          >
                            <Tooltip variant="minimal" placement={tooltipPlacement} content="Delete" className="flex h-full w-6">
                              <button
                                type="button"
                                data-open-chat-action="true"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setPendingDeleteChat({ conversationId, projectPath: deleteProjectPath });
                                }}
                                className="flex min-h-8 w-6 shrink-0 items-center justify-center text-foreground-secondary
                                  hover:text-error focus:outline-none
                                  focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                                aria-label={`Delete ${tab.title}`}
                              >
                                <Trash2 size={13} className="-translate-y-px" aria-hidden="true" />
                              </button>
                            </Tooltip>
                          </div>
                        ) : null}

                        {renamingTabId !== tab.id ? (
                          <div className={`relative z-10 w-0 overflow-hidden opacity-0 pointer-events-none
                            group-hover:w-6 group-hover:opacity-100 group-hover:pointer-events-auto
                            group-focus-within:w-6 group-focus-within:opacity-100 group-focus-within:pointer-events-auto ${
                              hasStatus ? '' : 'group-hover:mr-1 group-focus-within:mr-1'
                            }`}
                          >
                            <Tooltip variant="minimal" placement={tooltipPlacement} content="Close" className="flex h-full w-6">
                              <button
                                type="button"
                                data-open-chat-action="true"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onCloseTab(tab.id);
                                }}
                                className="flex min-h-8 w-6 shrink-0 items-center justify-center rounded-r-[4px]
                                  text-foreground-secondary hover:text-foreground focus:outline-none
                                  focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                                role={itemRole}
                                aria-label={`Close ${tab.title}`}
                              >
                                <X size={14} aria-hidden="true" />
                              </button>
                            </Tooltip>
                          </div>
                        ) : null}
                        {statusIndicator}
                      </div>
                    );
                  })}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className={`order-1 ${pinActionsToBottom ? 'shrink-0' : ''}`}>
          <div className={`flex min-h-7 items-center justify-between text-ide-small text-[var(--ide-Label-disabledForeground)] ${
            pinActionsToBottom ? 'pl-3 pr-3' : 'px-5'
          }`}>
            {pinActionsToBottom ? (
              <button
                type="button"
                onClick={() => setSectionExpanded('new-chat', !newChatExpanded)}
                className="flex min-w-0 flex-1 items-center self-stretch text-left focus:outline-none"
                aria-expanded={newChatExpanded}
              >
                {newChatExpanded ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
                <span className="ml-1">New Chat</span>
              </button>
            ) : <span>New Chat</span>}
            {pinActionsToBottom && onNewTab ? (
              <Tooltip variant="minimal" placement="top" content="New chat">
                <button
                  type="button"
                  onClick={() => {
                    setOpenChatsExpanded(true);
                    onNewTab();
                  }}
                  className="flex h-5 w-6 items-center justify-center rounded text-foreground-secondary
                    hover:bg-hover hover:text-foreground focus:outline-none
                    focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                  aria-label="New chat"
                >
                  <Plus size={14} strokeWidth={2.5} aria-hidden="true" />
                </button>
              </Tooltip>
            ) : null}
          </div>
          <div
            aria-hidden={!newChatExpanded}
            {...(!newChatExpanded ? { inert: '' } : {})}
            className={`grid overflow-hidden transition-[grid-template-rows] duration-200 ease-in-out ${
            newChatExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          }`}
          >
            <div className="min-h-0 overflow-hidden">
              <div className={pinActionsToBottom ? 'py-1' : undefined}>
              {runnableAgents.length > 0 ? (
                runnableAgents.map((agent) => (
                  <div key={agent.id}
                    className="group relative mx-2 mb-0.5 flex items-stretch rounded-[4px] text-foreground
                      before:pointer-events-none before:absolute before:inset-0 before:rounded-[4px] before:bg-background
                      before:opacity-0 before:[filter:var(--ide-surface-active-filter)] hover:before:opacity-100 focus-within:before:opacity-100
                      focus-within:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                  >
                    <button
                      onClick={() => {
                        setOpenChatsExpanded(true);
                        onNewTabWithAgent(agent.id);
                        onAction?.();
                      }}
                      className="relative z-10 flex min-w-0 flex-1 items-center rounded-l-[4px] px-3 min-h-8 text-left focus:outline-none"
                      role={itemRole}
                    >
                      <span className="mr-2 flex items-center justify-center">
                        {getAgentIcon(agent.id, agents)}
                      </span>
                      <span className="flex-1 min-w-0 truncate">{agent.name}</span>
                    </button>
                    {agent.cliAvailable ? (
                      <div className="relative z-10 w-0 overflow-hidden opacity-0 pointer-events-none
                        group-hover:w-8 group-hover:opacity-100 group-hover:pointer-events-auto
                        group-focus-within:w-8 group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
                      >
                        <Tooltip variant="minimal" placement="top" content={`Open ${agent.name} in terminal`} className="flex h-full w-8">
                          <button
                            type="button"
                            onClick={() => {
                              ACPBridge.openAgentCli(agent.id);
                              onAction?.();
                            }}
                            className="flex w-8 items-center justify-center self-stretch text-foreground-secondary
                              hover:text-accent-foreground focus:outline-none focus:text-accent-foreground"
                            role={itemRole}
                          >
                            <Terminal className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </Tooltip>
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="px-5 min-h-8 text-[var(--ide-Label-disabledForeground)] italic">No available agents</div>
              )}
              </div>
            </div>
          </div>
          {pinActionsToBottom ? <div className="mx-2 my-1 h-px bg-border" /> : null}
        </div>
      </div>
      <div className={pinActionsToBottom ? 'mt-auto shrink-0' : undefined}>
        <div className="h-px bg-border my-1 mx-2" />
        {pinActionsToBottom ? (
          <button
            type="button"
            onClick={() => setSectionExpanded('sections', !sectionsExpanded)}
            className="flex min-h-7 w-full items-center px-3 text-left text-ide-small
              text-[var(--ide-Label-disabledForeground)] focus:outline-none
              focus-visible:shadow-[inset_0_0_0_1px_var(--ide-Button-default-focusColor)]"
            aria-expanded={sectionsExpanded}
          >
            {sectionsExpanded ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
            <span className="ml-1">Sections</span>
          </button>
        ) : null}
        <div
          aria-hidden={!sectionsExpanded}
          {...(!sectionsExpanded ? { inert: '' } : {})}
          className={`grid overflow-hidden transition-[grid-template-rows] duration-200 ease-in-out ${
          sectionsExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
        >
          <div className="min-h-0 overflow-hidden">
            <div className={pinActionsToBottom ? 'py-1' : undefined}>
              <NavigationActions
                {...navigationActions}
                onAction={onAction}
              />
            </div>
          </div>
        </div>
      </div>
      <ConfirmationModal
        isOpen={pendingDeleteChat !== null}
        title="Delete Chat"
        message={`Do you want to delete this chat?${pendingDeleteChat && openConversationIds.has(pendingDeleteChat.conversationId)
          ? '\nThis chat is open and will be closed before deletion.' : ''}`}
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
