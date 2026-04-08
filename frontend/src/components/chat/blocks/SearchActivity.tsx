import React from 'react';
import { ToolCallEntry } from '../../../types/chat';
import { Tooltip } from '../shared/Tooltip';
import { safeParseJson } from '../../../utils/toolCallUtils';

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
  const parsed = safeParseJson(entry.rawJson);
  const query = typeof parsed?.rawInput?.query === 'string' && parsed.rawInput.query.trim()
    ? parsed.rawInput.query.trim()
    : '';
  const query2 = typeof parsed?.rawInput?.path === 'string' && typeof parsed?.rawInput?.pattern === 'string'
      ? parsed.rawInput.path.trim() + ' | ' + parsed.rawInput.pattern.trim()
      : '';
  const pattern = parsed?.rawInput?.pattern;
  const cleanTitle = entry.title?.replace(/^"(.*)"$/, '$1') || entry.title;
  const tooltipText = query || query2 || pattern || cleanTitle || entry.kind;
  const status = (entry.status || '').toLowerCase();
  const hasError = status === 'error' || status === 'failed';

  return (
    <Tooltip variant="minimal" content={`Search: ${tooltipText}`}>
      <div className="flex items-center gap-1.5 min-w-0 cursor-help pr-2">
        <div className="text-foreground-secondary flex-shrink-0"><SearchIcon size={13} /></div>
        <span className="text-foreground-secondary truncate min-w-0 flex-1 block">
          {cleanTitle || pattern || entry.kind}
        </span>
        {hasError && (<div className="w-1.5 h-1.5 rounded-full bg-error flex-shrink-0" />)}
      </div>
    </Tooltip>
  );
};
