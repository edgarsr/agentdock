import { FileChangeSummary } from '../types/chat';

export function useFileChanges(
  _chatId: string,
  _sessionId: string,
  _adapterName: string
) {
  return {
    fileChanges: [] as FileChangeSummary[],
    totalAdditions: 0,
    totalDeletions: 0,
    handleUndoFile: () => {},
    handleUndoAllFiles: () => {},
    handleKeepFile: () => {},
    handleKeepAll: () => {},
  };
}
