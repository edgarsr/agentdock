import React from 'react';
import { RichContentBlock } from '../../../types/chat';
import { Wrench } from 'lucide-react';
import { ExploringBlock } from './ExploringBlock';
import { ExecuteBlock } from './ExecuteBlock';
import { SubAgentBlock } from './SubAgentBlock';
import { SimpleActivityBlock } from './SimpleActivityBlock';
import { EditBlock } from './EditBlock';
import { MarkdownMessage } from '../MarkdownMessage';

interface Props {
  block: RichContentBlock;
}

export const ContentBlockRenderer: React.FC<Props> = ({ block }) => {
  switch (block.type) {
    case 'text':
      return <MarkdownMessage content={block.text} />;
    case 'exploring':
      return <ExploringBlock block={block} />;
    case 'tool_call':
      if (block.entry.kind === 'execute') {
        return <ExecuteBlock block={block} />;
      }
      if (block.entry.kind === 'think') {
        return <SubAgentBlock block={block} />;
      }
      if (block.entry.kind === 'delete' || block.entry.kind === 'move') {
        return <SimpleActivityBlock block={block} />;
      }
      if (block.entry.kind === 'edit') {
        return <EditBlock block={block} />;
      }
      return (
        <div className="my-2 border border-border rounded-md overflow-hidden shadow-sm">
          <div className="flex items-center gap-2 w-full px-3 py-2 bg-editor-bg">
            <div className="flex-shrink-0 text-editor-fg opacity-70">
              <Wrench size={14} />
            </div>
            <div className="flex-1 text-left text-[12px] font-mono truncate text-editor-fg opacity-90 pr-2">
              {block.entry.title || block.entry.kind}
            </div>
          </div>
        </div>
      );
    case 'image':
      return (
        <div className="my-2 rounded-lg overflow-hidden border border-[var(--ide-Borders-color)] shadow-sm max-w-sm">
          <img
            src={block.data.startsWith('data:') ? block.data : `data:${block.mimeType};base64,${block.data}`}
            alt="AI Attachment"
            className="w-full h-auto"
          />
        </div>
      );
    default:
      return null;
  }
};
