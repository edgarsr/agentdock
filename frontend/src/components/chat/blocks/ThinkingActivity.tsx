import React from 'react';
import { ToolCallEntry } from '../../../types/chat';

interface Props {
  entry: ToolCallEntry;
}

const BrainIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"></path>
    <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"></path>
  </svg>
);

export const ThinkingActivity: React.FC<Props> = ({ entry }) => {
  return (
    <div className="flex items-start gap-1.5 text-[12px] py-1 min-w-0 w-full">
      <div className="flex-shrink-0 text-[var(--ide-Label-foreground)] opacity-60 mt-0.5">
        <BrainIcon size={13} />
      </div>
      <div className="flex-1">
        {entry.text || 'Thinking...'}
      </div>
    </div>
  );
};
