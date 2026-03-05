import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { diff_match_patch, DIFF_INSERT, DIFF_DELETE } from 'diff-match-patch';
import { ToolCallEvent, FileChangeSummary } from '../types/chat';
import { ACPBridge } from '../utils/bridge';

const _dmp = new diff_match_patch();

/**
 * Compute diff statistics (added/deleted lines) using diff-match-patch.
 * Consistent with EditBlock.tsx which uses the same library for rendering.
 */
function computeDiffStats(oldString: string, newString: string): { additions: number; deletions: number } {
  const diffs = _dmp.diff_main(oldString || '', newString || '');
  _dmp.diff_cleanupSemantic(diffs);
  let additions = 0;
  let deletions = 0;
  for (const [op, text] of diffs) {
    const lineCount = (text.match(/\n/g) || []).length + (text.endsWith('\n') ? 0 : 1);
    if (op === DIFF_INSERT) additions += lineCount;
    else if (op === DIFF_DELETE) deletions += lineCount;
  }
  return { additions, deletions };
}

/**
 * Tool call statuses that confirm the operation was successfully applied.
 * Only events with one of these statuses are shown in the FileChangesPanel.
 * This whitelist approach ensures that:
 *  - Events with no status yet (undefined/empty, i.e. awaiting permission) are hidden
 *  - Events that were denied / cancelled / failed are also hidden
 */
const APPLIED_STATUSES = new Set(['success', 'completed']);

/**
 * Check if two file paths refer to the same file.
 * Handles relative vs absolute paths across Windows, Linux, and MacOS.
 */
function pathsMatch(path1: string, path2: string): boolean {
  // Normalize: convert backslashes to forward slashes for cross-platform compatibility
  const normalize = (p: string) => p.replace(/\\/g, '/');
  const p1 = normalize(path1);
  const p2 = normalize(path2);

  // Exact match
  if (p1 === p2) return true;

  // Check if one path ends with the other (handles absolute vs relative)
  // Example: "C:/project/src/file.ts" ends with "src/file.ts"
  if (p1.endsWith('/' + p2)) return true;
  if (p2.endsWith('/' + p1)) return true;

  return false;
}

export function useFileChanges(
  chatId: string,
  sessionId: string,
  adapterName: string
) {
  const [toolCallEvents, setToolCallEvents] = useState<ToolCallEvent[]>([]);
  const [processedFiles, setProcessedFiles] = useState<string[]>([]);
  const [baseToolCallIndex, setBaseToolCallIndex] = useState(0);
  const [loadedSessionKey, setLoadedSessionKey] = useState('');
  const toolCallEventsRef = useRef<ToolCallEvent[]>([]);
  toolCallEventsRef.current = toolCallEvents;
  const processedFilesRef = useRef<string[]>([]);
  processedFilesRef.current = processedFiles;

  // Load persisted state from backend on mount / session change
  useEffect(() => {
    if (!sessionId || !adapterName) return;
    const key = `${sessionId}:${adapterName}`;
    if (loadedSessionKey === key) return;
    setLoadedSessionKey(key);

    // CRITICAL: Reset state when switching sessions to prevent old session data from contaminating new session
    // Reset refs IMMEDIATELY (synchronously) to prevent race conditions with event handlers
    processedFilesRef.current = [];
    toolCallEventsRef.current = [];

    setProcessedFiles([]);
    setBaseToolCallIndex(0);
    setToolCallEvents([]);

    try {
      if (window.__getChangesState) {
        window.__getChangesState(JSON.stringify({ chatId, sessionId, adapterName }));
      }
    } catch (err) {
      console.error('[useFileChanges] Failed to load changes state:', err);
    }
  }, [chatId, sessionId, adapterName, loadedSessionKey]);

  // Listen for changes state from backend + tool call events
  useEffect(() => {
    const unsubChangesState = ACPBridge.onChangesState((e) => {
      if (e.detail.chatId !== chatId) return;
      setBaseToolCallIndex(e.detail.state.baseToolCallIndex);
      setProcessedFiles(e.detail.state.processedFiles);
    });

    const unsubToolCall = ACPBridge.onToolCall((e) => {
      if (e.detail.chatId !== chatId) return;
      const payload = e.detail.payload;
      if (payload.diffs && payload.diffs.length > 0) {
        // Backend removes from processedFiles only for live (non-replay) tool calls and pushes state via onChangesState
        setToolCallEvents((prev) => [...prev, payload]);
      }
    });

    const unsubToolCallUpdate = ACPBridge.onToolCallUpdate((e) => {
      if (e.detail.chatId !== chatId) return;
      const payload = e.detail.payload;
      const hasDiffs = payload.diffs && payload.diffs.length > 0;

      if (hasDiffs) {
        // Backend removes from processedFiles only for live (non-replay) tool calls and pushes state via onChangesState
        setToolCallEvents((prevEvents) => {
          const existingIdx = prevEvents.findIndex((ev) => ev.toolCallId === payload.toolCallId);
          if (existingIdx >= 0) {
            const updated = [...prevEvents];
            updated[existingIdx] = payload;
            return updated;
          }
          return [...prevEvents, payload];
        });
      } else if (payload.toolCallId && payload.status) {
        // Status-only update (no diffs) — update existing event's status
        // This handles denied permissions, errors, etc.
        setToolCallEvents((prevEvents) => {
          const idx = prevEvents.findIndex((ev) => ev.toolCallId === payload.toolCallId);
          if (idx >= 0) {
            const updated = [...prevEvents];
            updated[idx] = { ...updated[idx], status: payload.status };
            return updated;
          }
          return prevEvents;
        });
      }
    });

    return () => {
      unsubChangesState();
      unsubToolCall();
      unsubToolCallUpdate();
    };
  }, [chatId, sessionId, adapterName]);

  // Compute file changes from accumulated tool call events
  const fileChanges = useMemo<FileChangeSummary[]>(() => {
    const changesMap = new Map<string, FileChangeSummary>();
    const eventsToProcess = toolCallEvents.slice(baseToolCallIndex);

    for (const event of eventsToProcess) {
      // Only show tool calls that have been explicitly confirmed as applied.
      // Events with no status yet (awaiting permission) or failed/denied events are excluded.
      if (!event.status || !APPLIED_STATUSES.has(event.status)) continue;

      for (const diff of event.diffs) {
        const filePath = diff.path;
        const fileName = filePath.split(/[\\/]/).pop() || filePath;
        const isNew = diff.oldText === null || diff.oldText === '';
        const status: 'A' | 'M' = isNew ? 'A' : 'M';

        const existing = changesMap.get(filePath);
        if (existing) {
          // Add operation to existing file changes
          existing.operations.push({ oldText: diff.oldText || '', newText: diff.newText });
          if (status === 'A' && existing.status !== 'A') existing.status = 'M';

          // Recompute total diff from first oldText to last newText
          const firstOldText = existing.operations[0].oldText;
          const lastNewText = existing.operations[existing.operations.length - 1].newText;
          const { additions, deletions } = computeDiffStats(firstOldText, lastNewText);
          existing.additions = additions;
          existing.deletions = deletions;
        } else {
          const { additions, deletions } = computeDiffStats(diff.oldText || '', diff.newText);
          changesMap.set(filePath, {
            filePath,
            fileName,
            status,
            additions,
            deletions,
            operations: [{ oldText: diff.oldText || '', newText: diff.newText }],
          });
        }
      }
    }

    return Array.from(changesMap.values()).filter(
      (fc) => !processedFiles.some(pf => pathsMatch(pf, fc.filePath))
    );
  }, [toolCallEvents, baseToolCallIndex, processedFiles]);

  const totalAdditions = useMemo(() => fileChanges.reduce((sum, fc) => sum + fc.additions, 0), [fileChanges]);
  const totalDeletions = useMemo(() => fileChanges.reduce((sum, fc) => sum + fc.deletions, 0), [fileChanges]);

  /** Remove all diffs for given file paths from accumulated tool call events */
  const removeDiffsForFiles = useCallback((paths: Set<string>) => {
    const pathsArray = Array.from(paths);
    setToolCallEvents((prev) =>
      prev.map((event) => ({
        ...event,
        diffs: event.diffs.filter((d) => !pathsArray.some(p => pathsMatch(p, d.path))),
      }))
    );
  }, []);

  const handleUndoFile = useCallback((filePath: string) => {
    const fc = fileChanges.find((f) => f.filePath === filePath);
    if (!fc) return;

    if (window.__undoFile) {
      window.__undoFile(JSON.stringify({
        chatId,
        filePath: fc.filePath,
        status: fc.status,
        operations: fc.operations,
      }));
    }

    if (window.__processFile && sessionId && adapterName) {
      window.__processFile(JSON.stringify({ sessionId, adapterName, filePath }));
      // Update local React state immediately so file disappears from UI (avoid duplicates with pathsMatch)
      setProcessedFiles((prev) =>
        prev.some(pf => pathsMatch(pf, filePath)) ? prev : [...prev, filePath]
      );
    }
    // Remove this file's diffs from events so old ops won't be re-counted
    removeDiffsForFiles(new Set([filePath]));
  }, [chatId, sessionId, adapterName, fileChanges, removeDiffsForFiles]);

  const handleUndoAllFiles = useCallback(() => {
    if (window.__undoAllFiles) {
      window.__undoAllFiles(JSON.stringify({
        chatId,
        files: fileChanges.map((fc) => ({
          filePath: fc.filePath,
          status: fc.status,
          operations: fc.operations,
        })),
      }));
    }

    const allPaths = new Set(fileChanges.map((fc) => fc.filePath));
    const allPathsArray: string[] = [];
    for (const fc of fileChanges) {
      if (window.__processFile && sessionId && adapterName) {
        window.__processFile(JSON.stringify({ sessionId, adapterName, filePath: fc.filePath }));
        allPathsArray.push(fc.filePath);
      }
    }
    // Update local React state immediately (avoid duplicates with pathsMatch)
    if (allPathsArray.length > 0) {
      setProcessedFiles((prev) => {
        const newFiles = allPathsArray.filter(fp => !prev.some(pf => pathsMatch(pf, fp)));
        return newFiles.length > 0 ? [...prev, ...newFiles] : prev;
      });
    }
    // Remove all files' diffs from events
    removeDiffsForFiles(allPaths);
  }, [chatId, sessionId, adapterName, fileChanges, removeDiffsForFiles]);

  const handleKeepFile = useCallback((filePath: string) => {
    if (window.__processFile && sessionId && adapterName) {
      window.__processFile(JSON.stringify({ sessionId, adapterName, filePath }));
      // Update local React state immediately so file disappears from UI (avoid duplicates with pathsMatch)
      setProcessedFiles((prev) =>
        prev.some(pf => pathsMatch(pf, filePath)) ? prev : [...prev, filePath]
      );
    }
    // Remove this file's diffs from events so old ops won't be re-counted
    removeDiffsForFiles(new Set([filePath]));
  }, [sessionId, adapterName, removeDiffsForFiles]);

  const handleKeepAll = useCallback(() => {
    if (window.__keepAll && sessionId && adapterName) {
      window.__keepAll(JSON.stringify({
        sessionId,
        adapterName,
        toolCallIndex: String(toolCallEvents.length),
      }));
    }
    setBaseToolCallIndex(toolCallEvents.length);
    setProcessedFiles([]);
  }, [sessionId, adapterName, toolCallEvents.length]);

  return {
    fileChanges,
    totalAdditions,
    totalDeletions,
    handleUndoFile,
    handleUndoAllFiles,
    handleKeepFile,
    handleKeepAll,
  };
}
