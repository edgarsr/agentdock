import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ToolCallEvent, FileChangeSummary, ProcessedFileState } from '../types/chat';
import { ACPBridge } from '../utils/bridge';
import { buildReplayToolCallEvents } from '../utils/replay';
import { applyToolCallEvent, pendingToolCallEvents, stableToolCallEventId } from '../utils/toolCallUtils';

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
  const normalize = (path: string) => {
    const normalized = path
      .trim()
      .replace(/\\/g, '/')
      .replace(/\/+/g, '/')
      .replace(/^\.\//, '')
      .replace(/\/$/, '');
    return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
  };

  const isAbsolute = (path: string) => /^[A-Za-z]:\//.test(path) || path.startsWith('/');
  const p1 = normalize(path1);
  const p2 = normalize(path2);
  if (p1 === p2) return true;

  const p1Absolute = isAbsolute(p1);
  const p2Absolute = isAbsolute(p2);
  if (p1Absolute === p2Absolute) return false;

  const absolutePath = p1Absolute ? p1 : p2;
  const relativePath = p1Absolute ? p2 : p1;
  return relativePath.length > 0 && absolutePath.endsWith(`/${relativePath}`);
}

export function useFileChanges(
  conversationId: string,
  sessionId: string,
  adapterName: string
) {
  const [undoErrorMessage, setUndoErrorMessage] = useState<string | null>(null);
  const [computedStats, setComputedStats] = useState<{
    source: FileChangeSummary[];
    byFilePath: Record<string, { additions: number; deletions: number }>;
  } | null>(null);
  const [replayToolCallEvents, setReplayToolCallEvents] = useState<ToolCallEvent[]>([]);
  const [liveToolCallEvents, setLiveToolCallEvents] = useState<ToolCallEvent[]>([]);
  const [processedFileStates, setProcessedFileStates] = useState<ProcessedFileState[]>([]);
  const [keptToolCallIds, setKeptToolCallIds] = useState<string[]>([]);
  const [hasPluginEdits, setHasPluginEdits] = useState(false);
  const [pendingUndoFilePaths, setPendingUndoFilePaths] = useState<string[] | null>(null);
  const pendingUndoFilePathsRef = useRef<string[] | null>(null);
  pendingUndoFilePathsRef.current = pendingUndoFilePaths;
  const initialHasPluginEditsRef = useRef<boolean | null>(null);
  const [loadedSessionKey, setLoadedSessionKey] = useState('');
  const replayToolCallEventsRef = useRef<ToolCallEvent[]>([]);
  replayToolCallEventsRef.current = replayToolCallEvents;
  const fileChangesRef = useRef<FileChangeSummary[]>([]);

  // Load persisted state from backend on mount / session change
  useEffect(() => {
    if (!sessionId || !adapterName) return;
    const key = `${sessionId}:${adapterName}`;
    if (loadedSessionKey === key) return;
    setLoadedSessionKey(key);

    // CRITICAL: Reset state when switching sessions to prevent old session data from contaminating new session
    // Reset refs IMMEDIATELY (synchronously) to prevent race conditions with event handlers
    replayToolCallEventsRef.current = [];

    setProcessedFileStates([]);
    setKeptToolCallIds([]);
    setReplayToolCallEvents([]);
    setLiveToolCallEvents([]);
    setComputedStats(null);
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

      setKeptToolCallIds(state.keptToolCallIds);

      // If this session loaded with NO plugin edits, and now the backend says it HAS edits,
      // it means the first live tool call just triggered state creation.
      // Mark the pre-existing replay events as handled before tracking this session's live edits.
      if (!initialHasPluginEditsRef.current && hasEdits && state.keptToolCallIds.length === 0) {
         const replayIds = replayToolCallEventsRef.current.flatMap((event) => event.eventId ? [event.eventId] : []);
         if (replayIds.length > 0) {
            setKeptToolCallIds(replayIds);
            if (window.__keepAll && sessionId && adapterName) {
               window.__keepAll(JSON.stringify({
                 sessionId,
                 adapterName,
                 toolCallIds: replayIds
               }));
            }
         }
         initialHasPluginEditsRef.current = true;
      }

      setProcessedFileStates(state.processedFileStates);
      setHasPluginEdits(hasEdits);
    });

    const unsubToolCall = ACPBridge.onToolCall((e) => {
      if (e.detail.chatId !== conversationId) return;
      // Backend creates the session changes state for the first live edit.
      const payload = {
        ...e.detail.payload,
        eventId: stableToolCallEventId(adapterName, sessionId, e.detail.payload.toolCallId),
      };
      setLiveToolCallEvents((events) => applyToolCallEvent(events, payload, 'tool_call'));
    });

    const unsubToolCallUpdate = ACPBridge.onToolCallUpdate((e) => {
      if (e.detail.chatId !== conversationId) return;
      const payload = {
        ...e.detail.payload,
        eventId: stableToolCallEventId(adapterName, sessionId, e.detail.payload.toolCallId),
      };
      setLiveToolCallEvents((events) => applyToolCallEvent(events, payload, 'tool_call_update'));
    });

    const unsubConversationReplayLoaded = ACPBridge.onConversationReplayLoaded((e) => {
      if (e.detail.payload.chatId !== conversationId) return;
      const replayEvents = buildReplayToolCallEvents(e.detail.payload.data);
      replayToolCallEventsRef.current = replayEvents;
      setReplayToolCallEvents(replayEvents);
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
    const keptIds = new Set(keptToolCallIds);
    const eventsToProcess = pendingToolCallEvents(
      replayToolCallEvents,
      liveToolCallEvents,
      keptIds
    );

    for (const event of eventsToProcess) {
      // Only show tool calls that have been explicitly confirmed as applied.
      // Events with no status yet (awaiting permission) or failed/denied events are excluded.
      if (!event.status || !APPLIED_STATUSES.has(event.status)) continue;

      for (const diff of event.diffs) {
        const filePath = diff.path;
        if (processedFileStates.some((processed) => (
          pathsMatch(processed.filePath, filePath)
          && Boolean(event.eventId)
          && processed.toolCallIds.includes(event.eventId!)
        ))) continue;
        const fileName = filePath.split(/[\\/]/).pop() || filePath;
        const isNew = diff.oldText === null;
        const status: 'A' | 'M' = isNew ? 'A' : 'M';

        const existing = changesMap.get(filePath);
        if (existing) {
          existing.operations.push({ oldText: diff.oldText || '', newText: diff.newText });
          if (event.eventId && !existing.toolCallIds.includes(event.eventId)) {
            existing.toolCallIds.push(event.eventId);
          }
          if (status === 'A' && existing.status !== 'A') existing.status = 'M';
        } else {
          changesMap.set(filePath, {
            filePath,
            fileName,
            status,
            additions: 0,
            deletions: 0,
            operations: [{ oldText: diff.oldText || '', newText: diff.newText }],
            toolCallIds: event.eventId ? [event.eventId] : [],
          });
        }
      }
    }

    return Array.from(changesMap.values());
  }, [
    replayToolCallEvents,
    liveToolCallEvents,
    keptToolCallIds,
    processedFileStates,
  ]);

  useEffect(() => {
    if (baseFileChanges.length === 0) {
      setComputedStats(null);
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
        setComputedStats({ source: baseFileChanges, byFilePath: nextStats });
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[useFileChanges] Failed to compute file change stats:', err);
          setComputedStats({ source: baseFileChanges, byFilePath: {} });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [baseFileChanges]);

  const statsPending = baseFileChanges.length > 0 && computedStats?.source !== baseFileChanges;
  const statsByFilePath = computedStats?.source === baseFileChanges ? computedStats.byFilePath : {};

  const fileChanges = useMemo<FileChangeSummary[]>(() => {
    if (statsPending) return baseFileChanges;

    return baseFileChanges.flatMap((fc) => {
      const stats = statsByFilePath[fc.filePath];
      if (!stats || (stats.additions === 0 && stats.deletions === 0)) return [];
      return [{
        ...fc,
        additions: stats.additions,
        deletions: stats.deletions,
      }];
    });
  }, [baseFileChanges, statsByFilePath, statsPending]);
  fileChangesRef.current = fileChanges;

  const totalAdditions = useMemo(() => fileChanges.reduce((sum, fc) => sum + fc.additions, 0), [fileChanges]);
  const totalDeletions = useMemo(() => fileChanges.reduce((sum, fc) => sum + fc.deletions, 0), [fileChanges]);
  const effectiveHasPluginEdits = hasPluginEdits || fileChanges.length > 0;

  /** Remove all diffs for given file paths from accumulated tool call events */
  const removeDiffsForFiles = useCallback((paths: Set<string>) => {
    const pathsArray = Array.from(paths);
    const removeDiffs = (prev: ToolCallEvent[]) =>
      prev.map((event) => ({
        ...event,
        diffs: event.diffs.filter((d) => !pathsArray.some(p => pathsMatch(p, d.path))),
      }));
    setReplayToolCallEvents(removeDiffs);
    setLiveToolCallEvents(removeDiffs);
  }, []);

  const upsertProcessedFileState = useCallback((filePath: string, toolCallIds: string[]) => {
    setProcessedFileStates((prev) => {
      const existing = prev.find((processed) => pathsMatch(processed.filePath, filePath));
      const next = prev.filter((processed) => !pathsMatch(processed.filePath, filePath));
      next.push({
        filePath,
        toolCallIds: Array.from(new Set([...(existing?.toolCallIds || []), ...toolCallIds])),
      });
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
        toolCallIds: fc.toolCallIds,
      }));
      upsertProcessedFileState(filePath, fc.toolCallIds);
    }
    // Remove this file's diffs from events so old ops won't be re-counted
    removeDiffsForFiles(new Set([filePath]));
  }, [sessionId, adapterName, fileChanges, removeDiffsForFiles, upsertProcessedFileState]);

  const handleKeepAll = useCallback(() => {
    const allToolCallIds = Array.from(new Set([
      ...keptToolCallIds,
      ...processedFileStates.flatMap((processed) => processed.toolCallIds),
      ...[...replayToolCallEvents, ...liveToolCallEvents]
        .flatMap((event) => event.eventId ? [event.eventId] : []),
    ]));
    if (window.__keepAll && sessionId && adapterName) {
      window.__keepAll(JSON.stringify({
        sessionId,
        adapterName,
        toolCallIds: allToolCallIds,
      }));
    }
    setKeptToolCallIds(allToolCallIds);
    setProcessedFileStates([]);
  }, [
    sessionId,
    adapterName,
    keptToolCallIds,
    processedFileStates,
    replayToolCallEvents,
    liveToolCallEvents,
  ]);

  useEffect(() => {
    const unsubUndoResult = ACPBridge.onUndoResult((e) => {
      if (e.detail.chatId !== conversationId) return;
      // Read via ref so this effect does not re-register on every undo state change.
      const currentPendingPaths = pendingUndoFilePathsRef.current;
      if (!currentPendingPaths || currentPendingPaths.length === 0) return;

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
            toolCallIds: fc.toolCallIds,
          }));
          upsertProcessedFileState(fc.filePath, fc.toolCallIds);
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
  }, [conversationId, sessionId, adapterName, removeDiffsForFiles, upsertProcessedFileState]);

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
