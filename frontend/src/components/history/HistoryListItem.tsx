import { Check, Pencil, Terminal, Trash2, X } from 'lucide-react';
import { ACPBridge } from '../../utils/bridge';
import type { AgentOption, HistorySessionMeta } from '../../types/chat';
import { Checkbox } from '../ui/Checkbox';
import { Tooltip } from '../chat/shared/Tooltip';

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

interface HistoryListItemProps {
  item: HistorySessionMeta;
  adapterDisplay: Map<string, AgentOption>;
  isSelected: boolean;
  conversationLength: string | null;
  deleteError?: string;
  editingId: string | null;
  editTitle: string;
  formatDate: (ms: number) => string;
  onOpenSession: (session: HistorySessionMeta) => void;
  onEditTitleChange: (title: string) => void;
  onEditKeyDown: (event: React.KeyboardEvent<HTMLInputElement>, projectPath: string, conversationId: string) => void;
  onSubmitRename: (projectPath: string, conversationId: string) => void;
  onCancelEdit: () => void;
  onStartEditing: (item: HistorySessionMeta, event: React.MouseEvent) => void;
  onOpenDeleteConfirmation: (items: HistorySessionMeta[]) => void;
  onToggleSelection: (conversationId: string) => void;
}

export function HistoryListItem({
  item,
  adapterDisplay,
  isSelected,
  conversationLength,
  deleteError,
  editingId,
  editTitle,
  formatDate,
  onOpenSession,
  onEditTitleChange,
  onEditKeyDown,
  onSubmitRename,
  onCancelEdit,
  onStartEditing,
  onOpenDeleteConfirmation,
  onToggleSelection,
}: HistoryListItemProps) {
  const conversationId = item.conversationId;
  const itemAgents = getItemAgents(item);
  const otherAgents = itemAgents.filter(a => a !== item.adapterName);
  const mainAgent = adapterDisplay.get(item.adapterName);
  const mainLabel = mainAgent?.name || item.adapterName;
  const canOpenCli = !!mainAgent?.cliAvailable;
  const isEditing = editingId === conversationId;

  return (
    <div className="group relative">
      <div className="min-h-[56px] border-b border-border flex items-center gap-3 max-[400px]:gap-2 py-1 px-4">
        <div
          role="button"
          tabIndex={isEditing ? -1 : 0}
          className="flex min-w-0 flex-1 items-center gap-3 max-[400px]:gap-2 cursor-pointer rounded-[4px]
            focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] focus-visible:outline-none"
          onClick={() => { if (!isEditing) onOpenSession(item); }}
          onKeyDown={(event) => handleHistoryRowKeyDown(event, isEditing, () => onOpenSession(item))}
        >
          <div className="flex flex-col items-center shrink-0 gap-0.5 pt-0.5 mx-0.5 max-[350px]:hidden">
            {mainAgent?.iconPath ? (
              <img src={mainAgent.iconPath} alt={mainLabel} className="h-7 w-7 object-contain opacity-80" />
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
                    return <img key={idx} src={adapter.iconPath} alt={iconLabel} className="h-4 w-4 object-contain
                      opacity-80 group-hover:opacity-100 transition-opacity" />;
                  }
                  return (
                    <div key={idx} className="flex h-4 min-w-4 items-center justify-center rounded bg-background
                      border border-border text-[9px] font-bold uppercase shrink-0 opacity-70 group-hover:opacity-100">
                      {iconLabel.slice(0, 1)}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1 flex flex-col justify-center py-0.5">
            {isEditing ? (
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <input
                  type="text"
                  spellCheck={false}
                  autoFocus
                  value={editTitle}
                  onChange={(e) => onEditTitleChange(e.target.value)}
                  onKeyDown={(e) => onEditKeyDown(e, item.projectPath, conversationId)}
                  className="-ml-1 h-auto min-w-0 flex-1 border-none bg-background px-1 py-0.5 text-ide-small focus:border-none focus:shadow-none border-none"
                />
                <button
                  onClick={(e) => { e.stopPropagation(); onSubmitRename(item.projectPath, conversationId); }}
                  className="rounded border border-[var(--ide-Button-startBorderColor)] bg-background p-1
                    text-foreground-secondary transition-colors hover:text-primary
                    focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] focus-visible:outline-none"
                >
                  <Check size={14} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onCancelEdit(); }}
                  className="rounded border border-[var(--ide-Button-startBorderColor)] bg-background p-1
                    text-foreground-secondary transition-colors hover:text-error
                    focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] focus-visible:outline-none"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="py-0.5 text-ide-small font-semibold truncate">{item.title}</div>
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

        <div className="flex shrink-0 items-center self-stretch gap-1 relative z-10 ml-2" onClick={(e) => e.stopPropagation()}>
          <Tooltip variant="minimal" content="Rename chat">
            <button
              onClick={(e) => onStartEditing(item, e)}
              className="m-0.5 rounded-[4px] p-0.5 text-foreground-secondary opacity-0 transition-opacity
                hover:text-primary group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100
                focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] focus-visible:outline-none"
            >
              <Pencil className="w-4 h-4" />
            </button>
          </Tooltip>

          <Tooltip variant="minimal" content="Delete chat">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenDeleteConfirmation([item]);
              }}
              className="m-0.5 rounded-[4px] p-0.5 text-foreground-secondary opacity-0 transition-opacity
                hover:text-error group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100
                focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] focus-visible:outline-none"
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
                className="m-0.5 rounded-[4px] p-0.5 text-foreground-secondary opacity-0 transition-opacity
                  hover:text-primary group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100
                  focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] focus-visible:outline-none"
              >
                <Terminal className="w-5 h-5" />
              </button>
            </Tooltip>
          )}

          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleSelection(conversationId)}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 ml-2 mt-[-2px]"
            aria-label={`Select ${item.title}`}
          />
        </div>
      </div>
    </div>
  );
}
