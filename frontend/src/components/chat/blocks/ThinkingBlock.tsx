import React, { useState, useEffect } from 'react';
import { ThinkingBlock as ThinkingBlockType } from '../../../types/chat';
import { MarkdownMessage } from '../MarkdownMessage';

const ChevronRight = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
);

interface Props {
  block: ThinkingBlockType;
}

export const ThinkingBlock: React.FC<Props> = ({ block }) => {
  const [isExpanded, setIsExpanded] = useState(block.isStreaming ?? false);

  // Auto-expand/collapse based on streaming status
  useEffect(() => {
    setIsExpanded(block.isStreaming ?? false);
  }, [block.isStreaming]);

  const label = block.isStreaming ? 'Thinking' : 'Thoughts';

  // Format standalone **Thoughts** lines to semantic <h4> headings for cleaner unified layout
  const processedText = block.text.replace(/^\*\*(.*?)\*\*\s*\n+/gm, '#### $1\n\n');

  return (
    <div className="my-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 py-1 text-[13px] text-[var(--ide-Label-foreground)] hover:text-foreground transition-colors opacity-80 hover:opacity-100 font-medium"
      >
        <span className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
           <ChevronRight size={14} />
        </span>
        <span>{label}</span>
      </button>
      
      <div 
        className={`grid transition-all duration-300 ease-in-out ${isExpanded ? 'grid-rows-[1fr] opacity-80' : 'grid-rows-[0fr] opacity-0'}`}
      >
        <div className="overflow-hidden">
          <div className="pl-6 pr-3 py-2 leading-relaxed text-[13px] [&_h4]:font-semibold [&_h4]:mt-4 [&_h4]:mb-1 [&_h4:first-child]:mt-0 [&_p]:mb-4 [&_p:last-child]:mb-0">
            <MarkdownMessage content={processedText} />
          </div>
        </div>
      </div>
    </div>
  );
};
