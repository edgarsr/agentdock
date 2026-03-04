import React from 'react';
import { ToolCallEntry } from '../../../types/chat';
import { Tooltip } from '../shared/Tooltip';

interface Props {
  entry: ToolCallEntry;
}

const SearchIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"></circle>
    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
  </svg>
);

export const SearchActivity: React.FC<Props> = ({ entry }) => {
  const cleanTitle = entry.title?.replace(/^"(.*)"$/, '$1') || entry.title;
  const status = (entry.status || '').toLowerCase();
  const hasError = status === 'error' || status === 'failed';

  return (
    <Tooltip content={<span>Search: {cleanTitle}</span>}>
      <div className="flex items-center gap-1.5 ml-0.5 py-0.5 min-w-0 group/activity cursor-help pr-2">
        <div className="flex-shrink-0 mt-[-2px] opacity-70 group-hover/activity:opacity-100 transition-opacity">
          <SearchIcon size={13} />
        </div>
        <span className="text-foreground opacity-60 truncate min-w-0 flex-1 block">
          {cleanTitle || entry.kind}
        </span>
        {hasError && (
          <div className="w-1.5 h-1.5 rounded-full bg-error flex-shrink-0 ml-1" />
        )}
      </div>
    </Tooltip>
  );
};
