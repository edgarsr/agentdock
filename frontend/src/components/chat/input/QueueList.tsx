import { Trash2, SendHorizontal } from 'lucide-react';
import { QueuedPrompt } from '../../../types/chat';
import { Tooltip } from '../shared/Tooltip';

interface QueueListProps {
  items: QueuedPrompt[];
  onRemove: (id: string) => void;
  onChangeText: (id: string, text: string) => void;
  onSendNow: (id: string) => void;
}

export function QueueList({ items, onRemove, onChangeText, onSendNow }: QueueListProps) {
  if (items.length === 0) return null;

  return (
    <div className="border-b border-[var(--ide-Button-startBorderColor)]">
      {items.map((item, index) => (
        <div
          key={item.id}
          className="group flex items-start gap-2 px-3 py-1.5 text-ide-small hover:bg-hover"
        >
          <span className="mt-1 shrink-0 text-foreground-secondary">{index + 1}.</span>
          <input
            type="text"
            value={item.text}
            onChange={(e) => onChangeText(item.id, e.target.value)}
            className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-foreground-secondary outline-none focus:bg-active-selection/40 focus:text-foreground"
          />
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              onClick={() => onSendNow(item.id)}
              disabled={!item.text.trim() && item.attachments.length === 0}
              className="rounded p-0.5 text-foreground-secondary hover:bg-active-selection hover:text-foreground"
            >
              <Tooltip variant="minimal" content="Send now">
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
      ))}
    </div>
  );
}
