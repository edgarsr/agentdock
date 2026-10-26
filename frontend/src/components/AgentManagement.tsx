import type * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import { AgentOption } from '../types/chat';
import { ACPBridge } from '../utils/bridge';
import ConfirmationModal from './ConfirmationModal';
import { Bot, RefreshCw } from 'lucide-react';
import { ClaudeUsage } from './usage/ClaudeUsage';
import { CopilotUsage } from './usage/CopilotUsage';
import { CodexUsage } from './usage/CodexUsage';
import { AntigravityUsage } from './usage/AntigravityUsage';
import { CursorUsage } from './usage/CursorUsage';
import { QoderUsage } from './usage/QoderUsage';
import { Button } from './ui/Button';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { MenuButton } from './ui/MenuButton';
import { SplitButton } from './ui/SplitButton';
import { Tooltip } from './chat/shared/Tooltip';
import { AdapterUsageLifecycleProvider } from '../hooks/useAdapterUsage';
import { SectionPage } from './ui/SectionPage';

function mergeAgentSnapshot(previous: AgentOption | undefined, next: AgentOption): AgentOption {
  if (!previous) return next;

  const keepDownloadSnapshot = next.downloadedKnown !== true && previous.downloadedKnown === true;
  const keepReadySnapshot = next.readyKnown !== true && previous.readyKnown === true;
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
  const keepAgentVersion = (keepDownloadSnapshot || next.downloaded === true) && !next.downloading && !next.agentVersion && !!previous.agentVersion;
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
    agentVersion: keepAgentVersion ? previous.agentVersion : next.agentVersion,
    readyKnown: keepReadySnapshot ? previous.readyKnown : next.readyKnown,
    ready: keepReadySnapshot ? previous.ready : next.ready,
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

const formatVersion = (version: string) => /^\d/.test(version) ? `v${version}` : version;
const CLI_AUTH_TOOLTIP = 'You may need to restart the IDE after changing authentication via CLI.';

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

function CopilotUsageSection() {
  return (
    <UsageSection>
      <CopilotUsage />
    </UsageSection>
  );
}

export function AgentManagementView({
  initialAgents = [],
  isActive = false,
  hasOpenConversationsForAdapter,
  onUpdateAgent,
}: {
  initialAgents?: AgentOption[];
  isActive?: boolean;
  hasOpenConversationsForAdapter: (adapterId: string) => boolean;
  onUpdateAgent: (adapterId: string) => void;
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
  const [authActions, setAuthActions] = useState<Map<string, string>>(new Map());
  const prevIsActiveRef = useRef(isActive);
  const hasActivatedRef = useRef(false);

  useEffect(() => {
    const dispose = ACPBridge.onAdapters((e) => {
      const safeAdapters = Array.isArray(e.detail.adapters) ? e.detail.adapters : [];
      const { mergedAgents, nextSnapshots } = mergeAgentSnapshots(serviceProviderAgentSnapshots, safeAdapters);
      serviceProviderAgentSnapshots = nextSnapshots;
      setAgents(mergedAgents);
      setAuthActions(new Map(
        mergedAgents
          .filter(a => a.authenticating)
          .map(a => [a.id, a.authenticatingMethodId || ''] as const)
      ));
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

    return () => {
      dispose();
    };
  }, []);

  useEffect(() => {
    const wasActive = prevIsActiveRef.current;
    prevIsActiveRef.current = isActive;

    if (!isActive || wasActive === isActive || hasActivatedRef.current) return;

    hasActivatedRef.current = true;
    ACPBridge.requestAdapters();
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
    if (confirmUpdateId) {
      setInstallingIds(prev => new Set(prev).add(confirmUpdateId));
      onUpdateAgent(confirmUpdateId);
      setConfirmUpdateId(null);
    }
  };

  const handleCancelInstall = (id: string) => {
    ACPBridge.cancelAgentInstall(id);
    setAgents(prev => prev.map(a => (
      a.id === id
        ? { ...a, downloading: true, downloadStatus: 'Cancelling...' }
        : a
    )));
  };

  const handleLogin = (agent: AgentOption, methodId: string) => {
    setAuthActions(prev => new Map(prev).set(agent.id, methodId));
    window.__loginAgent?.(agent.id, methodId);
  };

  const handleLogout = (agent: AgentOption) => {
    setAuthActions(prev => new Map(prev).set(agent.id, ''));
    window.__logoutAgent?.(agent.id);
  };

  const handleCancelAuth = (agent: AgentOption) => {
    window.__cancelAgentAuth?.(agent.id);
  };

  const handleCliAuth = (agent: AgentOption) => {
    if (authActions.has(agent.id) || agent.authenticating) {
      window.__cancelAgentAuth?.(agent.id);
    }
    window.__openAgentCli?.(agent.id);
  };

  return (
    <AdapterUsageLifecycleProvider value={{ mode: 'provider', enabled: isActive }}>
      <div className="flex min-h-0 flex-col bg-background text-foreground">
      <SectionPage padding="px-5 pb-6">
          {agents.map((agent, index) => {
            const isDownloadedKnown = agent.downloadedKnown === true;
            const isDownloaded = agent.downloaded === true;
            const isInstalling = installingIds.has(agent.id) || agent.downloading;
            const isDeleting = deletingIds.has(agent.id);
            const isProcessing = isInstalling || isDeleting;
            const hasLocalAuthAction = authActions.has(agent.id);
            const isAuthenticating = hasLocalAuthAction || !!agent.authenticating;
            const authenticatingMethodId = hasLocalAuthAction
              ? authActions.get(agent.id) || ''
              : agent.authenticatingMethodId || '';
            const isLoggingOut = isAuthenticating && !authenticatingMethodId;
            const usesAcpLogin = agent.loginMethod === 'acp';
            const usesCliLogin = agent.loginMethod === 'cli';
            const hasLoginMenu = usesAcpLogin || usesCliLogin;
            const customAuthMethodsAvailable = agent.custom === true && (agent.authMethods?.length ?? 0) > 0;
            const isStarting = !!agent.initializing;
            const showLogin = !isStarting && (agent.custom === true
              ? customAuthMethodsAvailable
              : hasLoginMenu
                ? agent.loggedIn === false
                : agent.loggedIn !== true
            );
            const showLogout = !isStarting && agent.logoutAvailable === true && agent.loggedIn === true;
            const showCliAuthFallback = !isStarting && agent.loggedIn === true && agent.logoutAvailable !== true;
            const showUsage = agent.loginStatusSupported !== true || agent.loggedIn === true;
            const isLast = index === agents.length - 1;
            const initializationDetail = agent.initializationDetail?.trim();
            const canResolveStatus = isDownloaded && agent.readyKnown === true;
            const isStatusUnknown = isDownloaded && !isStarting && !canResolveStatus;
            const canUpdate = isDownloaded && agent.updateAvailable === true && !isInstalling;
            const agentVersionSuffix = agent.agentVersion ? ` (${formatVersion(agent.agentVersion)})` : '';
            const versionLabel = agent.installedVersion
              ? (canUpdate && agent.latestVersion
                  ? `${formatVersion(agent.installedVersion)}${agentVersionSuffix} -> ${formatVersion(agent.latestVersion)}`
                  : `${formatVersion(agent.installedVersion)}${agentVersionSuffix}`)
              : null;
            const statusLabel = isStarting
              ? 'Starting'
              : (agent.initializationError || agent.downloadStatus?.startsWith('Error'))
                ? 'Not ready'
              : agent.ready === true && agent.loginStatusSupported === true && agent.loggedIn === false
                ? 'Not logged in'
              : agent.ready === true
                ? 'Ready'
                : 'Not ready';
            const statusClass = isStarting
              ? 'text-foreground-secondary'
              : statusLabel === 'Ready'
                ? 'text-success'
              : statusLabel === 'Not logged in'
                ? 'text-warning'
                : 'text-error';
            const cliAuthTooltip = agent.cliAvailable
              ? CLI_AUTH_TOOLTIP
              : 'IDE terminal is required';

            return (
              <div key={agent.id} className={`flex group ${!isLast ? 'border-b border-border' : ''}`}>
                <div className="flex items-start gap-3 w-full py-1 section-medium:flex-wrap section-medium:gap-y-0">
                  {/* A narrow section leaves the room to the text; the name identifies the agent. */}
                  <div className="flex flex-col items-center shrink-0 w-10 min-w-10 py-4 section-medium:hidden">
                    {agent.custom ? (
                      <Bot className="h-8 w-8 text-foreground-secondary opacity-75" strokeWidth={1.5} />
                    ) : (
                      <img src={agent.iconPath} alt="" className="h-8 w-8 object-contain opacity-75" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1 py-4 text-ide-small text-foreground-secondary">
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
                        <Tooltip variant="minimal" content="Refresh status" className="flex">
                          <button
                            onClick={() => ACPBridge.requestAdapters(agent.id)}
                            disabled={agent.refreshing || isProcessing}
                            className={`text-foreground-secondary hover:text-foreground disabled:opacity-70
                              ${linkButtonFocusClassName}`}
                            aria-label={`Refresh ${agent.name} status`}
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${agent.refreshing ? 'animate-spin' : ''}`} />
                          </button>
                        </Tooltip>
                        {isStarting && initializationDetail && (
                          <span
                            className="min-w-0 truncate text-foreground-secondary"
                            title={initializationDetail}
                          >
                            {initializationDetail}
                          </span>
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

                      {!isInstalling && !agent.custom && isDownloaded && agent.downloadPath && (
                        <div className="flex items-center gap-1.5">
                          <span className="shrink-0">Path:</span>
                          {/* Wraps in the tooltip, so narrow windows show the whole path. */}
                          <Tooltip
                            variant="minimal"
                            content={agent.downloadPath}
                            className="min-w-0"
                            contentClassName="!whitespace-normal break-all font-mono"
                          >
                            <div className="font-mono truncate">{agent.downloadPath}</div>
                          </Tooltip>
                        </div>
                      )}

                      {showUsage && !isInstalling && isDownloaded && agent.ready === true && agent.id === 'claude-code' && (
                        <UsageSection>
                          <ClaudeUsage />
                        </UsageSection>
                      )}
                      {showUsage && !isInstalling && isDownloaded && agent.ready === true && agent.id === 'codex' && (
                        <UsageSection>
                          <CodexUsage />
                        </UsageSection>
                      )}
                      {showUsage && !isInstalling && isDownloaded && agent.ready === true && agent.id === 'antigravity' && (
                        <UsageSection>
                          <AntigravityUsage />
                        </UsageSection>
                      )}
                      {showUsage && !isInstalling && isDownloaded && agent.ready === true && agent.id === 'github-copilot-cli' && <CopilotUsageSection />}
                      {showUsage && !isInstalling && isDownloaded && agent.ready === true && agent.id === 'cursor-cli' && (
                        <UsageSection>
                          <CursorUsage />
                        </UsageSection>
                      )}
                      {showUsage && !isInstalling && isDownloaded && agent.ready === true && agent.id === 'qoder' && (
                        <UsageSection>
                          <QoderUsage />
                        </UsageSection>
                      )}

                      {!isInstalling && isDownloaded && agent.authError && (
                        <div className="text-error">{agent.authError}</div>
                      )}

                      {!isInstalling && agent.initializationError && (
                        <div className="text-error font-medium text-[13px]">{agent.initializationError}</div>
                      )}

                    </div>
                  </div>

                  {/* A narrow section moves the buttons to a row below the text. */}
                  <div className="flex shrink-0 flex-col items-end gap-2 py-4 whitespace-nowrap empty:hidden
                    section-medium:w-full section-medium:flex-row section-medium:flex-wrap section-medium:items-center
                    section-medium:pt-0">
                    {isInstalling ? (
                      <Button
                        onClick={() => handleCancelInstall(agent.id)}
                        variant="accentOutline"
                      >
                        Cancel
                      </Button>
                    ) : !isDownloadedKnown ? (
                      <div className="text-foreground-secondary">
                        <LoadingSpinner className="w-4 h-4" />
                      </div>
                    ) : !isDownloaded ? (
                      agent.custom ? null : (
                        <Button
                          onClick={() => handleDownload(agent.id)}
                          variant="install"
                        >
                          Install
                        </Button>
                      )
                    ) : (
                      <>
                        {!agent.custom && (canUpdate ? (
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
                        ))}
                        {showLogin && hasLoginMenu && (
                          isAuthenticating && !isLoggingOut ? (
                            <Button
                              onClick={() => handleCancelAuth(agent)}
                              disabled={isProcessing}
                              variant="outline"
                              leftIcon={<LoadingSpinner className="w-4 h-4" />}
                            >
                              Cancel
                            </Button>
                          ) : (
                            <MenuButton
                              label="Log in"
                              variant="primary"
                              // In a narrow section the button starts at the left edge, so the menu opens rightward.
                              menuClassName="section-medium:left-0 section-medium:right-auto"
                              disabled={isProcessing || isLoggingOut}
                              items={[
                                ...(usesAcpLogin
                                  ? (agent.authMethods || []).map(method => ({
                                      label: method.name,
                                      title: method.description || undefined,
                                      onClick: () => handleLogin(agent, method.id),
                                    }))
                                  : [{
                                      label: `${agent.name} login`,
                                      onClick: () => handleLogin(agent, 'cli'),
                                    }]),
                                ...(agent.cliAvailable ? [{
                                  label: 'CLI',
                                  onClick: () => handleCliAuth(agent),
                                }] : []),
                              ]}
                            />
                          )
                        )}
                        {((showLogin && !hasLoginMenu) || showCliAuthFallback) && (
                          <Tooltip variant="minimal" content={cliAuthTooltip} className="inline-flex">
                            <Button
                              onClick={() => handleCliAuth(agent)}
                              disabled={!agent.cliAvailable || isProcessing}
                              variant="outline"
                            >
                              CLI auth
                            </Button>
                          </Tooltip>
                        )}
                        {agent.custom && agent.loginMethod === 'cli' && !customAuthMethodsAvailable && (
                          <Tooltip variant="minimal" content={cliAuthTooltip} className="inline-flex">
                            <Button
                              onClick={() => handleCliAuth(agent)}
                              disabled={!agent.cliAvailable || isProcessing}
                              variant="outline"
                            >
                              CLI auth
                            </Button>
                          </Tooltip>
                        )}
                        {showLogout && (
                          <Button
                            onClick={() => (
                              isLoggingOut
                                ? handleCancelAuth(agent)
                                : handleLogout(agent)
                            )}
                            disabled={isProcessing}
                            variant="outline"
                            leftIcon={isLoggingOut ? <LoadingSpinner className="w-4 h-4" /> : undefined}
                          >
                            {isLoggingOut ? 'Cancel' : 'Log out'}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
      </SectionPage>

      <ConfirmationModal
        isOpen={confirmDeleteId !== null}
        title="Uninstall Agent"
        message={`Do you want to uninstall ${agents.find(a => a.id === confirmDeleteId)?.name || 'this agent'}?`}
        onConfirm={performDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />
      <ConfirmationModal
        isOpen={confirmUpdateId !== null}
        title="Update Agent"
        message={`Do you want to update ${agents.find(a => a.id === confirmUpdateId)?.name || 'this agent'} to the latest version?${
          confirmUpdateId && hasOpenConversationsForAdapter(confirmUpdateId)
            ? '\n\nOpen conversations using this agent will be closed, and active prompts will be cancelled.' : ''
        }`}
        onConfirm={performUpdate}
        onCancel={() => setConfirmUpdateId(null)}
      />
      </div>
    </AdapterUsageLifecycleProvider>
  );
}
