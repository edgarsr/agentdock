import React from 'react';
import { ToolCallEntry } from '../../../types/chat';
import { ActivityTooltip } from './ActivityTooltip';
import { safeParseJson } from '../../../utils/toolCallUtils';

interface Props {
  entry: ToolCallEntry;
  onOpenUrl: (url: string) => void;
}

const GlobeIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"></circle>
    <line x1="2" y1="12" x2="22" y2="12"></line>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
  </svg>
);

const WebSearchIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"></circle>
    <line x1="3" y1="11" x2="19" y2="11"></line>
    <path d="M11 3a12 12 0 0 1 0 16"></path>
    <path d="M11 3a12 12 0 0 0 0 16"></path>
    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
  </svg>
);

function extractUrl(title: string | undefined, rawInput: Record<string, any> | undefined): string | undefined {
  const cleanTitle = title?.replace(/^"(.*)"$/, '$1') || title;
  const urlMatch = cleanTitle?.match(/https?:\/\/[^\s"']+/);
  let url = urlMatch?.[0] || rawInput?.url;
  if (url) {
    url = url.replace(/[.,"'>)]+$/, '');
  }
  return url;
}

export const FetchActivity: React.FC<Props> = ({ entry, onOpenUrl }) => {
  const parsed = safeParseJson(entry.rawJson);
  const rawInput = parsed?.rawInput;
  const cleanTitle = entry.title?.replace(/^"(.*)"$/, '$1') || entry.title;
  const url = extractUrl(entry.title, rawInput);
  const isSearch = !!rawInput?.query;

  const status = (entry.status || '').toLowerCase();
  const hasError = status === 'error' || status === 'failed';

  const icon = (
    <span className="text-[var(--ide-Label-foreground)] opacity-70 flex-shrink-0">
      {isSearch ? <WebSearchIcon size={13} /> : <GlobeIcon size={13} />}
    </span>
  );

  const tooltipContent = (
    <>
      {isSearch ? (
        <div className="font-semibold mb-0.5">Web search: {rawInput.query}</div>
      ) : (
        <div className="font-semibold mb-0.5">{cleanTitle}</div>
      )}
      {rawInput?.prompt && <div className="opacity-80 italic line-clamp-3 mt-0.5">Prompt: {rawInput.prompt}</div>}
    </>
  );

  if (!url) {
    if (isSearch) {
      return (
        <ActivityTooltip icon={icon} content={tooltipContent}>
          <span className="text-foreground/60 truncate min-w-0 flex-1 block">{cleanTitle || entry.kind}</span>
          {hasError && (
            <div className="w-1.5 h-1.5 rounded-full bg-error flex-shrink-0 ml-1" />
          )}
        </ActivityTooltip>
      );
    }
    return (
      <div className="flex items-center gap-1.5 py-0.5 min-w-0 w-full">
        {icon}
        <span className="text-foreground/60 truncate min-w-0 flex-1 block">{cleanTitle || entry.kind}</span>
        {hasError && (
          <div className="w-1.5 h-1.5 rounded-full bg-error flex-shrink-0" />
        )}
      </div>
    );
  }

  const displayUrl = url.replace(/^https?:\/\//, '');

  return (
    <ActivityTooltip icon={icon} content={tooltipContent}>
      <button
        onClick={() => onOpenUrl(url)}
        className="text-[var(--ide-Label-foreground)] hover:text-[var(--ide-Link-foreground)] hover:underline transition-colors text-left font-normal truncate min-w-0 flex-1"
      >
        {displayUrl}
      </button>
      {hasError && (
        <div className="w-1.5 h-1.5 rounded-full bg-error flex-shrink-0 ml-1" />
      )}
    </ActivityTooltip>
  );
};
