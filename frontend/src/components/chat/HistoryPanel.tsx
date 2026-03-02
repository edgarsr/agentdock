import { useEffect, useMemo, useState } from 'react';
import { ACPBridge } from '../../utils/bridge';
import type { AgentOption, HistorySessionMeta } from '../../types/chat';
import ConfirmationModal from './ConfirmationModal';

interface HistoryPanelProps {
  onClose: () => void;
  availableAgents: AgentOption[];
  onOpenSession: (session: HistorySessionMeta) => void;
}

export default function HistoryPanel({ onClose, availableAgents, onOpenSession }: HistoryPanelProps) {
  const [historyList, setHistoryList] = useState<HistorySessionMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionToDelete, setSessionToDelete] = useState<HistorySessionMeta | null>(null);

  useEffect(() => {
    const unsub = ACPBridge.onHistoryList((e) => {
      const list = Array.isArray(e.detail.list) ? e.detail.list : [];
      setHistoryList(list);
      setIsLoading(false);
    });

    ACPBridge.requestHistoryList();

    return () => {
      unsub();
    };
  }, []);

  const adapterDisplay = useMemo(() => {
    const map = new Map<string, string>();
    availableAgents.forEach((a) => map.set(a.id, a.displayName));
    return map;
  }, [availableAgents]);

  const formatDate = (ms: number) =>
    new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const confirmDelete = () => {
    if (sessionToDelete) {
      ACPBridge.deleteHistorySession(sessionToDelete);
      setSessionToDelete(null);
    }
  };

  const refreshHistory = () => {
    setIsLoading(true);
    ACPBridge.requestHistoryList();
  };

  return (
    <div className="flex flex-col h-full bg-background text-foreground z-10 w-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-foreground/80">Chat History</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={refreshHistory}
            disabled={isLoading}
            className={`p-1  rounded transition-colors text-foreground/60 hover:text-foreground ${isLoading ? 'animate-spin opacity-50' : ''}`}
            title="Refresh History"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 12c0-4.4 3.6-8 8-8 3.3 0 6.2 2 7.4 5M22 12c0 4.4-3.6 8-8 8-3.3 0-6.2-2-7.4-5"/>
            </svg>
          </button>
          <button
            onClick={onClose}
            className="p-1  rounded transition-colors text-foreground/60 hover:text-foreground"
            title="Close History Panel"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto w-full p-4 space-y-2">
        {isLoading ? (
          <div className="flex justify-center p-8 text-foreground/40">Loading history...</div>
        ) : historyList.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-foreground/40 h-full">
            <p className="text-sm italic">No history available yet.</p>
          </div>
        ) : (
          historyList.map((item) => (
            <div
              key={item.filePath}
              className="group relative"
            >
              <button
                type="button"
                onClick={() => onOpenSession(item)}
                className="w-full text-left p-4 rounded-lg bg-background-secondary border border-border hover:border-primary/40  transition-colors"
              >
                <div className="font-semibold text-sm truncate pr-8">{item.title}</div>
                <div className="text-xs text-foreground/60 mt-1 flex items-center gap-2">
                  <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded uppercase tracking-wider font-bold">
                    {adapterDisplay.get(item.adapterName) || item.adapterName}
                  </span>
                  {item.modelId ? <span>{item.modelId}</span> : null}
                </div>
                <div className="text-xs text-foreground/40 mt-2">{formatDate(item.updatedAt)}</div>
              </button>
              
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSessionToDelete(item);
                }}
                className="absolute top-4 right-4 p-1.5 opacity-0 group-hover:opacity-100 hover:bg-error/10 hover:text-error rounded transition-all text-foreground/40"
                title="Delete Session"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  <line x1="10" y1="11" x2="10" y2="17"></line>
                  <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
              </button>
            </div>
          ))
        )}
      </div>

      <ConfirmationModal
        isOpen={!!sessionToDelete}
        title="Delete Session"
        message={`Are you sure you want to delete "${sessionToDelete?.title}"? This action cannot be undone.`}
        onConfirm={confirmDelete}
        onCancel={() => setSessionToDelete(null)}
      />
    </div>
  );
}
