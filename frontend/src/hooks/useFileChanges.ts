import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ToolCallEvent, FileChangeSummary, ProcessedFileState } from '../types/chat';
import { ACPBridge } from '../utils/bridge';
import { buildReplayToolCallEvents } from '../utils/replay';

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
  conversationId: string,
  sessionId: string,
  adapterName: string
) {
  const [undoErrorMessage, setUndoErrorMessage] = useState<string | null>(null);
  const [statsByFilePath, setStatsByFilePath] = useState<Record<string, { additions: number; deletions: number }>>({});
  const [toolCallEvents, setToolCallEvents] = useState<ToolCallEvent[]>([]);
  const [processedFileStates, setProcessedFileStates] = useState<ProcessedFileState[]>([]);
  const [baseToolCallIndex, setBaseToolCallIndex] = useState(0);
  const [hasPluginEdits, setHasPluginEdits] = useState(false);
  const [pendingUndoFilePaths, setPendingUndoFilePaths] = useState<string[] | null>(null);
  const initialHasPluginEditsRef = useRef<boolean | null>(null);
  const [loadedSessionKey, setLoadedSessionKey] = useState('');
  const toolCallEventsRef = useRef<ToolCallEvent[]>([]);
  toolCallEventsRef.current = toolCallEvents;
  const fileChangesRef = useRef<FileChangeSummary[]>([]);

  // Load persisted state from backend on mount / session change
  useEffect(() => {
    if (!sessionId || !adapterName) return;
    const key = `${sessionId}:${adapterName}`;
    if (loadedSessionKey === key) return;
    setLoadedSessionKey(key);

    // CRITICAL: Reset state when switching sessions to prevent old session data from contaminating new session
    // Reset refs IMMEDIATELY (synchronously) to prevent race conditions with event handlers
    toolCallEventsRef.current = [];

    setProcessedFileStates([]);
    setBaseToolCallIndex(0);
    setToolCallEvents([]);
    setStatsByFilePath({});
    setHasPluginEdits(false);
    setPendingUndoFilePaths(null);
    setUndoErrorMessage(null);
    initialHasPluginEditsRef.current = null;

    try {
      if (window.__getChangesState) {
        window.__getChangesState(JSON.stringify({ chatId: conversationId, sessionId, adapterName }));
      }
    } catch (err) {
      console.error('[useFileChanges] Failed to load changes state:', err);
    }
  }, [conversationId, sessionId, adapterName, loadedSessionKey]);

  // Listen for changes state from backend + tool call events
  useEffect(() => {
    const unsubChangesState = ACPBridge.onChangesState((e) => {
      if (e.detail.chatId !== conversationId) return;
      
      const state = e.detail.state;
      const hasEdits = Boolean(state.hasPluginEdits);
      
      if (initialHasPluginEditsRef.current === null) {
          initialHasPluginEditsRef.current = hasEdits;
      }

      let newBaseIndex = state.baseToolCallIndex;

      // If this session loaded with NO plugin edits, and now the backend says it HAS edits,
      // it means the first live tool call just triggered state creation.
      // We must update the baseToolCallIndex to bypass all previous replay events (from CLI etc).
      if (!initialHasPluginEditsRef.current && hasEdits && state.baseToolCallIndex === 0) {
         const replayCount = toolCallEventsRef.current.filter(ev => ev.isReplay).length;
         if (replayCount > 0) {
            newBaseIndex = replayCount;
            if (window.__keepAll && sessionId && adapterName) {
               window.__keepAll(JSON.stringify({
                 sessionId,
                 adapterName,
                 toolCallIndex: String(replayCount)
               }));
            }
         }
         initialHasPluginEditsRef.current = true;
      }

      setBaseToolCallIndex(newBaseIndex);
      setProcessedFileStates(state.processedFileStates);
      setHasPluginEdits(hasEdits);
    });

    const unsubToolCall = ACPBridge.onToolCall((e) => {
      if (e.detail.chatId !== conversationId) return;
      const payload = e.detail.payload;
      if (payload.diffs && payload.diffs.length > 0) {
        // Backend clears stale per-file watermarks for live (non-replay) edits and pushes state via onChangesState.
        setToolCallEvents((prev) => [...prev, payload]);
      }
    });

    const unsubToolCallUpdate = ACPBridge.onToolCallUpdate((e) => {
      if (e.detail.chatId !== conversationId) return;
      const payload = e.detail.payload;
      const hasDiffs = payload.diffs && payload.diffs.length > 0;

      if (hasDiffs) {
        // Backend clears stale per-file watermarks for live (non-replay) edits and pushes state via onChangesState.
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

    const unsubConversationReplayLoaded = ACPBridge.onConversationReplayLoaded((e) => {
      if (e.detail.payload.chatId !== conversationId) return;
      setToolCallEvents(buildReplayToolCallEvents(e.detail.payload.data));
    });

    return () => {
      unsubChangesState();
      unsubToolCall();
      unsubToolCallUpdate();
      unsubConversationReplayLoaded();
    };
  }, [conversationId, sessionId, adapterName]);

  // Build per-file operation chains from accumulated tool call events.
  const baseFileChanges = useMemo<FileChangeSummary[]>(() => {
    const changesMap = new Map<string, FileChangeSummary>();
    const eventsToProcess = toolCallEvents.slice(baseToolCallIndex);

    for (const [offset, event] of eventsToProcess.entries()) {
      // Only show tool calls that have been explicitly confirmed as applied.
      // Events with no status yet (awaiting permission) or failed/denied events are excluded.
      if (!event.status || !APPLIED_STATUSES.has(event.status)) continue;

      for (const diff of event.diffs) {
        const filePath = diff.path;
        const fileName = filePath.split(/[\\/]/).pop() || filePath;
        const isNew = diff.oldText === null;
        const status: 'A' | 'M' = isNew ? 'A' : 'M';

        const eventIndex = baseToolCallIndex + offset;
        const existing = changesMap.get(filePath);
        if (existing) {
          existing.operations.push({ oldText: diff.oldText || '', newText: diff.newText });
          existing.latestToolCallIndex = eventIndex;
          if (status === 'A' && existing.status !== 'A') existing.status = 'M';
        } else {
          changesMap.set(filePath, {
            filePath,
            fileName,
            status,
            additions: 0,
            deletions: 0,
            operations: [{ oldText: diff.oldText || '', newText: diff.newText }],
            latestToolCallIndex: eventIndex,
          });
        }
      }
    }

    return Array.from(changesMap.values()).filter(
      (fc) => !processedFileStates.some(
        (processed) => pathsMatch(processed.filePath, fc.filePath) && processed.toolCallIndex >= fc.latestToolCallIndex
      )
    );
  }, [toolCallEvents, baseToolCallIndex, processedFileStates]);

  useEffect(() => {
    if (baseFileChanges.length === 0) {
      setStatsByFilePath({});
      return;
    }

    let cancelled = false;
    ACPBridge.computeFileChangeStats(baseFileChanges.map((fc) => ({
      filePath: fc.filePath,
      status: fc.status,
      operations: fc.operations,
    })))
      .then((result) => {
        if (cancelled) return;
        const nextStats: Record<string, { additions: number; deletions: number }> = {};
        result.files.forEach((file) => {
          nextStats[file.filePath] = {
            additions: file.additions,
            deletions: file.deletions,
          };
        });
        setStatsByFilePath(nextStats);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[useFileChanges] Failed to compute file change stats:', err);
          setStatsByFilePath({});
        }
      });

    return () => {
      cancelled = true;
    };
  }, [baseFileChanges]);

  const fileChanges = useMemo<FileChangeSummary[]>(() => {
    return baseFileChanges.map((fc) => {
      const stats = statsByFilePath[fc.filePath];
        return {
          ...fc,
          additions: stats?.additions ?? 0,
          deletions: stats?.deletions ?? 0,
        };
    });
  }, [baseFileChanges, statsByFilePath]);
  fileChangesRef.current = fileChanges;

  const totalAdditions = useMemo(() => fileChanges.reduce((sum, fc) => sum + fc.additions, 0), [fileChanges]);
  const totalDeletions = useMemo(() => fileChanges.reduce((sum, fc) => sum + fc.deletions, 0), [fileChanges]);
  const effectiveHasPluginEdits = hasPluginEdits || fileChanges.length > 0;

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

  const upsertProcessedFileState = useCallback((filePath: string, toolCallIndex: number) => {
    setProcessedFileStates((prev) => {
      const next = prev.filter((processed) => !pathsMatch(processed.filePath, filePath));
      next.push({ filePath, toolCallIndex });
      return next;
    });
  }, []);

  const handleUndoFile = useCallback((filePath: string) => {
    const fc = fileChanges.find((f) => f.filePath === filePath);
    if (!fc) return;

    if (window.__undoFile) {
      setPendingUndoFilePaths([fc.filePath]);
      window.__undoFile(JSON.stringify({
        chatId: conversationId,
        filePath: fc.filePath,
        status: fc.status,
        operations: fc.operations,
      }));
    }
  }, [conversationId, fileChanges]);

  const handleUndoAllFiles = useCallback(() => {
    if (window.__undoAllFiles) {
      setPendingUndoFilePaths(fileChanges.map((fc) => fc.filePath));
      window.__undoAllFiles(JSON.stringify({
        chatId: conversationId,
        files: fileChanges.map((fc) => ({
          filePath: fc.filePath,
          status: fc.status,
          operations: fc.operations,
        })),
      }));
    }
  }, [conversationId, fileChanges]);

  const handleKeepFile = useCallback((filePath: string) => {
    const fc = fileChanges.find((f) => f.filePath === filePath);
    if (!fc) return;

    if (window.__processFile && sessionId && adapterName) {
      window.__processFile(JSON.stringify({
        sessionId,
        adapterName,
        filePath,
        toolCallIndex: String(fc.latestToolCallIndex),
      }));
      upsertProcessedFileState(filePath, fc.latestToolCallIndex);
    }
    // Remove this file's diffs from events so old ops won't be re-counted
    removeDiffsForFiles(new Set([filePath]));
  }, [sessionId, adapterName, fileChanges, removeDiffsForFiles, upsertProcessedFileState]);

  const handleKeepAll = useCallback(() => {
    if (window.__keepAll && sessionId && adapterName) {
      window.__keepAll(JSON.stringify({
        sessionId,
        adapterName,
        toolCallIndex: String(toolCallEvents.length),
      }));
    }
    setBaseToolCallIndex(toolCallEvents.length);
    setProcessedFileStates([]);
  }, [sessionId, adapterName, toolCallEvents.length]);

  useEffect(() => {
    const unsubUndoResult = ACPBridge.onUndoResult((e) => {
      if (e.detail.chatId !== conversationId) return;
      if (!pendingUndoFilePaths || pendingUndoFilePaths.length === 0) return;

      const successfulFilePaths = e.detail.result.fileResults
        .filter((fileResult) => fileResult.success)
        .map((fileResult) => fileResult.filePath);
      const failedFileResults = e.detail.result.fileResults.filter((fileResult) => !fileResult.success);

      if (successfulFilePaths.length > 0) {
        const undoPaths = new Set(successfulFilePaths);
        for (const filePath of successfulFilePaths) {
          const fc = fileChangesRef.current.find((file) => pathsMatch(file.filePath, filePath));
          if (!fc || !window.__processFile || !sessionId || !adapterName) continue;
          window.__processFile(JSON.stringify({
            sessionId,
            adapterName,
            filePath: fc.filePath,
            toolCallIndex: String(fc.latestToolCallIndex),
          }));
          upsertProcessedFileState(fc.filePath, fc.latestToolCallIndex);
        }
        removeDiffsForFiles(undoPaths);
      }

      if (failedFileResults.length > 0) {
        setUndoErrorMessage(failedFileResults
          .map((fileResult) => `${fileResult.filePath}: ${fileResult.message}`)
          .join('\n'));
      } else if (!e.detail.result.success) {
        setUndoErrorMessage(e.detail.result.message);
      }

      setPendingUndoFilePaths(null);
    });

    return () => {
      unsubUndoResult();
    };
  }, [conversationId, sessionId, adapterName, pendingUndoFilePaths, removeDiffsForFiles, upsertProcessedFileState]);

  return {
    hasPluginEdits: effectiveHasPluginEdits,
    fileChanges,
    totalAdditions,
    totalDeletions,
    undoErrorMessage,
    clearUndoError: () => setUndoErrorMessage(null),
    handleUndoFile,
    handleUndoAllFiles,
    handleKeepFile,
    handleKeepAll,
  };
}
