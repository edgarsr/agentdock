import { useState, useEffect } from 'react';
import { AgentOption } from '../types/chat';
import { ACPBridge } from '../utils/bridge';
import ConfirmationModal from './ConfirmationModal';

export function AgentManagementView() {
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [installingIds, setInstallingIds] = useState<Set<string>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    const cached = localStorage.getItem('unified-llm.adapters');
    if (cached) {
      try {
        setAgents(JSON.parse(cached));
      } catch (e) {}
    }

    if (window.__requestAdapters) {
      window.__requestAdapters();
    }

    return ACPBridge.onAdapters((e) => {
      const safeAdapters = Array.isArray(e.detail.adapters) ? e.detail.adapters : [];
      setAgents(safeAdapters);
      // Only clear IDs for agents whose operations have completed
      setDeletingIds(prev => {
        const next = new Set<string>();
        prev.forEach(id => { if (safeAdapters.some(a => a.id === id && a.downloaded)) next.add(id); });
        return next;
      });
      setInstallingIds(prev => {
        const next = new Set<string>();
        prev.forEach(id => { if (safeAdapters.some(a => a.id === id && !a.downloaded && a.downloading)) next.add(id); });
        return next;
      });
      localStorage.setItem('unified-llm.adapters', JSON.stringify(safeAdapters));
    });
  }, []);

  const handleDownload = (id: string) => {
    if (window.__downloadAgent) {
      setInstallingIds(prev => new Set(prev).add(id));
      window.__downloadAgent(id);
    }
  };

  const handleDelete = (id: string) => {
    setConfirmDeleteId(id);
  };

  const performDelete = () => {
    if (confirmDeleteId && window.__deleteAgent) {
      setDeletingIds(prev => new Set(prev).add(confirmDeleteId));
      window.__deleteAgent(confirmDeleteId);
      setConfirmDeleteId(null);
    }
  };

  const handleToggleEnabled = (id: string, currentEnabled: boolean) => {
    if (window.__toggleAgentEnabled) {
      window.__toggleAgentEnabled(id, !currentEnabled);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-6">
        <div className="max-w-[500px] mx-auto space-y-6">
          <header>
            <h2 className="text-xl font-bold tracking-tight">Service Providers</h2>
          </header>
          
          <div className="space-y-4">
            {agents.map((agent) => {
              const isInstalling = installingIds.has(agent.id) || agent.downloading;
              const isDeleting = deletingIds.has(agent.id);
              
              return (
                <article 
                  key={agent.id} 
                  className="bg-background-secondary border border-border rounded-xl p-5 shadow-sm space-y-6"
                >
                  {/* Title & Toggle */}
                  <div className="flex justify-between items-start gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-lg truncate">{agent.name}</h3>
                      </div>
                      <div className="font-mono text-foreground-secondary">
                        {agent.id}
                      </div>
                    </div>

                    <button
                        onClick={() => handleToggleEnabled(agent.id, agent.enabled)}
                        disabled={isInstalling || isDeleting}
                        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary/30 active:scale-95 ${agent.enabled ? 'bg-primary' : 'bg-background-secondary'} ${isInstalling || isDeleting ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                        <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${agent.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  {/* Installation Section */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="font-bold text-foreground-secondary">Installation</span>
                        {agent.downloaded && !isInstalling && (
                            <button
                                onClick={() => handleDelete(agent.id)}
                                disabled={isDeleting}
                                className="text-xs font-bold px-3 py-1 bg-red-500/5 text-red-500/80 border border-red-500/10 rounded hover:bg-red-500 hover:text-white transition-all focus:outline-none focus:ring-2 focus:ring-red-500/50 active:scale-95 cursor-pointer disabled:cursor-not-allowed disabled:active:scale-100"
                            >
                                {isDeleting ? 'Deleting...' : 'Uninstall'}
                            </button>
                        )}
                    </div>

                    {agent.downloaded ? (
                        <div className="bg-black rounded border border-border p-3 space-y-2">
                            <div className="font-mono break-all leading-tight">
                                {agent.downloadPath}
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-2">
                            {isInstalling ? (
                                <div className="flex items-center gap-3 py-2 text-primary font-bold">
                                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                    <span>Installing...</span>
                                    <span className="text-foreground-secondary font-normal italic truncate">{agent.downloadStatus}</span>
                                </div>
                            ) : (
                                <>
                                    {agent.downloadStatus?.startsWith('Error') && (
                                        <div className="text-red-500/80 py-1">{agent.downloadStatus}</div>
                                    )}
                                    <button
                                        onClick={() => handleDownload(agent.id)}
                                        className="w-fit px-4 py-2 bg-primary text-primary-foreground text-xs font-bold rounded shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/50 active:scale-95 cursor-pointer"
                                    >
                                        {agent.downloadStatus?.startsWith('Error') ? 'Retry Install' : 'Install Adapter'}
                                    </button>
                                </>
                            )}
                        </div>
                    )}
                  </div>

                  {/* Authentication Section */}
                  {agent.downloaded && agent.hasAuthentication && (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="font-bold text-foreground-secondary">Authentication</span>
                            <div className="flex items-center gap-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full ${agent.authAuthenticated ? 'bg-green-500' : 'bg-red-500'}`} />
                                <span className={`font-bold ${agent.authAuthenticated ? 'text-green-500/80' : 'text-red-500/80'}`}>
                                    {agent.authAuthenticated ? 'Authenticated' : 'Unauthorized'}
                                </span>
                            </div>
                        </div>

                        {/* Auth Key Path - Separate Box, Only if Authenticated */}
                        {agent.authAuthenticated && agent.authPath && (
                            <div className="bg-black rounded border border-border p-3">
                                <div className="font-mono break-all leading-tight">
                                    {agent.authPath}
                                </div>
                            </div>
                        )}
                        
                        <button
                            onClick={() => {
                                if (agent.authAuthenticated) window.__logoutAgent?.(agent.id);
                                else if (!agent.authenticating) window.__loginAgent?.(agent.id);
                            }}
                            disabled={agent.authenticating}
                            className={`px-4 py-2 rounded text-xs font-bold transition-all focus:outline-none ${
                                agent.authAuthenticated
                                    ? 'bg-background-secondary text-foreground border border-border hover:bg-background-secondary focus:ring-2 focus:ring-muted active:scale-95'
                                    : 'bg-primary text-primary-foreground shadow-sm focus:ring-2 focus:ring-primary/50 active:scale-95'
                            } ${agent.authenticating ? 'cursor-wait' : 'cursor-pointer'}`}
                        >
                            {agent.authenticating ? '...' : (agent.authAuthenticated ? 'Logout' : 'Login')}
                        </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      </div>

      <ConfirmationModal
        isOpen={confirmDeleteId !== null}
        title="Confirm Deletion"
        message={`Delete local files for ${agents.find(a => a.id === confirmDeleteId)?.name || ''}?`}
        onConfirm={performDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
