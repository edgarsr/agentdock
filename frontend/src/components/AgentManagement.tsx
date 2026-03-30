import { useState, useEffect, useRef } from 'react';
import { AgentOption } from '../types/chat';
import { ACPBridge } from '../utils/bridge';
import ConfirmationModal from './ConfirmationModal';
import { RefreshCw } from 'lucide-react';
import { ClaudeUsage } from './usage/ClaudeUsage';
import { CodexUsage } from './usage/CodexUsage';
import { GeminiUsage } from './usage/GeminiUsage';
import { CursorUsage } from './usage/CursorUsage';

export function AgentManagementView({
  initialAgents = [],
  isActive = false,
}: {
  initialAgents?: AgentOption[];
  isActive?: boolean;
}) {
  const [agents, setAgents] = useState<AgentOption[]>(initialAgents);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [installingIds, setInstallingIds] = useState<Set<string>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmUpdateId, setConfirmUpdateId] = useState<string | null>(null);
  const [authIds, setAuthIds] = useState<Set<string>>(new Set());
  const [refreshKey, setRefreshKey] = useState(0);
  const prevIsActiveRef = useRef(isActive);
  const hasActivatedRef = useRef(false);

  useEffect(() => {
    const dispose = ACPBridge.onAdapters((e) => {
      const safeAdapters = Array.isArray(e.detail.adapters) ? e.detail.adapters : [];
      setAgents(safeAdapters);
      setAuthIds(new Set(safeAdapters.filter(a => a.authenticating).map(a => a.id)));
      setDeletingIds(prev => {
        const next = new Set<string>();
        prev.forEach(id => {
          if (safeAdapters.some(a => a.id === id && a.downloaded === true)) next.add(id);
        });
        return next;
      });
      setInstallingIds(prev => {
        const next = new Set<string>();
        prev.forEach(id => {
          if (safeAdapters.some(a => a.id === id && a.downloaded === false && a.downloading)) next.add(id);
        });
        return next;
      });
    });

    ACPBridge.requestAdapters();

    return dispose;
  }, []);

  useEffect(() => {
    const wasActive = prevIsActiveRef.current;
    prevIsActiveRef.current = isActive;

    if (!isActive || wasActive === isActive || hasActivatedRef.current) return;

    hasActivatedRef.current = true;
    ACPBridge.requestAdapters();
    setRefreshKey((k) => k + 1);
  }, [isActive]);

  const handleDownload = (id: string) => {
    if (!window.__downloadAgent) return;
    setInstallingIds(prev => new Set(prev).add(id));
    setAgents(prev => prev.map(a => (
      a.id === id
        ? { ...a, downloading: true, downloaded: false, downloadedKnown: true, downloadStatus: 'Starting download...', authError: '' }
        : a
    )));
    window.__downloadAgent(id);
  };

  const handleDelete = (id: string) => {
    setConfirmDeleteId(id);
  };

  const handleUpdate = (id: string) => {
    setConfirmUpdateId(id);
  };

  const performDelete = () => {
    if (confirmDeleteId && window.__deleteAgent) {
      setDeletingIds(prev => new Set(prev).add(confirmDeleteId));
      window.__deleteAgent(confirmDeleteId);
      setConfirmDeleteId(null);
    }
  };

  const performUpdate = () => {
    if (confirmUpdateId && window.__updateAgent) {
      setInstallingIds(prev => new Set(prev).add(confirmUpdateId));
      window.__updateAgent(confirmUpdateId);
      setConfirmUpdateId(null);
    }
  };

  const handleAuth = (agent: AgentOption) => {
    if (authIds.has(agent.id) || agent.authenticating || agent.authLoading) return;
    setAuthIds(prev => new Set(prev).add(agent.id));

    if ((agent.authUiMode ?? 'login_logout') === 'manage_terminal') {
      if (!agent.cliAvailable) {
        setAuthIds(prev => {
          const next = new Set(prev);
          next.delete(agent.id);
          return next;
        });
        return;
      }
      window.__openAgentCli?.(agent.id);
      setAuthIds(prev => {
        const next = new Set(prev);
        next.delete(agent.id);
        return next;
      });
      return;
    }

    if (agent.authAuthenticated) {
      window.__logoutAgent?.(agent.id);
    } else {
      window.__loginAgent?.(agent.id);
    }
  };

  const handleRefresh = () => {
    ACPBridge.requestAdapters();
    setRefreshKey(k => k + 1);
  };

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden font-sans">
      <div className="flex items-center justify-end px-3 py-2 border-b border-border shrink-0 min-h-12">
        <button
          onClick={handleRefresh}
          className="p-1 text-foreground-secondary hover:text-foreground transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto w-full p-2 space-y-1">
        <div className="flex flex-col">
          {agents.map((agent, index) => {
            const isDownloadedKnown = agent.downloadedKnown === true;
            const isDownloaded = agent.downloaded === true;
            const isInstalling = installingIds.has(agent.id) || agent.downloading;
            const isDeleting = deletingIds.has(agent.id);
            const isProcessing = isInstalling || isDeleting;
            const isAuthenticating = authIds.has(agent.id) || !!agent.authenticating;
            const authUiMode = agent.authUiMode ?? 'login_logout';
            const isManageAuth = authUiMode === 'manage_terminal';
            const isLast = index === agents.length - 1;
            const isStarting = !!agent.initializing;
            const isAuthKnown = isManageAuth || agent.hasAuthentication !== true || agent.authKnown === true;
            const canResolveStatus = isDownloaded && agent.readyKnown === true && isAuthKnown;
            const isStatusUnknown = isDownloaded && !isStarting && !canResolveStatus;
            const isUpdateChecking = isDownloaded && agent.updateSupported === true && agent.updateChecking === true;
            const canUpdate = isDownloaded && agent.updateAvailable === true;
            const statusLabel = isStarting
              ? 'Starting'
              : (agent.hasAuthentication === true && agent.authKnown === true && agent.authAuthenticated === false)
                ? 'Not logged in'
              : (agent.initializationError || agent.downloadStatus?.startsWith('Error'))
                ? 'Not ready'
              : agent.ready === true
                ? 'Ready'
                : 'Not ready';
            const statusClass = isStarting
              ? 'text-foreground-secondary'
              : statusLabel === 'Ready'
                ? 'text-success'
                : 'text-error';

            return (
              <div
                key={agent.id}
                className={`flex py-8 group ${!isLast ? 'border-b border-border' : ''}`}
              >
                <div className="flex items-start gap-3 w-full px-2">
                  <div className="flex flex-col items-center shrink-0 w-10 min-w-10 pt-0.5">
                    {agent.iconPath ? (
                      <img src={agent.iconPath} alt={agent.name} className="h-9 w-9 object-contain" />
                    ) : (
                      <div className="flex items-center justify-center rounded bg-background border border-border font-bold uppercase h-9 w-9 text-base">
                        {agent.name.charAt(0)}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1 flex flex-col justify-center gap-2">
                    <div className="flex items-center gap-2 flex-wrap min-h-6">
                      <span className="font-bold text-base">{agent.name}</span>
                    </div>

                    {!isInstalling && isDownloaded && (
                      <div className="flex items-center gap-1.5 text-[13px]">
                        <span className="font-medium shrink-0 text-foreground-secondary">Status:</span>
                        {isStatusUnknown ? (
                          <RefreshCw className="w-3 h-3 animate-spin text-foreground-secondary" />
                        ) : (
                          <span className={`font-medium ${statusClass}`}>
                            {statusLabel}
                          </span>
                        )}
                      </div>
                    )}

                    <div className="flex flex-col gap-1.5 text-[13px]">
                      {isInstalling && agent.downloadStatus && (
                        <div className="flex items-center gap-3 py-1 text-primary font-bold text-[13px]">
                          <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                          <span>Installing...</span>
                          <span className="text-foreground-secondary font-normal italic truncate">{agent.downloadStatus}</span>
                        </div>
                      )}

                      {!isInstalling && agent.downloadStatus?.startsWith('Error') && (
                        <div className="text-error font-medium text-[13px]">{agent.downloadStatus}</div>
                      )}

                      {!isInstalling && isDownloaded && agent.downloadPath && (
                        <div className="flex items-center gap-1.5 text-foreground-secondary">
                          <span className="font-medium shrink-0">Path:</span>
                          <span className="font-mono opacity-90 truncate" title={agent.downloadPath}>
                            {agent.downloadPath}
                          </span>
                        </div>
                      )}

                      {!isInstalling && isDownloaded && agent.ready === true && agent.id === 'claude-code' && <ClaudeUsage key={refreshKey} />}
                      {!isInstalling && isDownloaded && agent.ready === true && agent.id === 'gemini-cli' && <GeminiUsage key={refreshKey} disabledModels={agent.disabledModels} />}
                      {!isInstalling && isDownloaded && agent.ready === true && agent.id === 'codex' && <CodexUsage key={refreshKey} />}
                      {!isInstalling && isDownloaded && agent.ready === true && agent.id === 'cursor-cli' && <CursorUsage />}

                      {!isInstalling && isDownloaded && agent.hasAuthentication && (
                        <div className="flex flex-col gap-1 items-start text-foreground-secondary">
                          {(isManageAuth || agent.authKnown === true) && (
                            <button
                              type="button"
                              onClick={() => handleAuth(agent)}
                              disabled={
                                isProcessing ||
                                isAuthenticating ||
                                (isManageAuth && !agent.cliAvailable)
                              }
                              className="text-link hover:brightness-150 focus:outline-none disabled:opacity-50 transition-colors flex items-center gap-1 font-medium select-none"
                            >
                              {isAuthenticating && (
                                <RefreshCw className="w-3 h-3 animate-spin" />
                              )}
                              {isManageAuth ? 'CLI auth' : (agent.authAuthenticated === true ? 'Log out' : 'Log in')}
                            </button>
                          )}
                          {isManageAuth && !agent.cliAvailable && (
                            <span className="text-error">IDE terminal is required</span>
                          )}
                          {!isManageAuth && agent.authKnown === true && (agent.id === 'claude-code' || agent.id === 'codex') && (
                            <button
                              type="button"
                              onClick={() => window.__openAgentCli?.(agent.id)}
                              disabled={!agent.cliAvailable}
                              className="text-link hover:brightness-150 focus:outline-none disabled:opacity-50 transition-colors font-medium select-none"
                            >
                              CLI auth
                            </button>
                          )}
                        </div>
                      )}

                      {!isInstalling && agent.initializationError && (
                        <div className="text-error font-medium text-[13px]">{agent.initializationError}</div>
                      )}

                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 pt-0.5 whitespace-nowrap">
                    {!isDownloadedKnown ? (
                      <RefreshCw className="w-4 h-4 animate-spin text-foreground-secondary" />
                    ) : !isDownloaded ? (
                      !isInstalling && (
                        <button
                          onClick={() => handleDownload(agent.id)}
                          className="px-4 py-1 flex items-center justify-center bg-primary text-primary-foreground border-primary-border outline outline-1 outline-primary/30 outline-offset-1 hover:brightness-110 font-medium rounded-[4px] disabled:opacity-50 transition-colors select-none focus:outline-none focus:ring-2 focus:ring-primary/50 text-[13px]"
                        >
                          Install
                        </button>
                      )
                    ) : (
                      <>
                        {isUpdateChecking && !canUpdate && (
                          <RefreshCw className="w-4 h-4 animate-spin text-foreground-secondary" />
                        )}
                        {canUpdate && (
                          <button
                            onClick={() => handleUpdate(agent.id)}
                            disabled={isDeleting || isInstalling}
                            className="px-4 py-1 flex items-center justify-center bg-primary text-primary-foreground border-primary-border outline outline-1 outline-primary/30 outline-offset-1 hover:brightness-110 font-medium rounded-[4px] disabled:opacity-50 transition-colors select-none focus:outline-none focus:ring-2 focus:ring-primary/50 text-[13px]"
                          >
                            Update
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(agent.id)}
                          disabled={isDeleting || isInstalling}
                          className="px-4 py-1 flex items-center justify-center bg-secondary text-secondary-foreground border border-secondary-border hover:brightness-110 font-medium rounded-[4px] disabled:opacity-50 transition-colors select-none focus:outline-none focus:ring-2 focus:ring-primary/50 text-[13px]"
                        >
                          {isDeleting ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Uninstall'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <ConfirmationModal
        isOpen={confirmDeleteId !== null}
        title="Confirm Uninstall"
        message={`Are you sure you want to uninstall ${agents.find(a => a.id === confirmDeleteId)?.name || 'this agent'}?`}
        onConfirm={performDelete}
        confirmLabel="Confirm"
        onCancel={() => setConfirmDeleteId(null)}
      />
      <ConfirmationModal
        isOpen={confirmUpdateId !== null}
        title="Confirm Update"
        message={`Are you sure you want to update ${agents.find(a => a.id === confirmUpdateId)?.name || 'this agent'} to the latest version?`}
        onConfirm={performUpdate}
        confirmLabel="Update"
        onCancel={() => setConfirmUpdateId(null)}
      />
    </div>
  );
}
