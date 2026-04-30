import React from 'react';
import { RichContentBlock } from '../../../types/chat';
import { ExploringBlock } from './ExploringBlock';
import { ExecuteBlock } from './ExecuteBlock';
import { SubAgentBlock } from './SubAgentBlock';
import { SimpleActivityBlock } from './SimpleActivityBlock';
import { EditBlock } from './EditBlock';
import { OtherToolBlock } from './OtherToolBlock';
import { PlanBlockComponent } from './PlanBlock';
import { MarkdownMessage } from '../MarkdownMessage';

interface Props {
  block: RichContentBlock;
  isActivePrompt?: boolean;
}

export const ContentBlockRenderer: React.FC<Props> = ({ block, isActivePrompt = false }) => {
  switch (block.type) {
    case 'text':
      return <MarkdownMessage content={block.text} enableCodeCopy />;
    case 'exploring':
      return <ExploringBlock block={block} isActivePrompt={isActivePrompt} />;
    case 'tool_call':
      if (block.entry.kind === 'execute') {
        return <ExecuteBlock block={block} isActivePrompt={isActivePrompt} />;
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
      return <OtherToolBlock block={block} />;
    case 'plan':
      return <PlanBlockComponent block={block} />;
    case 'image':
      return (
        <div className="rounded-lg overflow-hidden border border-[var(--ide-Borders-color)] shadow-sm max-w-sm">
          <img
            src={block.data.startsWith('data:') ? block.data : `data:${block.mimeType};base64,${block.data}`}
            alt="AI Attachment"
            className="w-full h-auto"
          />
        </div>
      );
    case 'audio':
      return (
        <div className="rounded-lg overflow-hidden border border-[var(--ide-Borders-color)] shadow-sm max-w-md">
          <audio controls
            src={block.data.startsWith('data:') ? block.data : `data:${block.mimeType};base64,${block.data}`}
            className="w-full"
          />
        </div>
      );
    case 'video':
      return (
        <div className="rounded-lg overflow-hidden border border-[var(--ide-Borders-color)] shadow-sm max-w-md">
          <video controls
            src={block.data.startsWith('data:') ? block.data : `data:${block.mimeType};base64,${block.data}`}
            className="w-full h-auto"
          />
        </div>
      );
    default:
      return null;
  }
};
