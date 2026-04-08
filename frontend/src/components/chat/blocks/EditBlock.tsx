import React, { useMemo } from 'react';
import { ToolCallBlock } from '../../../types/chat';
import { FileCode, ChevronRight } from 'lucide-react';
import { diff_match_patch } from 'diff-match-patch';
import hljs, { getLanguageFromPath } from '../../../utils/highlight';
import { parseToolStatus } from '../../../utils/toolCallUtils';
import { useAutoCollapse } from '../../../hooks/useAutoCollapse';
import '../../../styles/markdown.css';
import { chatFocusClassName, chatInsetFocusClassName } from '../shared/focusStyles';

interface Props {
  block: ToolCallBlock;
}

interface DiffLine {
  type: 'added' | 'removed' | 'context';
  content: string;
  oldLine?: number;
  newLine?: number;
  highlightedHtml?: string;
  hunkIndex: number;
}

export const EditBlock: React.FC<Props> = ({ block }) => {
  const { isPending, isError, isFinished } = parseToolStatus(block.entry.status);
  const { isExpanded, toggle } = useAutoCollapse();

  const diffData = useMemo(() => {
    const content = block.entry.content;
    if (!content || !Array.isArray(content)) return null;

    const normalizeLineEndings = (text: string) => text.replace(/\r\n?/g, '\n');
    const diffEntries = content
      .filter((item) => item?.type === 'diff' || (item?.path !== undefined && item?.newText !== undefined))
      .map((item) => ({
        ...item,
        type: 'diff',
        path: item.path || '',
        oldText: item.oldText ?? null,
        newText: item.newText ?? '',
      }))
      .filter((entry) => normalizeLineEndings(entry.oldText ?? '') !== normalizeLineEndings(entry.newText ?? ''));

    if (diffEntries.length === 0) return null;

    const filePath = block.entry.locations?.[0]?.path || diffEntries[0].path || block.entry.title || 'Unknown file';
    const language = getLanguageFromPath(filePath);

    let additions = 0;
    let deletions = 0;
    const lines: DiffLine[] = [];

    const addLines = (
      text: string,
      type: 'added' | 'removed' | 'context',
      oldLineNumRef: { value: number },
      newLineNumRef: { value: number },
      hunkIndex: number
    ) => {
      const splitLines = normalizeLineEndings(text).split('\n');
      if (splitLines.length > 1 && splitLines[splitLines.length - 1] === '') {
        splitLines.pop();
      }

      splitLines.forEach((line) => {
        let highlightedHtml = line;
        try {
          highlightedHtml = hljs.highlight(line, { language, ignoreIllegals: true }).value;
        } catch {
          // Fallback to plain text when highlight.js cannot infer the language.
        }

        if (type === 'added') {
          additions++;
          lines.push({ type, content: line, newLine: newLineNumRef.value++, highlightedHtml, hunkIndex });
        } else if (type === 'removed') {
          deletions++;
          lines.push({ type, content: line, oldLine: oldLineNumRef.value++, highlightedHtml, hunkIndex });
        } else {
          lines.push({
            type,
            content: line,
            oldLine: oldLineNumRef.value++,
            newLine: newLineNumRef.value++,
            highlightedHtml,
            hunkIndex,
          });
        }
      });
    };

    diffEntries.forEach((entry, hunkIndex) => {
      const oldText = normalizeLineEndings(entry.oldText ?? '');
      const newText = normalizeLineEndings(entry.newText ?? '');
      const dmp = new diff_match_patch();
      const lineMode = dmp.diff_linesToChars_(oldText, newText);
      const diffs = dmp.diff_main(lineMode.chars1, lineMode.chars2, false);
      dmp.diff_charsToLines_(diffs, lineMode.lineArray);

      const oldLineNumRef = { value: 1 };
      const newLineNumRef = { value: 1 };
      diffs.forEach(([op, text]) => {
        if (op === 1) addLines(text, 'added', oldLineNumRef, newLineNumRef, hunkIndex);
        else if (op === -1) addLines(text, 'removed', oldLineNumRef, newLineNumRef, hunkIndex);
        else addLines(text, 'context', oldLineNumRef, newLineNumRef, hunkIndex);
      });
    });

    return { filePath, additions, deletions, lines };
  }, [block.entry.content, block.entry.title, block.entry.locations]);

  const fileName = useMemo(() => {
    if (!diffData?.filePath) return 'File Edit';
    const parts = diffData.filePath.split(/[\\/]/);
    return parts[parts.length - 1];
  }, [diffData?.filePath]);

  const handleOpenFile = () => {
    const bestPath = block.entry.locations?.[0]?.path || diffData?.filePath || block.entry.title;
    if (bestPath && window.__openFile) {
      window.__openFile(JSON.stringify({ filePath: bestPath }));
    }
  };

  const handleOpenFileKeyDown: React.KeyboardEventHandler<HTMLSpanElement> = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    handleOpenFile();
  };

  return (
    <div className="border border-border rounded-[6px] overflow-hidden mb-2">
      <button
        onClick={toggle}
        className={`flex items-center gap-2 w-full px-3 h-9 bg-editor-bg ${chatInsetFocusClassName}`}
      >
        <div className="flex-shrink-0 text-foreground-secondary">
          <FileCode size={14} />
        </div>
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); handleOpenFile(); }}
            onKeyDown={handleOpenFileKeyDown}
            className={`font-mono truncate text-editor-fg opacity-90 hover:underline cursor-pointer text-left ${chatFocusClassName}`}
          >
            {fileName}
          </span>
          {diffData && (
            <div className="flex items-center gap-1.5 ml-1 flex-shrink-0 text-ide-small">
              {diffData.additions > 0 && (
                <span className="font-bold text-added flex items-center">
                  +{diffData.additions}
                </span>
              )}
              {diffData.deletions > 0 && (
                <span className="font-bold text-deleted flex items-center">
                  -{diffData.deletions}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex-shrink-0 flex items-center gap-2">
          {(isPending || isError) && (
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                isPending ? 'bg-warning animate-pulse' : 'bg-error'
              }`}
            />
          )}
          <div className={`transition-transform duration-200 text-editor-fg opacity-50 ${isExpanded ? 'rotate-90' : ''}`}>
            <ChevronRight size={14} />
          </div>
        </div>
      </button>

      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out overflow-hidden ${isExpanded ? 'border-t border-border' : ''}`}
        style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          {diffData && (
            <div tabIndex={-1} className="bg-editor-bg max-h-[400px] overflow-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent ">
              <div className="syntax-highlighted font-mono text-ide-small cursor-text py-2 min-w-max inline-block w-full">
                {diffData.lines.map((line, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && line.hunkIndex !== diffData.lines[i - 1].hunkIndex && (
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
                        className="flex-1 px-1 whitespace-pre break-all py-0.5 text-editor-fg"
                        dangerouslySetInnerHTML={{ __html: line.highlightedHtml || ' ' }}
                      />
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}

          {!diffData && (
            <div className="p-4 bg-editor-bg text-center">
              <span className="opacity-40 italic">
                {isFinished ? 'No diff information available.' : 'Calculating diff...'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
