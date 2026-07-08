import { SendHorizontal, Trash2 } from 'lucide-react';
import { QueuedPrompt } from '../../../hooks/chatSession/promptQueueTypes';
import { Tooltip } from '../shared/Tooltip';

interface PromptQueueListProps {
  items: QueuedPrompt[];
  onRemove: (id: string) => void;
  onChangeText: (id: string, text: string) => void;
  onSendNow: (id: string) => void;
  sendNowCancelsCurrent?: boolean;
}

export function PromptQueueList({ items, onRemove, onChangeText, onSendNow, sendNowCancelsCurrent = false }: PromptQueueListProps) {
  if (items.length === 0) return null;

  return (
    <div className="border-b border-[var(--ide-Button-startBorderColor)]">
      {items.map((item, index) => {
        const disabled = !item.text.trim() && item.attachments.length === 0;
        return (
          <div key={item.id} className="group flex items-center gap-2 px-3 py-1.5 text-ide-small hover:bg-hover">
            <span className="w-5 shrink-0 text-right text-foreground-secondary">{index + 1}.</span>
            <input
              type="text"
              value={item.text}
              onChange={(event) => onChangeText(item.id, event.target.value)}
              className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-foreground-secondary outline-none focus:bg-active-selection/40 focus:text-foreground"
            />
            {item.attachments.length > 0 && (
              <span className="shrink-0 text-foreground-secondary">{item.attachments.length} files</span>
            )}
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              <button
                type="button"
                onClick={() => onSendNow(item.id)}
                disabled={disabled}
                className={`rounded p-0.5 hover:bg-active-selection ${
                  disabled ? 'text-[var(--ide-Label-disabledForeground)]' : 'text-foreground-secondary hover:text-foreground'
                }`}
              >
                <Tooltip variant="minimal" content={disabled ? null : (sendNowCancelsCurrent ? 'Cancel current and send' : 'Send now')}>
                  <SendHorizontal size={13} />
                </Tooltip>
              </button>
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                className="rounded p-0.5 text-foreground-secondary hover:bg-active-selection hover:text-error"
              >
                <Tooltip variant="minimal" content="Remove">
                  <Trash2 size={13} />
                </Tooltip>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
