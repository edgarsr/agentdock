import type * as React from 'react';
import { useState } from 'react';
import { EllipsisVertical, Pencil, Pin, SquareTerminal, Trash2 } from 'lucide-react';
import { ACPBridge } from '../../utils/bridge';
import type { AgentOption, HistorySessionMeta, TabUiFlags } from '../../types/chat';
import { Checkbox } from '../ui/Checkbox';
import { PopupMenu, popupMenuActions } from '../ui/PopupMenu';
import { ChatStatusIndicator, PinIcon } from '../tabbar/OpenChatList';
import { Tooltip } from '../chat/shared/Tooltip';
import { SectionRowButton, sectionRowButtonClassName } from '../ui/SectionList';
import { TabTitleInput } from '../tabbar/TabTitleInput';
import { getAgentIcon } from '../tabbar/TabIcons';
import { searchPattern } from '../chat/ChatSearch';
import { HighlightedText } from './HighlightedText';
import { archiveAction, moveToGroupAction } from './historyGroups';

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

interface HistoryListItemProps {
  item: HistorySessionMeta;
  agents: AgentOption[];
  /** Shows the checkbox. */
  isSelecting: boolean;
  isSelected: boolean;
  /** Open as a chat; resuming in the terminal suits only closed chats. */
  isOpen: boolean;
  /** The open chat's status, shown after the title. */
  status?: TabUiFlags;
  conversationLength: string | null;
  groups: string[];
  /** Shows the conversation's group, while the list is not limited to one. */
  showGroup: boolean;
  deleteError?: string;
  /** Marked in the title and the snippet. */
  searchQuery: string;
  /** The conversation's text around a match of the search. */
  snippet?: string;
  isEditing: boolean;
  formatDate: (ms: number) => string;
  onOpenSession: (session: HistorySessionMeta) => void;
  onEditingChange: (editing: boolean) => void;
  onOpenDeleteConfirmation: (items: HistorySessionMeta[]) => void;
  onToggleSelection: (conversationId: string) => void;
}

export function HistoryListItem({
  item,
  agents,
  isSelecting,
  isSelected,
  isOpen,
  status,
  conversationLength,
  groups,
  showGroup,
  deleteError,
  searchQuery,
  snippet,
  isEditing,
  formatDate,
  onOpenSession,
  onEditingChange,
  onOpenDeleteConfirmation,
  onToggleSelection,
}: HistoryListItemProps) {
  const conversationId = item.conversationId;
  // In the order last used, the current agent last.
  const itemAgents = item.allAdapterNames?.length ? item.allAdapterNames : [item.adapterName];
  const previousAgents = itemAgents.filter((agentId) => agentId !== item.adapterName);
  const mainAgent = agents.find((agent) => agent.id === item.adapterName);
  const canOpenCli = !isOpen && !!mainAgent?.cliResumeAvailable;
  const canDelete = item.deletable !== false;
  const query = searchQuery.trim();
  const activate = () => onOpenSession(item);
  // Shown until the history list brings the new title, so the old one does not flash back.
  const [renamed, setRenamed] = useState<{ from: string; to: string } | null>(null);
  const title = renamed?.from === item.title ? renamed.to : item.title;

  return (
    <div className="group relative border-b border-border last:border-b-0">
      <div className="min-h-[56px] flex items-center gap-3 py-1">
        <div
          role="button"
          tabIndex={isEditing ? -1 : 0}
          className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] content-center gap-x-2 pt-0.5 pb-1.5 cursor-pointer rounded-[4px]
            focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] focus-visible:outline-none"
          onClick={() => { if (!isEditing) activate(); }}
          onKeyDown={(event) => handleHistoryRowKeyDown(event, isEditing, activate)}
        >
          {/* The current agent before the title; the previous ones lead the details below it. */}
          <span className="flex self-center pt-0.5 pb-1 opacity-80">{getAgentIcon(item.adapterName, agents)}</span>
          {isEditing ? (
            // As tall as the title below, so the editor does not move it or the details.
            <div className="flex pb-0.5">
              <TabTitleInput
                initialTitle={title}
                onCommit={(newTitle) => {
                  setRenamed({ from: item.title, to: newTitle });
                  ACPBridge.updateHistoryConversations(item.projectPath, [conversationId], { newTitle });
                }}
                onClose={() => onEditingChange(false)}
                className="-ml-1 rounded-[3px] bg-background px-1 py-0.5 font-semibold"
              />
            </div>
          ) : (
            <div className="flex min-w-0 items-center pt-0.5 pb-1 text-ide-small font-semibold">
              <span className="truncate">
                <HighlightedText text={title} pattern={query ? searchPattern(query) : null} />
              </span>
              <ChatStatusIndicator flags={status} className="ml-1" />
            </div>
          )}
          <div className="col-start-2 flex items-center gap-2 text-xs text-foreground-secondary">
            {previousAgents.length > 0 ? (
              <span className="flex shrink-0 items-center gap-1.5 opacity-80">
                {previousAgents.map((agentId) => (
                  <span key={agentId} className="flex">{getAgentIcon(agentId, agents, 'h-3.5 w-3.5')}</span>
                ))}
              </span>
            ) : null}
            <span>{formatDate(item.updatedAt)}</span>
            {conversationLength || item.modelId ? <span className="opacity-50">&bull;</span> : null}
            {conversationLength ? <span>{conversationLength}</span> : null}
            {item.modelId ? <span>{item.modelId}</span> : null}
            {showGroup && item.group ? (
              <>
                <span className="opacity-50">&bull;</span>
                <span className="min-w-0 truncate">{item.group}</span>
              </>
            ) : null}
          </div>
          {snippet ? (
            <div className="col-start-2 mt-0.5 line-clamp-2 text-xs text-foreground-secondary">
              <HighlightedText text={snippet} pattern={searchPattern(query.replace(/\s+/g, ' '), true)} />
            </div>
          ) : null}
          {deleteError ? <div className="col-start-2 mt-1 text-xs text-error">{deleteError}</div> : null}
        </div>

        <div className="flex shrink-0 items-center self-stretch relative ml-2" onClick={(e) => e.stopPropagation()}>
          <PopupMenu
            inline
            renderTrigger={(trigger) => (
              <Tooltip variant="minimal" content="More actions">
                <button
                  type="button"
                  aria-label={`More actions for ${title}`}
                  {...trigger}
                  className={sectionRowButtonClassName}
                >
                  <EllipsisVertical className="h-4 w-4" />
                </button>
              </Tooltip>
            )}
          >
            {popupMenuActions([
              { label: 'Rename', icon: <Pencil size={12} aria-hidden="true" />, onClick: () => onEditingChange(true) },
              ...(item.pinned ? [] : [{
                label: 'Pin',
                icon: <PinIcon pinned={false} />,
                onClick: () => ACPBridge.updateHistoryConversations(item.projectPath, [conversationId], { pinned: true }),
              }]),
              moveToGroupAction(item, groups),
              ...(canOpenCli ? [{
                label: 'Open in terminal',
                icon: <SquareTerminal size={12} aria-hidden="true" />,
                onClick: () => ACPBridge.openHistoryConversationCli(item.projectPath, conversationId),
              }] : []),
              archiveAction(item),
              ...(canDelete ? [{
                label: 'Delete',
                icon: <Trash2 size={12} aria-hidden="true" />,
                onClick: () => onOpenDeleteConfirmation([item]),
              }] : []),
            ], true)}
          </PopupMenu>

          {item.pinned ? (
            <SectionRowButton
              label="Unpin chat"
              onClick={() => ACPBridge.updateHistoryConversations(item.projectPath, [conversationId], { pinned: false })}
              className="mr-1"
            >
              <Pin className="h-3.5 w-3.5 rotate-45" fill="currentColor" />
            </SectionRowButton>
          ) : null}

          {isSelecting ? (
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggleSelection(conversationId)}
              onClick={(e) => e.stopPropagation()}
              className="!top-0 ml-1"
              aria-label={`Select ${title}`}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
