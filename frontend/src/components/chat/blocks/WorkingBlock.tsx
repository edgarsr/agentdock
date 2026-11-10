import React, { useState, useEffect } from 'react';
import { ExploringBlock, ToolCallBlock, ToolCallEntry } from '../../../types/chat';
import { ChevronRight, Move, Trash } from 'lucide-react';
import { ReadActivity } from './ReadActivity';
import { FetchActivity } from './FetchActivity';
import { SearchActivity } from './SearchActivity';
import { ThinkingActivity } from './ThinkingActivity';
import { ExecuteActivity } from './ExecuteActivity';
import { EditActivity } from './EditActivity';
import { ExpandableActivity } from './ExpandableActivity';
import { LineChanges } from '../shared/LineChanges';
import { countEditChanges } from '../../../utils/editDiff';
import { OtherActivity } from './OtherActivity';
import { ToolOutputImage } from './ToolOutputImage';
import { safeParseJson } from '../../../utils/toolCallUtils';
import { extractToolCallImages, toolCallImageKey } from '../../../utils/toolCallImages';
import { chatFocusClassName } from '../shared/focusStyles';

interface Props {
  // Consecutive exploring blocks and edit, delete and move tool calls.
  blocks: Array<ExploringBlock | ToolCallBlock>;
  isOpen: boolean;
  isActivePrompt?: boolean;
  onImageClick?: (src: string) => void;
}

// Entry kinds with their own activity rows; all other kinds render as OtherActivity.
const ACTIVITY_KINDS = ['thinking', 'read', 'fetch', 'search', 'execute', 'edit', 'delete', 'move'];
const CHANGE_KINDS = ['edit', 'delete', 'move'];

function buildLabel(entries: ToolCallEntry[], isStreaming: boolean): {
  text: string;
  lineChanges?: { additions: number; deletions: number };
} {
  const uniqueEntries = new Map<string, ToolCallEntry>();
  for (const e of entries) {
    uniqueEntries.set(e.toolCallId, e);
  }

  let thoughts = 0;
  let files = 0;
  let searches = 0;
  let fetches = 0;
  let commands = 0;
  let tools = 0;
  const changedFiles = new Set<string | undefined>();
  const edits: ToolCallEntry[] = [];

  for (const e of uniqueEntries.values()) {
    switch (e.kind) {
      case 'thinking': thoughts++; break;
      case 'read': files++; break;
      case 'search': searches++; break;
      case 'fetch': fetches++; break;
      case 'execute': commands++; break;
      case 'edit': case 'delete': case 'move':
        changedFiles.add(e.locations?.[0]?.path || e.content?.find((item) => item?.path)?.path || e.title);
        if (e.kind === 'edit') edits.push(e);
        break;
      default: tools++;
    }
  }

  const onlyThinking = thoughts > 0 && thoughts === uniqueEntries.size;

  if (onlyThinking) {
    return { text: isStreaming ? 'Thinking' : 'Thought' };
  }

  // While streaming, don't show detailed summary
  if (isStreaming) {
    return { text: 'Working' };
  }

  // Build summary for finished state
  const changes = changedFiles.size;
  const parts: string[] = [];
  if (thoughts > 0) parts.push('thought');
  if (files > 0) parts.push(`read ${files} ${files === 1 ? 'file' : 'files'}`);
  if (searches > 0) parts.push(`ran ${searches} ${searches === 1 ? 'search' : 'searches'}`);
  if (fetches > 0) parts.push(`fetched ${fetches} ${fetches === 1 ? 'URL' : 'URLs'}`);
  if (commands > 0) parts.push(`ran ${commands} ${commands === 1 ? 'command' : 'commands'}`);
  if (changes > 0) parts.push(`changed ${changes} ${changes === 1 ? 'file' : 'files'}`);
  if (tools > 0) parts.push(`made ${tools} ${tools === 1 ? 'tool call' : 'tool calls'}`);

  if (parts.length === 0) return { text: 'Worked' };
  const summary = parts.join(', ');
  const lineChanges = edits.map(countEditChanges).reduce((total, item) => ({
    additions: total.additions + item.additions,
    deletions: total.deletions + item.deletions,
  }), { additions: 0, deletions: 0 });
  return { text: summary.charAt(0).toUpperCase() + summary.slice(1), lineChanges };
}

export const WorkingBlock: React.FC<Props> = ({ blocks, isOpen, isActivePrompt = false, onImageClick }) => {
  const [isExpanded, setIsExpanded] = useState(isOpen);
  // Rows are mounted on first expand and kept afterwards, so collapsed blocks stay cheap.
  const [wasExpanded, setWasExpanded] = useState(isOpen);

  useEffect(() => {
    if (!isOpen) setIsExpanded(false);
  }, [isOpen]);

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

  const entries = blocks.flatMap((block) => block.type === 'exploring' ? block.entries : [block.entry]);
  const isSingleNonThinking = entries.length === 1 && entries[0].kind !== 'thinking';
  const label = buildLabel(entries, isOpen);
  const images = entries
    .filter((entry) => !ACTIVITY_KINDS.includes(entry.kind ?? ''))
    .flatMap((entry) => extractToolCallImages(safeParseJson(entry.rawJson)));

  const thumbnails = images.length > 0 && (
    <div className="flex flex-wrap items-start gap-2 pt-2">
      {images.map((image, index) => (
        <ToolOutputImage key={`${index}-${'src' in image ? image.src.slice(0, 32) : toolCallImageKey(image)}`}
          image={image} onImageClick={onImageClick} />
      ))}
    </div>
  );

  const renderEntries = () => (
    <div className="flex flex-col gap-1 px-[1px] w-full min-w-0">
      {entries.map((entry, i) => {
        if (entry.kind === 'thinking') {
          return <ThinkingActivity key={entry.toolCallId || i} entry={entry} />;
        }
        if (entry.kind === 'read') {
          return <ReadActivity key={entry.toolCallId || i} entry={entry} onOpenFile={handleOpenFile} isActivePrompt={isActivePrompt} />;
        }
        if (entry.kind === 'fetch') {
          return <FetchActivity key={entry.toolCallId || i} entry={entry} onOpenUrl={handleOpenUrl} isActivePrompt={isActivePrompt} />;
        }
        if (entry.kind === 'search') {
          return <SearchActivity key={entry.toolCallId || i} entry={entry} isActivePrompt={isActivePrompt} />;
        }
        if (entry.kind === 'execute') {
          return <ExecuteActivity key={entry.toolCallId || i} entry={entry} isActivePrompt={isActivePrompt} />;
        }
        if (entry.kind === 'edit') {
          return <EditActivity key={entry.toolCallId || i} entry={entry} isActivePrompt={isActivePrompt} />;
        }
        if (CHANGE_KINDS.includes(entry.kind ?? '')) {
          return (
            <ExpandableActivity key={entry.toolCallId || i} status={entry.status} isActivePrompt={isActivePrompt}
              icon={entry.kind === 'delete' ? <Trash size={13} className="flex-shrink-0" /> : <Move size={13} className="flex-shrink-0" />}
              label={entry.title || (entry.kind === 'delete' ? 'Deleting file...' : 'Moving file...')}
            />
          );
        }
        return <OtherActivity key={entry.toolCallId || i} entry={entry} isActivePrompt={isActivePrompt} />;
      })}
    </div>
  );

  if (isSingleNonThinking) {
    return (
      <div className="w-full min-w-0 max-w-full my-1">
        {renderEntries()}
        {thumbnails}
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 max-w-full my-1 text-foreground-secondary">
      <button onClick={() => { setIsExpanded(v => !v); setWasExpanded(true); }}
        className={`flex items-center gap-1.5 max-w-full ${chatFocusClassName}`}
      >
        <span className="truncate">{label.text}</span>
        {label.lineChanges && <LineChanges {...label.lineChanges} className="ml-0.5" />}
        <span className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
          <ChevronRight size={14} className="relative top-px" />
        </span>
      </button>

      <div {...(!isExpanded ? { inert: '' } : {})} className={`grid px-[1px] duration-300 ease-in-out w-full min-w-0
        ${isExpanded ? 'opacity-100 translate-y-0 overflow-visible' : 'opacity-0 -translate-y-2 overflow-hidden'}`}
        style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
      >
        <div className="font-normal w-full min-w-0 min-h-0">
          <div className="py-2">
            {wasExpanded && renderEntries()}
          </div>
        </div>
      </div>
      {thumbnails}
    </div>
  );
};
