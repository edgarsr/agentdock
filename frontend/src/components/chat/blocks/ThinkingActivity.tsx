import React from 'react';
import { Brain } from 'lucide-react';
import { ToolCallEntry } from '../../../types/chat';
import { MarkdownMessage } from '../MarkdownMessage';

interface Props {
  entry: ToolCallEntry;
}

export const ThinkingActivity: React.FC<Props> = ({ entry }) => {
  return (
    <div className="flex items-start gap-1.5 min-w-0 w-full">
      <div className="flex-shrink-0 relative top-[2.5px] text-foreground-secondary">
        <Brain size={13} strokeWidth={1.8} />
      </div>
      <div className="flex-1 min-w-0 overflow-hidden [&_.markdown-body]:my-0">
        <MarkdownMessage content={entry.text || 'Thinking...'} />
      </div>
    </div>
  );
};
