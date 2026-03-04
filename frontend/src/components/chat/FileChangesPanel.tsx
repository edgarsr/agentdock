import { useState, memo } from 'react';
import { Check, Undo2, FileDiff, ChevronRight } from 'lucide-react';
import { FileChangeSummary } from '../../types/chat';
import { Tooltip } from './shared/Tooltip';

interface FileChangesPanelProps {
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

  if (fileChanges.length === 0) return null;

  const getFileName = (path: string) => {
    return path.split(/[\\/]/).pop() || path;
  };

  return (
    <>
      <div className="border-t border-border w-full" />

      <div className="px-4 pb-4 pt-3">
        <div className="max-w-4xl mx-auto border border-border rounded-md overflow-hidden bg-editor-bg">
          
          <div 
            className="flex items-center w-full px-3 py-2 bg-editor-bg hover:bg-background-secondary transition-colors cursor-pointer group/header"
            onClick={() => setExpanded(!expanded)}
          >
            <div className="flex items-center gap-2 flex-1 min-w-0 text-sm font-medium text-foreground">
              <FileDiff size={14} className="opacity-70" />
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-foreground-secondary">
                  {fileChanges.length} {fileChanges.length === 1 ? 'file' : 'files'}
                </span>
                <div className="flex items-center gap-1.5 ml-1">
                  {totalAdditions > 0 && <span className="font-bold text-added">+{totalAdditions}</span>}
                  {totalDeletions > 0 && <span className="font-bold text-deleted">-{totalDeletions}</span>}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
              {confirmUndoAll ? (
                <div className="flex items-center gap-1">
                  <span className="text-sm text-foreground-secondary mr-1">Undo all?</span>
                  <button
                    type="button"
                    className="text-xs px-2 py-0.5 bg-error text-white rounded"
                    onClick={() => { onUndoAllFiles(); setConfirmUndoAll(false); }}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    className="text-xs px-2 py-0.5 bg-background text-foreground rounded border border-border"
                    onClick={() => setConfirmUndoAll(false)}
                  >
                    No
                  </button>
                </div>
              ) : (
                <>
                  <Tooltip content="Accept all changes">
                    <button
                      type="button"
                      className="p-1 text-foreground-secondary hover:text-added transition-colors"
                      onClick={onKeepAll}
                    >
                      <Check size={14} />
                    </button>
                  </Tooltip>
                  <Tooltip content="Reject all changes">
                    <button
                      type="button"
                      className="p-1 text-foreground-secondary hover:text-deleted transition-colors"
                      onClick={() => setConfirmUndoAll(true)}
                    >
                      <Undo2 size={14} />
                    </button>
                  </Tooltip>
                </>
              )}
              <div 
                className={`p-1 ml-1 text-foreground-secondary transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
                onClick={() => setExpanded(!expanded)}
              >
                <ChevronRight size={14} />
              </div>
            </div>
          </div>

          <div
            className="grid transition-[grid-template-rows] duration-300 ease-in-out overflow-hidden"
            style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
          >
            <div className={`overflow-hidden bg-editor-bg border-t transition-colors duration-300 ${expanded ? 'border-border' : 'border-transparent'}`}>
              <div className="py-1 max-h-48 overflow-y-auto">
                {fileChanges.map((fc) => (
                  <div
                    key={fc.filePath}
                    className="flex items-center justify-between py-1.5 px-3 hover:bg-background-secondary transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`font-mono w-4 text-center flex-shrink-0 font-bold ${
                        fc.status === 'A' ? 'text-added' : 'text-warning'
                      }`}>
                        {fc.status}
                      </span>
                      <Tooltip content={fc.filePath}>
                        <button
                          type="button"
                          className="truncate text-left text-foreground hover:text-link hover:underline transition-colors min-w-0 font-mono"
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
                        <Tooltip content="View changes (diff)">
                          <button
                            type="button"
                            className="p-1 text-foreground-secondary hover:text-foreground hover:bg-background rounded transition-colors"
                            onClick={() => onShowDiff(fc)}
                          >
                            <FileDiff size={14} />
                          </button>
                        </Tooltip>
                      )}
                      {onKeepFile && (
                        <Tooltip content="Accept changes">
                          <button
                            type="button"
                            className="p-1 text-foreground-secondary hover:text-added hover:bg-background rounded transition-colors"
                            onClick={() => onKeepFile(fc.filePath)}
                          >
                            <Check size={14} />
                          </button>
                        </Tooltip>
                      )}
                      <Tooltip content="Reject changes">
                        <button
                          type="button"
                          className="p-1 text-foreground-secondary hover:text-deleted hover:bg-background rounded transition-colors"
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
    </>
  );
});

export default FileChangesPanel;
