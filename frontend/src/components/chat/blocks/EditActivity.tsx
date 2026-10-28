import React, { useMemo } from 'react';
import { ToolCallEntry } from '../../../types/chat';
import { FileDiff, Pencil } from 'lucide-react';
import { ExpandableActivity } from './ExpandableActivity';
import { LineChanges } from '../shared/LineChanges';
import { countEditChanges, countLines, editDiffEntries, lineDiff } from '../../../utils/editDiff';
import hljs, { getLanguageFromPath } from '../../../utils/highlight';
import { sanitizeCodeHtml } from '../../../utils/sanitizeHtml';
import { parseToolStatus } from '../../../utils/toolCallUtils';
import '../../../styles/markdown.css';
import { InlineButton } from './InlineButton';
import { Tooltip } from '../shared/Tooltip';

interface Props {
  entry: ToolCallEntry;
  isActivePrompt: boolean;
}

interface DiffLine {
  type: 'added' | 'removed' | 'context';
  content: string;
  oldLine?: number;
  newLine?: number;
  hunkIndex: number;
}

const INLINE_DIFF_THRESHOLD = 100;
const MAX_INLINE_DIFF_LINES = 1000;
const CONTEXT_LINES = 3;

function trimUnchangedEdges(oldText: string, newText: string): [string, string] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;

  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  while (oldEnd >= prefix && newEnd >= prefix && oldLines[oldEnd] === newLines[newEnd]) {
    oldEnd--;
    newEnd--;
  }

  const start = Math.max(0, prefix - CONTEXT_LINES);
  return [
    oldLines.slice(start, oldEnd + CONTEXT_LINES + 1).join('\n'),
    newLines.slice(start, newEnd + CONTEXT_LINES + 1).join('\n'),
  ];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Highlights only when mounted, which happens when the user first expands the edit.
const DiffView: React.FC<{ lines: DiffLine[]; filePath: string }> = ({ lines, filePath }) => {
  const highlightedLines = useMemo(() => {
    const language = getLanguageFromPath(filePath);
    return lines.map((line) => {
      try {
        return sanitizeCodeHtml(hljs.highlight(line.content, { language, ignoreIllegals: true }).value);
      } catch {
        return escapeHtml(line.content);
      }
    });
  }, [lines, filePath]);

  return (
    <div tabIndex={-1} className="bg-editor-bg max-h-[400px] overflow-auto [@media(pointer:fine)]:[&::-webkit-scrollbar]:!h-[7px]">
      <div className="syntax-highlighted font-mono text-ide-small py-2 min-w-max inline-block w-full">
        {lines.map((line, i) => (
          <React.Fragment key={i}>
            {i > 0 && line.hunkIndex !== lines[i - 1].hunkIndex && (
              <div className="h-px my-1" />
            )}
            <div
              className={`flex w-full ${
                line.type === 'added' ? 'bg-added-bg' :
                line.type === 'removed' ? 'bg-deleted-bg' :
                ''
              }`}
            >
              <div className={`w-5 flex-shrink-0 flex justify-center select-none py-0.5 font-bold ${
                line.type === 'added' ? 'text-success' :
                line.type === 'removed' ? 'text-error' :
                'text-editor-fg'
              }`}>
                {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
              </div>
              <div
                className="flex-none w-max cursor-text px-1 whitespace-pre break-all py-0.5 text-editor-fg"
                dangerouslySetInnerHTML={{ __html: highlightedLines[i] || ' ' }}
              />
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

export const EditActivity: React.FC<Props> = ({ entry, isActivePrompt }) => {
  const { isFinished } = parseToolStatus(entry.status);

  const diffData = useMemo(() => {
    const diffEntries = editDiffEntries(entry);
    if (diffEntries.length === 0) return null;

    const filePath = entry.locations?.[0]?.path || diffEntries[0].path || entry.title || 'Unknown file';
    const trim = diffEntries.reduce((total, entry) =>
      total + Math.max(countLines(entry.oldText ?? ''), countLines(entry.newText)), 0) >= INLINE_DIFF_THRESHOLD;

    const lines: DiffLine[] = [];
    let tooLarge = false;

    const addLines = (
      text: string,
      type: 'added' | 'removed' | 'context',
      oldLineNumRef: { value: number },
      newLineNumRef: { value: number },
      hunkIndex: number
    ) => {
      const splitLines = text.split('\n');
      if (splitLines.length > 1 && splitLines[splitLines.length - 1] === '') {
        splitLines.pop();
      }
      if (lines.length + splitLines.length > MAX_INLINE_DIFF_LINES) {
        tooLarge = true;
        return;
      }

      splitLines.forEach((line) => {
        if (type === 'added') {
          lines.push({ type, content: line, newLine: newLineNumRef.value++, hunkIndex });
        } else if (type === 'removed') {
          lines.push({ type, content: line, oldLine: oldLineNumRef.value++, hunkIndex });
        } else {
          lines.push({
            type,
            content: line,
            oldLine: oldLineNumRef.value++,
            newLine: newLineNumRef.value++,
            hunkIndex,
          });
        }
      });
    };

    for (const [hunkIndex, entry] of diffEntries.entries()) {
      const [oldText, newText] = trim && entry.oldText !== null
        ? trimUnchangedEdges(entry.oldText, entry.newText)
        : [entry.oldText ?? '', entry.newText];
      if (Math.max(countLines(oldText), countLines(newText)) > MAX_INLINE_DIFF_LINES) {
        tooLarge = true;
        break;
      }
      const oldLineNumRef = { value: 1 };
      const newLineNumRef = { value: 1 };
      for (const [op, text] of lineDiff(oldText, newText)) {
        if (op === 1) addLines(text, 'added', oldLineNumRef, newLineNumRef, hunkIndex);
        else if (op === -1) addLines(text, 'removed', oldLineNumRef, newLineNumRef, hunkIndex);
        else addLines(text, 'context', oldLineNumRef, newLineNumRef, hunkIndex);
        if (tooLarge) break;
      }
      if (tooLarge) break;
    }

    return { filePath, lines: tooLarge ? [] : lines, tooLarge };
  }, [entry.content, entry.title, entry.locations]);
  const { additions, deletions } = useMemo(() => countEditChanges(entry), [entry.content]);

  const fileName = (entry.locations?.[0]?.path || diffData?.filePath)?.split(/[\\/]/).pop();
  const showInline = !diffData?.tooLarge;

  const handleOpenFile = () => {
    const bestPath = entry.locations?.[0]?.path || diffData?.filePath || entry.title;
    if (bestPath && window.__openFile) {
      window.__openFile(JSON.stringify({ filePath: bestPath }));
    }
  };

  const handleShowDiff = () => {
    if (!diffData || typeof window.__showDiff !== 'function') return;
    const content = entry.content;
    if (!content || !Array.isArray(content)) return;
    const operations = content
      .filter((item) => item?.type === 'diff' || (item?.path !== undefined && item?.newText !== undefined))
      .map((item) => ({ oldText: item.oldText ?? '', newText: item.newText ?? '' }));
    window.__showDiff(JSON.stringify({ filePath: diffData.filePath, status: 'M', operations }));
  };

  return (
    <ExpandableActivity icon={<Pencil size={13} className="flex-shrink-0" />} status={entry.status} isActivePrompt={isActivePrompt}
      label={fileName
        ? <>Edited <InlineButton onClick={handleOpenFile} className="hover:underline">{fileName}</InlineButton></>
        : isFinished ? 'Edited file' : 'Editing file...'}
      trailing={<>
        <LineChanges additions={additions} deletions={deletions} className="ml-0.5" />
        {diffData && isFinished && (
          <Tooltip variant="minimal" content="View diff in editor">
            <InlineButton onClick={handleShowDiff} className="flex p-0.5 hover:text-foreground rounded transition-colors relative top-[-1px]">
              <FileDiff size={13} />
            </InlineButton>
          </Tooltip>
        )}
      </>}
      panelClassName="overflow-hidden"
    >
      {showInline && (
        <>
          {diffData && <DiffView lines={diffData.lines} filePath={diffData.filePath} />}

          {!diffData && (
            <div className="p-4 bg-editor-bg text-center">
              <span className="opacity-40 italic">
                {isFinished ? 'No diff information available.' : 'Calculating diff...'}
              </span>
            </div>
          )}
        </>
      )}
    </ExpandableActivity>
  );
};
