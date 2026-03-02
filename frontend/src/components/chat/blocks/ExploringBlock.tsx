import React, { useState, useEffect, useRef } from 'react';
import { ExploringBlock as ExploringBlockType, ToolCallEntry } from '../../../types/chat';
import { ChevronRight } from 'lucide-react';
import { ReadActivity } from './ReadActivity';
import { FetchActivity } from './FetchActivity';
import { SearchActivity } from './SearchActivity';
import { ThinkingActivity } from './ThinkingActivity';

interface Props {
  block: ExploringBlockType;
}

function buildLabel(entries: ToolCallEntry[], isStreaming: boolean): string {
  const uniqueEntries = new Map<string, ToolCallEntry>();
  for (const e of entries) {
    uniqueEntries.set(e.toolCallId, e);
  }

  let thoughts = 0;
  let files = 0;
  let searches = 0;
  let fetches = 0;

  for (const e of uniqueEntries.values()) {
    switch (e.kind) {
      case 'thinking': thoughts++; break;
      case 'read': files++; break;
      case 'search': searches++; break;
      case 'fetch': fetches++; break;
    }
  }

  const onlyThinking = thoughts > 0 && files === 0 && searches === 0 && fetches === 0;

  if (onlyThinking) {
    return isStreaming ? 'Thinking' : 'Thought';
  }

  // While streaming, don't show detailed summary
  if (isStreaming) {
    return 'Exploring';
  }

  // Build summary for finished state (no thoughts)
  const parts: string[] = [];
  if (files > 0) parts.push(`${files} ${files === 1 ? 'file' : 'files'}`);
  if (searches > 0) parts.push(`${searches} ${searches === 1 ? 'search' : 'searches'}`);
  if (fetches > 0) parts.push(`${fetches} ${fetches === 1 ? 'fetch' : 'fetches'}`);

  const summary = parts.length > 0 ? ` (${parts.join(', ')})` : '';
  return `Explored${summary}`;
}

export const ExploringBlock: React.FC<Props> = ({ block }) => {
  const [isExpanded, setIsExpanded] = useState(block.isStreaming);
  const wasStreamingRef = useRef(block.isStreaming);

  useEffect(() => {
    if (wasStreamingRef.current && !block.isStreaming) {
      setIsExpanded(false);
      wasStreamingRef.current = false;
    }
  }, [block.isStreaming]);

  const handleOpenFile = (path: string, line?: number) => {
    if (window.__openFile) {
      window.__openFile(JSON.stringify({
        filePath: path,
        line: line !== undefined ? Math.max(0, line - 1) : undefined
      }));
    }
  };

  const handleOpenUrl = (url: string) => {
    if (window.__openUrl) {
      window.__openUrl(url);
    } else {
      window.open(url, '_blank');
    }
  };

  const label = buildLabel(block.entries, block.isStreaming);

  return (
    <div className="w-full min-w-0 max-w-full overflow-hidden">
      <button
        onClick={() => setIsExpanded(v => !v)}
        className="flex items-center gap-1.5 py-1 text-[var(--ide-Label-foreground)] hover:text-foreground transition-colors opacity-80 hover:opacity-100 font-medium max-w-full focus:outline-none"
      >
        <span className="truncate">{label}</span>
        <span className={`transition-transform duration-200 flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}>
          <ChevronRight size={14} />
        </span>
      </button>

      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out w-full min-w-0 overflow-hidden`}
        style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
      >
        <div className="font-normal w-full min-w-0 overflow-hidden">
          <div className="pl-4 pr-4 py-1 space-y-1 w-full min-w-0">
            {block.entries.map((entry, i) => {
              if (entry.kind === 'thinking') {
                return <ThinkingActivity key={entry.toolCallId || i} entry={entry} />;
              }
              if (entry.kind === 'read') {
                return <ReadActivity key={entry.toolCallId || i} entry={entry} onOpenFile={handleOpenFile} />;
              }
              if (entry.kind === 'fetch') {
                return <FetchActivity key={entry.toolCallId || i} entry={entry} onOpenUrl={handleOpenUrl} />;
              }
              if (entry.kind === 'search') {
                return <SearchActivity key={entry.toolCallId || i} entry={entry} />;
              }
              return null;
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
