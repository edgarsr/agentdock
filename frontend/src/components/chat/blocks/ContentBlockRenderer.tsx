import React from 'react';
import { RichContentBlock } from '../../../types/chat';
import { ThinkingBlock } from './ThinkingBlock';
import { MarkdownMessage } from '../MarkdownMessage';

interface Props {
  block: RichContentBlock;
}

export const ContentBlockRenderer: React.FC<Props> = ({ block }) => {
  switch (block.type) {
    case 'text':
      return <MarkdownMessage content={block.text} />;
    case 'thinking':
      return <ThinkingBlock block={block} />;
    case 'image':
      return (
        <div className="my-2 rounded-lg overflow-hidden border border-[var(--ide-Borders-color)] shadow-sm max-w-sm">
          <img 
            src={block.data.startsWith('data:') ? block.data : `data:${block.mimeType};base64,${block.data}`} 
            alt="AI Attachment" 
            className="w-full h-auto cursor-zoom-in"
            onClick={() => {
              // Placeholder for image zoom if needed
            }}
          />
        </div>
      );
    default:
      return null;
  }
};
