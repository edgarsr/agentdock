import { useState } from 'react';
import { FileChangeSummary } from '../../types/chat';

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

export default function FileChangesPanel({
  fileChanges,
  totalAdditions,
  totalDeletions,
  onUndoFile,
  onUndoAllFiles,
  onKeepFile,
  onKeepAll,
  onOpenFile,
  onShowDiff,
}: FileChangesPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [confirmUndoAll, setConfirmUndoAll] = useState(false);

  if (fileChanges.length === 0) return null;

  return (
    <div className="border-t border-border bg-background-secondary">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <button
          className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-accent transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span>Edits</span>
          <span className="text-xs text-foreground-secondary">
            {fileChanges.length} file{fileChanges.length !== 1 ? 's' : ''}
          </span>
          {totalAdditions > 0 && <span className="text-xs text-green-500">+{totalAdditions}</span>}
          {totalDeletions > 0 && <span className="text-xs text-red-500">-{totalDeletions}</span>}
        </button>

        <div className="flex items-center gap-2">
          {confirmUndoAll ? (
            <div className="flex items-center gap-1">
              <span className="text-xs text-foreground-secondary">Undo all?</span>
              <button
                type="button"
                className="text-xs px-2 py-0.5 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                onClick={() => { onUndoAllFiles(); setConfirmUndoAll(false); }}
              >
                Yes
              </button>
              <button
                type="button"
                className="text-xs px-2 py-0.5 bg-background-secondary text-foreground rounded hover:bg-background transition-colors"
                onClick={() => setConfirmUndoAll(false)}
              >
                No
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="text-xs px-2 py-1 text-green-400 hover:text-green-300  rounded transition-colors"
                onClick={onKeepAll}
              >
                Keep All
              </button>
              <button
                type="button"
                className="text-xs px-2 py-1 text-red-400 hover:text-red-300  rounded transition-colors"
                onClick={() => setConfirmUndoAll(true)}
              >
                Undo All
              </button>
            </>
          )}
        </div>
      </div>

      {/* File list */}
      {expanded && (
        <div className="px-3 pb-2 space-y-1 max-h-48 overflow-y-auto">
          {fileChanges.map((fc) => (
            <div
              key={fc.filePath}
              className="flex items-center justify-between py-1 px-2 rounded  group text-sm"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className={`text-xs font-mono px-1 rounded ${
                  fc.status === 'A' ? 'bg-green-900/40 text-green-400' : 'bg-yellow-900/40 text-yellow-400'
                }`}>
                  {fc.status}
                </span>
                <button
                  type="button"
                  className="truncate text-left text-foreground hover:text-accent hover:underline transition-colors min-w-0"
                  title={fc.filePath}
                  onClick={() => onOpenFile?.(fc.filePath)}
                >
                  {fc.fileName}
                </button>
                <span className="flex-shrink-0 text-xs">
                  {fc.additions > 0 && <span className="text-green-500">+{fc.additions}</span>}
                  {fc.additions > 0 && fc.deletions > 0 && <span className="text-foreground-secondary"> </span>}
                  {fc.deletions > 0 && <span className="text-red-500">-{fc.deletions}</span>}
                </span>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {onShowDiff && (
                  <button
                    type="button"
                    className="text-xs px-2 py-0.5 text-foreground-secondary hover:text-accent  rounded transition-colors"
                    onClick={() => onShowDiff(fc)}
                    title="View diff (agent changes)"
                  >
                    Diff
                  </button>
                )}
                {onKeepFile && (
                  <button
                    type="button"
                    className="text-xs px-2 py-0.5 text-green-400 hover:text-green-300 hover:bg-green-900/30 rounded transition-colors"
                    onClick={() => onKeepFile(fc.filePath)}
                    title="Keep this file's changes"
                  >
                    Keep
                  </button>
                )}
                <button
                  type="button"
                  className="text-xs px-2 py-0.5 text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded transition-colors"
                  onClick={() => onUndoFile(fc.filePath)}
                  title="Undo this file's changes"
                >
                  Undo
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
