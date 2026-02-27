import React, { useMemo } from 'react';
import { ToolCallBlock } from '../../../types/chat';
import { FileCode, Plus, Minus, ChevronRight } from 'lucide-react';
import { diff_match_patch } from 'diff-match-patch';
import hljs, { getLanguageFromPath } from '../../../utils/highlight';
import { parseToolStatus } from '../../../utils/toolCallUtils';
import { useAutoCollapse } from '../../../hooks/useAutoCollapse';

interface Props {
  block: ToolCallBlock;
}

interface DiffLine {
  type: 'added' | 'removed' | 'context';
  content: string;
  oldLine?: number;
  newLine?: number;
  highlightedHtml?: string;
}

export const EditBlock: React.FC<Props> = ({ block }) => {
  const { isPending, isError, isFinished } = parseToolStatus(block.entry.status);
  const { isExpanded, toggle } = useAutoCollapse(isFinished, block.isReplay);

  const diffData = useMemo(() => {
    const content = block.entry.content;
    if (!content || !Array.isArray(content)) return null;

    const diffEntry = content.find(c => c.type === 'diff');
    if (!diffEntry) return null;

    const oldText = diffEntry.oldText || '';
    const newText = diffEntry.newText || '';

    const filePath = block.entry.locations?.[0]?.path || diffEntry.path || block.entry.title || 'Unknown file';
    const language = getLanguageFromPath(filePath);

    const dmp = new diff_match_patch();
    const diffs = dmp.diff_main(oldText, newText);
    dmp.diff_cleanupSemantic(diffs);

    let additions = 0;
    let deletions = 0;
    const lines: DiffLine[] = [];
    let oldLineNum = 1;
    let newLineNum = 1;

    const addLines = (text: string, type: 'added' | 'removed' | 'context') => {
      const splitLines = text.split('\n');
      if (splitLines.length > 1 && splitLines[splitLines.length - 1] === '') {
        splitLines.pop();
      }

      splitLines.forEach((line) => {
        let highlightedHtml = line;
        try {
          // hljs.highlight output is safe — it escapes HTML entities internally
          highlightedHtml = hljs.highlight(line, { language, ignoreIllegals: true }).value;
        } catch { /* fallback to plain text */ }

        if (type === 'added') {
          additions++;
          lines.push({ type, content: line, newLine: newLineNum++, highlightedHtml });
        } else if (type === 'removed') {
          deletions++;
          lines.push({ type, content: line, oldLine: oldLineNum++, highlightedHtml });
        } else {
          lines.push({ type, content: line, oldLine: oldLineNum++, newLine: newLineNum++, highlightedHtml });
        }
      });
    };

    diffs.forEach(([op, text]) => {
      if (op === 1) addLines(text, 'added');
      else if (op === -1) addLines(text, 'removed');
      else addLines(text, 'context');
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

  return (
    <div className="my-2 border border-border rounded-md overflow-hidden shadow-sm">
      <button
        onClick={toggle}
        className="flex items-center gap-2 w-full px-3 py-2 bg-editor-bg hover:bg-secondary transition-colors group border-b border-border"
      >
        <div className="flex-shrink-0 text-editor-fg opacity-70">
          <FileCode size={14} />
        </div>
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <span
            onClick={(e) => { e.stopPropagation(); handleOpenFile(); }}
            className="text-[12px] font-mono truncate text-editor-fg opacity-90 hover:underline cursor-pointer"
          >
            {fileName}
          </span>
          {diffData && (
            <div className="flex items-center gap-1.5 ml-1 flex-shrink-0">
              {diffData.additions > 0 && (
                <span className="text-[12px] font-bold text-success flex items-center">
                  <Plus size={11} className="mr-0.5" />{diffData.additions}
                </span>
              )}
              {diffData.deletions > 0 && (
                <span className="text-[12px] font-bold text-error flex items-center">
                  <Minus size={11} className="mr-0.5" />{diffData.deletions}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex-shrink-0 flex items-center gap-2">
          {(isPending || isError) && (
            <div
              className={`w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.3)] ${
                isPending ? 'bg-orange-500 animate-pulse' : 'bg-error'
              }`}
            />
          )}
          <div className={`transition-transform duration-200 text-editor-fg opacity-50 ${isExpanded ? 'rotate-90' : ''}`}>
            <ChevronRight size={14} />
          </div>
        </div>
      </button>

      <div
        className="grid transition-[grid-template-rows] duration-300 ease-in-out overflow-hidden"
        style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          {diffData && (
            <div className="bg-editor-bg max-h-[400px] overflow-y-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
              <div className="
                font-mono text-[11px] leading-relaxed py-2
                [&_.hljs-keyword]:text-[var(--ide-syntax-keyword)]
                [&_.hljs-string]:text-[var(--ide-syntax-string)]
                [&_.hljs-number]:text-[var(--ide-syntax-number)]
                [&_.hljs-comment]:text-[var(--ide-syntax-comment)]
                [&_.hljs-function]:text-[var(--ide-syntax-function)]
                [&_.hljs-title]:text-[var(--ide-syntax-function)]
                [&_.hljs-class]:text-[var(--ide-syntax-class)]
                [&_.hljs-tag]:text-[var(--ide-syntax-tag)]
                [&_.hljs-attr]:text-[var(--ide-syntax-attr)]
              ">
                {diffData.lines.map((line, i) => (
                  <div
                    key={i}
                    className={`flex w-full group ${
                      line.type === 'added' ? 'bg-[rgba(30,164,70,0.10)]' :
                      line.type === 'removed' ? 'bg-[rgba(248,81,73,0.10)]' :
                      'hover:bg-secondary/30'
                    }`}
                  >
                    <div className={`w-5 flex-shrink-0 flex justify-center opacity-60 select-none py-0.5 font-bold ${
                      line.type === 'added' ? 'text-success' :
                      line.type === 'removed' ? 'text-error' :
                      'text-editor-fg opacity-20'
                    }`}>
                      {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                    </div>
                    {/* hljs.highlight output is trusted — it escapes HTML entities internally */}
                    <div
                      className="flex-1 px-1 whitespace-pre break-all py-0.5 text-editor-fg"
                      dangerouslySetInnerHTML={{ __html: line.highlightedHtml || ' ' }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {!diffData && (
            <div className="p-4 bg-editor-bg text-center">
              <span className="text-[12px] opacity-40 italic">
                {isFinished ? 'No diff information available.' : 'Calculating diff...'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
