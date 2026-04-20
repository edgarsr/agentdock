import { useState, useEffect, useRef } from 'react';
import { AgentOption } from '../types/chat';
import { ACPBridge } from '../utils/bridge';
import ConfirmationModal from './ConfirmationModal';
import { RefreshCw } from 'lucide-react';
import { ClaudeUsage } from './usage/ClaudeUsage';
import { CopilotUsage } from './usage/CopilotUsage';
import { CodexUsage } from './usage/CodexUsage';
import { GeminiUsage } from './usage/GeminiUsage';
import { CursorUsage } from './usage/CursorUsage';
import { QoderUsage } from './usage/QoderUsage';
import { Button } from './ui/Button';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { SplitButton } from './ui/SplitButton';
import { resetAdapterUsageCaches, useAdapterUsage } from '../hooks/useAdapterUsage';

function mergeAgentSnapshot(previous: AgentOption | undefined, next: AgentOption): AgentOption {
  if (!previous) return next;

  const keepDownloadSnapshot = next.downloadedKnown !== true && previous.downloadedKnown === true;
  const keepReadySnapshot = next.readyKnown !== true && previous.readyKnown === true;
  const keepAuthSnapshot =
    next.hasAuthentication === true &&
    next.authUiMode !== 'manage_terminal' &&
    next.authKnown !== true &&
    previous.authKnown === true;
  const keepUpdateSnapshot =
    (keepDownloadSnapshot || next.updateSupported === true || previous.updateSupported === true) &&
    next.updateKnown !== true &&
    previous.updateKnown === true;
  const keepTransientDownloadStatus =
    !next.downloadStatus &&
    !next.downloading &&
    keepDownloadSnapshot &&
    !!previous.downloadStatus;
  const keepCliAvailability = keepDownloadSnapshot && previous.cliAvailable === true && next.cliAvailable !== true;
  const keepUpdateSupport = keepDownloadSnapshot && previous.updateSupported === true && next.updateSupported !== true;
  const keepInstalledVersion = (keepDownloadSnapshot || next.downloaded === true) && !next.installedVersion && !!previous.installedVersion;
  const keepLatestVersion = (keepDownloadSnapshot || keepUpdateSnapshot) && !next.latestVersion && !!previous.latestVersion;
  const keepDownloadPath = (keepDownloadSnapshot || next.downloaded === true) && !next.downloadPath && !!previous.downloadPath;

  return {
    ...previous,
    ...next,
    iconPath: next.iconPath || previous.iconPath,
    name: next.name || previous.name,
    downloadedKnown: keepDownloadSnapshot ? previous.downloadedKnown : next.downloadedKnown,
    downloaded: keepDownloadSnapshot ? previous.downloaded : next.downloaded,
    downloadPath: keepDownloadPath ? previous.downloadPath : next.downloadPath,
    installedVersion: keepInstalledVersion ? previous.installedVersion : next.installedVersion,
    readyKnown: keepReadySnapshot ? previous.readyKnown : next.readyKnown,
    ready: keepReadySnapshot ? previous.ready : next.ready,
    authKnown: keepAuthSnapshot ? previous.authKnown : next.authKnown,
    authAuthenticated: keepAuthSnapshot ? previous.authAuthenticated : next.authAuthenticated,
    updateSupported: keepUpdateSupport ? previous.updateSupported : next.updateSupported,
    latestVersion: keepLatestVersion ? previous.latestVersion : next.latestVersion,
    updateKnown: keepUpdateSnapshot ? previous.updateKnown : next.updateKnown,
    updateAvailable: keepUpdateSnapshot ? previous.updateAvailable : next.updateAvailable,
    downloadStatus: keepTransientDownloadStatus ? previous.downloadStatus : next.downloadStatus,
    cliAvailable: keepCliAvailability ? previous.cliAvailable : next.cliAvailable,
  };
}

function mergeAgentSnapshots(
  previousSnapshots: Record<string, AgentOption>,
  nextAgents: AgentOption[],
): { mergedAgents: AgentOption[]; nextSnapshots: Record<string, AgentOption> } {
  const nextSnapshots: Record<string, AgentOption> = {};
  const mergedAgents = nextAgents.map((agent) => {
    const merged = mergeAgentSnapshot(previousSnapshots[agent.id], agent);
    nextSnapshots[agent.id] = merged;
    return merged;
  });
  return { mergedAgents, nextSnapshots };
}

let serviceProviderAgentSnapshots: Record<string, AgentOption> = {};

function resetServiceProviderAgentSnapshots() {
  serviceProviderAgentSnapshots = {};
}

const linkButtonFocusClassName = [
  'focus:outline-none',
  'focus-visible:rounded-[3px]',
  'focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]',
].join(' ');

function UsageSection({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mt-[0.375rem] flex flex-wrap gap-x-4 gap-y-1 text-ide-small">{children}</div>
  );
}

function CopilotUsageSection({ refreshKey }: { refreshKey: number }) {
  const data = useAdapterUsage('github-copilot-cli');

  if (data) {
    try {
      const parsed = JSON.parse(data);
      if (parsed?.quota_snapshots?.premium_interactions?.unlimited === true) return null;
    } catch {
      // Let CopilotUsage handle malformed data fallback.
    }
  }

  return (
    <UsageSection>
      <CopilotUsage key={refreshKey} />
    </UsageSection>
  );
}

export function AgentManagementView({
  initialAgents = [],
  isActive = false,
}: {
  initialAgents?: AgentOption[];
  isActive?: boolean;
}) {
  const [agents, setAgents] = useState<AgentOption[]>(() => {
    if (Object.keys(serviceProviderAgentSnapshots).length > 0) {
      return Object.values(serviceProviderAgentSnapshots);
    }
    return initialAgents;
  });
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
      const { mergedAgents, nextSnapshots } = mergeAgentSnapshots(serviceProviderAgentSnapshots, safeAdapters);
      serviceProviderAgentSnapshots = nextSnapshots;
      setAgents(mergedAgents);
      setAuthIds(new Set(mergedAgents.filter(a => a.authenticating).map(a => a.id)));
      setDeletingIds(prev => {
        const next = new Set<string>();
        prev.forEach(id => {
          if (mergedAgents.some(a => a.id === id && a.downloaded === true)) next.add(id);
        });
        return next;
      });
      setInstallingIds(prev => {
        const next = new Set<string>();
        prev.forEach(id => {
          if (mergedAgents.some(a => a.id === id && a.downloaded === false && a.downloading)) next.add(id);
        });
        return next;
      });
    });

    ACPBridge.requestAdapters();

    return dispose;
  }, []);

  useEffect(() => {
    const dispose = ACPBridge.onExecutionTargetSwitched(() => {
      resetServiceProviderAgentSnapshots();
      setAgents([]);
    });

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
    resetServiceProviderAgentSnapshots();
    resetAdapterUsageCaches();
    setAgents([]);
    ACPBridge.requestAdapters();
    setRefreshKey(k => k + 1);
  };

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">
      <div className="flex items-center justify-end px-3 border-b border-border shrink-0 min-h-12">
        <button
          onClick={handleRefresh}
          className={`p-1 text-foreground-secondary hover:text-foreground transition-colors ${linkButtonFocusClassName}`}
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto w-full px-2 pb-16">
        <div className="flex flex-col max-w-[1200px] mx-auto w-full">
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
            const canUpdate = isDownloaded && agent.updateAvailable === true;
            const versionLabel = agent.installedVersion
              ? (canUpdate && agent.latestVersion
                  ? `v${agent.installedVersion} -> v${agent.latestVersion}`
                  : `v${agent.installedVersion}`)
              : null;
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
              <div key={agent.id} className={`flex group ${!isLast ? 'border-b border-border' : ''}`}>
                <div className="flex items-start gap-3 w-full px-2 py-1">
                  <div className="flex flex-col items-center shrink-0 w-10 min-w-10 py-4">
                    <img src={agent.iconPath} className="h-8 w-8 object-contain opacity-80" />
                  </div>

                  <div className="min-w-0 flex-1 self-center py-2 text-ide-small text-foreground-secondary">
                    <div className="flex items-baseline gap-1.5 mb-1">
                      <div className="font-semibold text-ide-regular text-foreground">{agent.name}</div>
                      {versionLabel && (<span className="text-foreground-secondary">{versionLabel}</span>)}
                    </div>

                    {!isInstalling && isDownloaded && (
                      <div className="flex items-center gap-1.5">
                        <span className="shrink-0">Status:</span>
                        {isStatusUnknown ? (<LoadingSpinner className="w-3 h-3" />) : (
                          <span className={`${statusClass} font-semibold`}>{statusLabel}</span>
                        )}
                      </div>
                    )}

                    <div className="flex flex-col gap-1.5">
                      {isInstalling && agent.downloadStatus && (
                        <div className="flex items-center gap-3">
                          <LoadingSpinner />
                          <span>Installing...</span>
                          <span className="font-normal italic truncate">{agent.downloadStatus}</span>
                        </div>
                      )}

                      {!isInstalling && agent.downloadStatus?.startsWith('Error') && (
                        <div className="text-error">{agent.downloadStatus}</div>
                      )}

                      {!isInstalling && isDownloaded && agent.downloadPath && (
                        <div className="flex items-center gap-1.5">
                          <span className="shrink-0">Path:</span>
                          <span className="font-mono truncate" title={agent.downloadPath}>
                            {agent.downloadPath}
                          </span>
                        </div>
                      )}

                      {!isInstalling && isDownloaded && agent.ready === true && agent.id === 'claude-code' && (
                        <UsageSection>
                          <ClaudeUsage key={refreshKey} />
                        </UsageSection>
                      )}
                      {!isInstalling && isDownloaded && agent.ready === true && agent.id === 'gemini-cli' && (
                        <UsageSection>
                          <GeminiUsage key={refreshKey} disabledModels={agent.disabledModels} />
                        </UsageSection>
                      )}
                      {!isInstalling && isDownloaded && agent.ready === true && agent.id === 'codex' && (
                        <UsageSection>
                          <CodexUsage key={refreshKey} />
                        </UsageSection>
                      )}
                      {!isInstalling && isDownloaded && agent.ready === true && agent.id === 'github-copilot-cli' && <CopilotUsageSection refreshKey={refreshKey} />}
                      {!isInstalling && isDownloaded && agent.ready === true && agent.id === 'cursor-cli' && <CursorUsage />}
                      {!isInstalling && isDownloaded && agent.ready === true && agent.id === 'qoder' && (
                        <UsageSection>
                          <QoderUsage />
                        </UsageSection>
                      )}

                      {!isInstalling && isDownloaded && (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
                          {agent.hasAuthentication && !isManageAuth && agent.authKnown === true && (
                            <button
                              type="button"
                              onClick={() => handleAuth(agent)}
                              disabled={isProcessing || isAuthenticating}
                              className={`text-link hover:underline disabled:opacity-50 transition-colors flex items-center gap-1 select-none whitespace-nowrap ${linkButtonFocusClassName}`}
                            >
                              {isAuthenticating && (
                                <LoadingSpinner className="w-3 h-3" />
                              )}
                              {agent.authAuthenticated === true ? 'Log out' : 'Log in'}
                            </button>
                          )}
                          {!agent.cliAvailable && (
                            <span className="basis-full text-error">IDE terminal is required</span>
                          )}
                          <button
                            type="button"
                            onClick={() => window.__openAgentCli?.(agent.id)}
                            disabled={!agent.cliAvailable}
                            className={`text-link hover:underline disabled:opacity-50 transition-colors select-none whitespace-nowrap ${linkButtonFocusClassName}`}
                          >
                            CLI auth
                          </button>
                        </div>
                      )}

                      {!isInstalling && agent.initializationError && (
                        <div className="text-error font-medium text-[13px]">{agent.initializationError}</div>
                      )}

                    </div>
                  </div>

                  <div className="flex items-center py-4 whitespace-nowrap">
                    {!isDownloadedKnown ? (
                      <div className="text-foreground-secondary">
                        <LoadingSpinner className="w-4 h-4" />
                      </div>
                    ) : !isDownloaded ? (
                      !isInstalling && (
                        <Button
                          onClick={() => handleDownload(agent.id)}
                          variant="install"
                        >
                          Install
                        </Button>
                      )
                    ) : (
                      <>
                        {canUpdate ? (
                          <SplitButton
                            label="Update"
                            onAction={() => handleUpdate(agent.id)}
                            disabled={isDeleting || isInstalling}
                            menuItems={[
                              {
                                label: (
                                  <span className="inline-flex items-center gap-2">
                                    {isDeleting ? <LoadingSpinner className="w-4 h-4" /> : null}
                                    {isDeleting ? 'Uninstalling' : 'Uninstall'}
                                  </span>
                                ),
                                onClick: () => handleDelete(agent.id),
                              },
                            ]}
                          />
                        ) : (
                          <Button
                            onClick={() => handleDelete(agent.id)}
                            disabled={isDeleting || isInstalling}
                            variant="accentOutline"
                            leftIcon={isDeleting ? <LoadingSpinner className="w-4 h-4" /> : undefined}
                          >
                            {isDeleting ? 'Uninstalling' : 'Uninstall'}
                          </Button>
                        )}
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
        title="Uninstall Service Provider"
        message={`Do you want to uninstall ${agents.find(a => a.id === confirmDeleteId)?.name || 'this service provider'}?`}
        onConfirm={performDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />
      <ConfirmationModal
        isOpen={confirmUpdateId !== null}
        title="Update Service Provider"
        message={`Do you want to update ${agents.find(a => a.id === confirmUpdateId)?.name || 'this service provider'} to the latest version?`}
        onConfirm={performUpdate}
        onCancel={() => setConfirmUpdateId(null)}
      />
    </div>
  );
}
