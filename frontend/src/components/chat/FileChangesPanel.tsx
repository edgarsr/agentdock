import { useState, memo } from 'react';
import { Check, Undo2, FileDiff, ChevronRight } from 'lucide-react';
import { FileChangeSummary } from '../../types/chat';
import { Tooltip } from './shared/Tooltip';
import { chatFocusClassName, chatInsetFocusClassName } from './shared/focusStyles';

interface FileChangesPanelProps {
  hasPluginEdits: boolean;
  fileChanges: FileChangeSummary[];
  totalAdditions: number;
  totalDeletions: number;
  onUndoFile: (filePath: string) => void;
  onUndoAllFiles: () => void;
  onKeepFile?: (filePath: string) => void;
  onKeepAll: () => void;
  onOpenFile?: (filePath: string) => void;
  onShowDiff?: (fc: FileChangeSummary) => void;
}

const FileChangesPanel = memo(({
  hasPluginEdits,
  fileChanges,
  totalAdditions,
  totalDeletions,
  onUndoFile,
  onUndoAllFiles,
  onKeepFile,
  onKeepAll,
  onOpenFile,
  onShowDiff,
}: FileChangesPanelProps) => {
  const [expanded, setExpanded] = useState(false);
  const [confirmUndoAll, setConfirmUndoAll] = useState(false);

  if (!hasPluginEdits || fileChanges.length === 0) return null;

  const getFileName = (path: string) => {
    return path.split(/[\\/]/).pop() || path;
  };

  const toggleExpanded = () => setExpanded(value => !value);

  const handleHeaderKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggleExpanded();
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] border-t border-border px-4 py-2">
      <div className="border border-border rounded-[6px] overflow-hidden bg-editor-bg">
          <div
            role="button"
            tabIndex={0}
            aria-expanded={expanded}
            className={`flex items-center h-9 w-full px-3 bg-editor-bg transition-colors cursor-pointer group/header ${chatInsetFocusClassName}`}
            onClick={toggleExpanded}
            onKeyDown={handleHeaderKeyDown}
          >
            <div className="flex items-center gap-2 flex-1 min-w-0 text-ide-small text-foreground-secondary">
              <FileDiff size={14} />
              <div className="flex items-center gap-2 min-w-0 mt-0.5">
                <span>{fileChanges.length} {fileChanges.length === 1 ? 'file' : 'files'} changed</span>
                <div className="flex items-center gap-1.5">
                  {totalAdditions > 0 && <span className="font-bold text-added">+{totalAdditions}</span>}
                  {totalDeletions > 0 && <span className="font-bold text-deleted">-{totalDeletions}</span>}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
              {confirmUndoAll ? (
                <div className="flex items-center gap-1">
                  <span className="text-sm text-foreground-secondary mr-2 mt-1">Undo all?</span>
                  <button
                    type="button"
                    className={`text-xs px-2 py-0.5 bg-error text-white rounded mr-1 ${chatFocusClassName}`}
                    onClick={() => { onUndoAllFiles(); setConfirmUndoAll(false); }}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    className={`text-xs px-2 py-0.5 bg-background text-foreground rounded border border-border ${chatFocusClassName}`}
                    onClick={() => setConfirmUndoAll(false)}
                  >
                    No
                  </button>
                </div>
              ) : (
                <>
                  <Tooltip variant="minimal" content="Accept all changes">
                    <button
                      type="button"
                      className={`p-1 text-foreground-secondary hover:text-added transition-colors ${chatFocusClassName}`}
                      onClick={onKeepAll}
                    >
                      <Check size={14} />
                    </button>
                  </Tooltip>
                  <Tooltip variant="minimal" content="Undo all changes">
                    <button
                      type="button"
                      className={`p-1 text-foreground-secondary hover:text-deleted transition-colors ${chatFocusClassName}`}
                      onClick={() => setConfirmUndoAll(true)}
                    >
                      <Undo2 size={14} />
                    </button>
                  </Tooltip>
                </>
              )}
              <div 
                className={`p-1 ml-1 text-foreground-secondary transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
              >
                <ChevronRight size={14} />
              </div>
            </div>
          </div>

          <div
            className={`grid transition-[grid-template-rows] duration-300 ease-in-out overflow-hidden ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
          >
            <div className={`overflow-hidden bg-editor-bg border-t transition-colors duration-300 ${expanded ? 'border-border' : 'border-transparent'}`}>
              <div className="py-1 max-h-48 overflow-y-auto">
                {fileChanges.map((fc) => (
                  <div
                    key={fc.filePath}
                    className="flex items-center justify-between h-9 px-3 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`font-mono w-4 text-center flex-shrink-0 font-bold ${
                        fc.status === 'A' ? 'text-added' : 'text-warning'
                      }`}>
                        {fc.status}
                      </span>
                      <Tooltip variant="minimal" content={fc.filePath}>
                        <button type="button"
                          className={`truncate text-left text-foreground hover:underline transition-colors min-w-0 font-mono ${chatFocusClassName}`}
                          onClick={() => onOpenFile?.(fc.filePath)}
                        >
                          {getFileName(fc.filePath)}
                        </button>
                      </Tooltip>
                      <div className="flex items-center gap-1 flex-shrink-0 ml-1">
                        {fc.additions > 0 && <span className="text-sm font-bold text-added">+{fc.additions}</span>}
                        {fc.deletions > 0 && <span className="text-sm font-bold text-deleted">-{fc.deletions}</span>}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0">
                      {onShowDiff && (
                        <Tooltip variant="minimal" content="View changes (diff)">
                          <button type="button"
                            className={`p-1 text-foreground-secondary hover:text-foreground rounded transition-colors ${chatFocusClassName}`}
                            onClick={() => onShowDiff(fc)}
                          >
                            <FileDiff size={14} />
                          </button>
                        </Tooltip>
                      )}
                      {onKeepFile && (
                        <Tooltip variant="minimal" content="Accept changes">
                          <button type="button"
                            className={`p-1 text-foreground-secondary hover:text-added rounded transition-colors ${chatFocusClassName}`}
                            onClick={() => onKeepFile(fc.filePath)}
                          >
                            <Check size={14} />
                          </button>
                        </Tooltip>
                      )}
                      <Tooltip variant="minimal" content="Undo changes">
                        <button type="button"
                          className={`p-1 text-foreground-secondary hover:text-deleted rounded transition-colors ${chatFocusClassName}`}
                          onClick={() => onUndoFile(fc.filePath)}
                        >
                          <Undo2 size={14} />
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
      </div>
    </div>
  );
});

export default FileChangesPanel;
