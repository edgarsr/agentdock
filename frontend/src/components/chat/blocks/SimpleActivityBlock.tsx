import React from 'react';
import { ToolCallBlock } from '../../../types/chat';
import { parseToolStatus } from '../../../utils/toolCallUtils';

const TrashIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
  </svg>
);

const MoveIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="5 9 2 12 5 15"></polyline>
    <polyline points="9 5 12 2 15 5"></polyline>
    <polyline points="15 19 12 22 9 19"></polyline>
    <polyline points="19 9 22 12 19 15"></polyline>
    <line x1="2" y1="12" x2="22" y2="12"></line>
    <line x1="12" y1="2" x2="12" y2="22"></line>
  </svg>
);

interface Props {
  block: ToolCallBlock;
}

export const SimpleActivityBlock: React.FC<Props> = ({ block }) => {
  const { isPending, isError } = parseToolStatus(block.entry.status);

  const kind = block.entry.kind;
  const title = block.entry.title || (kind === 'delete' ? 'Deleting file...' : 'Moving file...');

  return (
    <div className="border border-border rounded-[6px] overflow-hidden">
      <div className="flex items-center gap-2 w-full px-3 py-2 bg-editor-bg">
        <div className="flex-shrink-0 text-editor-fg opacity-70 relative top-[-1px]">
          {kind === 'delete' ? <TrashIcon size={14} /> : <MoveIcon size={14} />}
        </div>
        <div className="flex-1 text-left font-mono truncate text-editor-fg opacity-90 pr-2">
          {title}
        </div>
        <div className="flex-shrink-0">
          {(isPending || isError) && (
            <div className={`w-2.5 h-2.5 rounded-full ${isPending ? 'bg-warning animate-pulse' : 'bg-error'}`}/>
          )}
        </div>
      </div>
    </div>
  );
};
