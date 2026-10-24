import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import TabBar, { TabBarProps } from './components/TabBar';
import { Sidebar } from './components/Sidebar';
import { AppTabContent } from './components/AppTabContent';
import { AppSectionContent } from './components/AppSectionContent';
import { EmptyStateView } from './components/EmptyStateView';
import { SidebarVisibilityButton } from './components/LayoutControls';
import { SectionPopup } from './components/SectionPopup';
import { getNavigationActions } from './components/tabbar/NavigationActions';
import { useHistoryGroupNav } from './components/history/useHistoryGroupNav';
import ConfirmationModal from './components/ConfirmationModal';
import { useAppController } from './hooks/app/useAppController';
import { useAppLayout } from './hooks/app/useAppLayout';
import { useAppShortcuts } from './hooks/useShortcuts';
import { useSidebarLayout } from './hooks/useSidebarLayout';
import { ACPBridge } from './utils/bridge';
import type { GlobalSettings } from './types/chat';

const SIDEBAR_ANIMATION_MS = 200;
/** From this content width `app-wide:` widens side padding. */
const WIDE_CONTENT_MIN_WIDTH_PX = 720;
const SETTINGS_RETRY_MS = 2000;

/** Earlier versions kept these two in localStorage, which a browser UI does not share with JCEF; they move to the settings once. */
function migrateLocalStorageSettings(settings: GlobalSettings | undefined) {
  const approvalMode = localStorage.getItem('chat-approval-mode');
  const sendMode = localStorage.getItem('chat-send-mode');
  if (!settings || (approvalMode === null && sendMode === null)) return;
  localStorage.removeItem('chat-approval-mode');
  localStorage.removeItem('chat-send-mode');
  if (approvalMode !== 'auto' && sendMode !== 'ctrl-enter') return;
  ACPBridge.saveGlobalSettings({
    ...settings,
    ...(approvalMode === 'auto' ? { approvalMode: 'auto' as const } : {}),
    ...(sendMode === 'ctrl-enter' ? { sendMode: 'ctrl-enter' as const } : {}),
  });
}

function App() {
  const { isWide, isIslandsTheme, viewportWidth } = useAppLayout();
  /** Narrower windows leave no room for the section names in the section popup. */
  const compactSections = viewportWidth < 700;
  const [openInEditor, setOpenInEditor] = useState(
    () => ACPBridge.getGlobalSettingsSnapshot()?.settings?.openInEditor ?? true
  );
  const [browserAccessEnabled, setBrowserAccessEnabled] = useState(
    () => ACPBridge.getGlobalSettingsSnapshot()?.settings?.browserAccessEnabled ?? true
  );
  const [promptNavigationHoverOnly, setPromptNavigationHoverOnly] = useState(
    () => ACPBridge.getGlobalSettingsSnapshot()?.settings?.promptNavigationHoverOnly ?? true
  );
  const [userMessageDetailsHoverOnly, setUserMessageDetailsHoverOnly] = useState(
    () => ACPBridge.getGlobalSettingsSnapshot()?.settings?.userMessageDetailsHoverOnly ?? false
  );
  const [systemInstructionsEnabled, setSystemInstructionsEnabled] = useState(
    () => ACPBridge.getGlobalSettingsSnapshot()?.settings?.systemInstructionsEnabled ?? false
  );
  const [sidebarEnabled, setSidebarEnabled] = useSidebarLayout();
  const [sidebarPosition, setSidebarPosition] = useState<GlobalSettings['sidebarPosition']>(
    () => ACPBridge.getGlobalSettingsSnapshot()?.settings?.sidebarPosition === 'right' ? 'right' : 'left'
  );
  // Nothing is shown until the saved settings arrive, so the layout does not jump from the defaults on load.
  const [settingsLoaded, setSettingsLoaded] = useState(() => ACPBridge.getGlobalSettingsSnapshot() !== undefined);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [sidebarVisibilityAnimating, setSidebarVisibilityAnimating] = useState(false);
  const sidebarAnimationTimerRef = useRef<number>();

  const setSidebarVisibility = (hidden: boolean) => {
    window.clearTimeout(sidebarAnimationTimerRef.current);
    setSidebarVisibilityAnimating(true);
    setSidebarHidden(hidden);
    sidebarAnimationTimerRef.current = window.setTimeout(
      () => setSidebarVisibilityAnimating(false),
      SIDEBAR_ANIMATION_MS
    );
  };

  useEffect(() => () => window.clearTimeout(sidebarAnimationTimerRef.current), []);

  // A window that is narrow when the UI first appears starts with the sidebar hidden, so it does not cover the content.
  useLayoutEffect(() => {
    if (settingsLoaded) setSidebarHidden(!isWide);
  }, [settingsLoaded]);

  // Narrowing the window past the breakpoint hides the sidebar instead of laying it over the content.
  useEffect(() => {
    if (settingsLoaded && !isWide) setSidebarVisibility(true);
  }, [isWide]);

  // The tab bar chosen in the settings; turning the sidebar on again shows it.
  useEffect(() => {
    if (!sidebarEnabled) setSidebarHidden(false);
  }, [sidebarEnabled]);

  useEffect(() => {
    const applyGlobalSettings = (payload: { settings?: Partial<GlobalSettings> } | undefined) => {
      setOpenInEditor(payload?.settings?.openInEditor ?? true);
      setBrowserAccessEnabled(payload?.settings?.browserAccessEnabled ?? true);
      setPromptNavigationHoverOnly(payload?.settings?.promptNavigationHoverOnly ?? true);
      setUserMessageDetailsHoverOnly(payload?.settings?.userMessageDetailsHoverOnly ?? false);
      setSystemInstructionsEnabled(payload?.settings?.systemInstructionsEnabled ?? false);
      setSidebarPosition(payload?.settings?.sidebarPosition === 'right' ? 'right' : 'left');
      const contentMaxWidthPx = payload?.settings?.contentMaxWidthPx ?? 760;
      document.documentElement.style.setProperty('--app-content-max-width', contentMaxWidthPx ? `${contentMaxWidthPx}px` : 'none');
      setSettingsLoaded(true);
    };

    // A lost request or reply would leave the UI empty until a restart, so the request repeats until the settings arrive.
    let retryTimer: number | undefined;
    const cleanup = ACPBridge.onGlobalSettings((e) => {
      window.clearInterval(retryTimer);
      migrateLocalStorageSettings(e.detail?.payload?.settings);
      applyGlobalSettings(e.detail?.payload);
    });

    const requestSettings = () => {
      window.clearInterval(retryTimer);
      retryTimer = window.setInterval(ACPBridge.loadGlobalSettings, SETTINGS_RETRY_MS);
      ACPBridge.loadGlobalSettings();
    };

    if (window.__settingsBridgeReady) {
      requestSettings();
    } else {
      window.addEventListener('settings-bridge-ready', requestSettings);
    }

    return () => {
      cleanup();
      window.clearInterval(retryTimer);
      window.removeEventListener('settings-bridge-ready', requestSettings);
    };
  }, []);

  const {
    workspaceLoaded,
    chats,
    tabs,
    activeTabId,
    activeSection,
    mountedSections,
    tabUi,
    handleRenameTab,
    availableAgents,
    runnableAgents,
    agentAvailabilityResolved,
    historyList,
    historyLoaded,
    pendingAgentSwitch,
    pendingCloseTabIds,
    handleConfirmCloseTabs,
    handleCancelCloseTabs,
    pendingAgentName,
    pendingHandoffsByTab,
    handleSelectTab,
    handleShowHome,
    handleReorderTabs,
    handleCloseTab,
    handleCloseAllChats,
    hasOpenConversationsForAdapter,
    handleUpdateAgent,
    defaultNewTabAgentId,
    handleNewTab,
    handleOpenHistory,
    openSection,
    openSettings,
    closeActiveSection,
    handleUserMessageSent,
    handleAssistantActivity,
    handleCanMarkReadChange,
    handlePermissionRequestChange,
    handleProcessingChange,
    handleQueuedChange,
    requestAgentSwitch,
    handleHandoffConsumed,
    handleForkRequest,
    handleChatSessionStateChange,
    handleContinueInNewTab,
    handleContinueInCurrentConversation,
    handleCancelAgentSwitch,
  } = useAppController();

  const appContentRef = useRef<HTMLDivElement>(null);
  const [contentWide, setContentWide] = useState(false);
  useLayoutEffect(() => {
    const el = appContentRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setContentWide(el.clientWidth >= WIDE_CONTENT_MIN_WIDTH_PX));
    observer.observe(el);
    return () => observer.disconnect();
  }, [settingsLoaded, workspaceLoaded]);
  // Listed apart: the archive lists the archived conversations, the history and the empty state the others.
  const [unarchivedHistory, archivedHistory] = useMemo(() => [
    historyList.filter((item) => !item.archived),
    historyList.filter((item) => item.archived),
  ], [historyList]);
  // The archive's last conversation is gone: its section is no longer listed.
  useEffect(() => {
    if (activeSection === 'archive' && archivedHistory.length === 0) openSection('history');
  }, [activeSection, archivedHistory, openSection]);
  // System instructions were turned off: their section is no longer listed.
  useEffect(() => {
    if (!systemInstructionsEnabled && activeSection === 'system-instructions') closeActiveSection();
  }, [systemInstructionsEnabled, activeSection, closeActiveSection]);
  const [archiveGroup, setArchiveGroup] = useState<string | null>(null);
  const { historyGroup, setHistoryGroup, historyGroupNav } =
    useHistoryGroupNav(unarchivedHistory, activeSection, openSection);

  const navigationProps: TabBarProps = {
    isIslandsTheme,
    chats,
    tabs,
    historyList,
    activeTabId,
    tabUi,
    onSelectTab: handleSelectTab,
    onReorderTabs: handleReorderTabs,
    onCloseTab: handleCloseTab,
    onCloseAllChats: handleCloseAllChats,
    onNewTab: () => handleNewTab(),
    onNewTabWithAgent: (agentId) => handleNewTab(agentId),
    onRenameTab: handleRenameTab,
    agents: availableAgents,
    noRunnableAgents: agentAvailabilityResolved && runnableAgents.length === 0,
    onOpenHistory: () => openSection('history'),
    onOpenManagement: () => openSection('management'),
    onOpenLastSettings: openSettings,
    onOpenDesignSystem: () => openSection('design'),
    onOpenMcp: () => openSection('mcp'),
    onOpenCustomAcp: () => openSection('custom-acp'),
    onOpenPromptLibrary: () => openSection('prompt-library'),
    onOpenSystemInstructions: () => openSection('system-instructions'),
    onOpenSettings: openSection,
    sidebarPosition,
    onUseSidebar: !sidebarEnabled ? () => setSidebarLayoutEnabled(true) : undefined,
  };

  // Chat numbers follow the visible list: open tabs in the tab bar, open and pinned chats in the sidebar.
  useAppShortcuts({
    chats: sidebarEnabled ? chats : tabs,
    activeChatId: activeTabId,
    onSelectChat: handleSelectTab,
    onNewChat: handleNewTab,
    onCloseChat: handleCloseTab,
    onOpenSection: openSection,
    onOpenSettings: openSettings,
  });

  function setSidebarLayoutEnabled(enabled: boolean) {
    setSidebarEnabled(enabled);
    setSidebarHidden(false);
  }

  const toggleOpenInEditor = () => {
    const settings = ACPBridge.getGlobalSettingsSnapshot()?.settings;
    if (settings) {
      ACPBridge.saveGlobalSettings({ ...settings, openInEditor: !settings.openInEditor });
    }
  };

  const toggleSidebarPosition = () => {
    const settings = ACPBridge.getGlobalSettingsSnapshot()?.settings;
    if (settings) {
      ACPBridge.saveGlobalSettings({
        ...settings,
        sidebarPosition: settings.sidebarPosition === 'right' ? 'left' : 'right',
      });
    }
  };

  if (!settingsLoaded || !workspaceLoaded) return <div className="h-full bg-background" />;

  return (
    <div
      className={`relative h-full min-w-[320px] bg-background text-foreground overflow-hidden flex ${sidebarEnabled ? 'flex-row' : 'flex-col'} ${!sidebarEnabled || isWide ? '[--content-top-inset:1rem]' : ''} ${userMessageDetailsHoverOnly ? '[--user-message-details-opacity:0]' : ''}`}
    >
      {sidebarEnabled ? (
        <Sidebar
          {...navigationProps}
          position={sidebarPosition}
          hidden={sidebarHidden}
          animateVisibility={sidebarVisibilityAnimating}
          overlay={!isWide}
          preferredWidth={sidebarWidth}
          viewportWidth={viewportWidth}
          newTabAgentId={defaultNewTabAgentId}
          onWidthChange={setSidebarWidth}
          onHide={() => setSidebarVisibility(true)}
          onShowHome={handleShowHome}
          onUseTabBar={() => setSidebarLayoutEnabled(false)}
          openInEditor={openInEditor}
          onToggleOpenInEditor={toggleOpenInEditor}
          browserAccessEnabled={browserAccessEnabled}
          onTogglePosition={toggleSidebarPosition}
        />
      ) : <TabBar {...navigationProps} />}

      {sidebarEnabled && !sidebarHidden && !isWide ? (
        <div
          aria-hidden="true"
          className="absolute inset-0 z-30"
          onClick={() => setSidebarVisibility(true)}
        />
      ) : null}

      {sidebarEnabled && sidebarHidden ? (
        <SidebarVisibilityButton
          position={sidebarPosition}
          hidden
          onClick={() => setSidebarVisibility(false)}
        />
      ) : null}

      <div id="app-content" ref={appContentRef} data-wide={contentWide || undefined} className="flex-1 relative min-h-0 min-w-0">
        {/* Chat tabs stay mounted so their sessions and UI state are preserved. */}
        {tabs.map((tab) => {
          const isTabActive = tab.id === activeTabId;

          return (
            <AppTabContent
              key={tab.id}
              tab={tab}
              isActive={isTabActive}
              runnableAgents={runnableAgents}
              promptNavigationHoverOnly={promptNavigationHoverOnly}
              pendingHandoff={pendingHandoffsByTab[tab.id]}
              onUserMessageSent={() => handleUserMessageSent(tab.id)}
              onAssistantActivity={() => handleAssistantActivity(tab.id)}
              onCanMarkReadChange={(canMarkRead) => handleCanMarkReadChange(tab.id, canMarkRead)}
              onPermissionRequestChange={(hasPendingPermission) => handlePermissionRequestChange(tab.id, hasPendingPermission)}
              onProcessingChange={(isProcessing) => handleProcessingChange(tab.id, isProcessing)}
              onQueuedChange={(hasQueuedPrompts) => handleQueuedChange(tab.id, hasQueuedPrompts)}
              onAgentChangeRequest={(payload) => requestAgentSwitch(tab.id, payload)}
              onForkRequest={(payload) => handleForkRequest(tab.id, payload)}
              onHandoffConsumed={(handoffId) => handleHandoffConsumed(tab.id, handoffId)}
              onSessionStateChange={(state) => handleChatSessionStateChange(tab.id, state)}
            />
          );
        })}

        {/* Empty state */}
        {!activeTabId && (
          <EmptyStateView
            runnableAgents={runnableAgents}
            loaded={agentAvailabilityResolved && historyLoaded}
            onStartWithAgent={handleNewTab}
            onOpenManagement={() => openSection('management')}
            agents={availableAgents}
            // In the history order, pinned ones first.
            recentChats={unarchivedHistory.slice(0, 5)}
            historyCount={unarchivedHistory.length}
            onOpenChat={handleOpenHistory}
            onOpenHistory={() => openSection('history')}
          />
        )}
      </div>

      {/* Sections mount on first use and remain cached without becoming tabs. */}
      <SectionPopup
        sections={getNavigationActions({
          ...navigationProps,
          onOpenArchive: archivedHistory.length > 0 ? () => openSection('archive') : undefined,
          onOpenSystemInstructions: systemInstructionsEnabled ? navigationProps.onOpenSystemInstructions : undefined,
        })}
        activeSection={activeSection}
        compact={compactSections}
        sidebarLayout={sidebarEnabled}
        historyGroupNav={historyGroupNav}
        onClose={closeActiveSection}
      >
        {mountedSections.map((section) => (
          <AppSectionContent
            key={section}
            section={section}
            tabs={tabs}
            tabUi={tabUi}
            historyList={section === 'archive' ? archivedHistory : unarchivedHistory}
            historyLoaded={historyLoaded}
            historyGroup={section === 'archive' ? archiveGroup : historyGroup}
            onHistoryGroupChange={section === 'archive' ? setArchiveGroup : setHistoryGroup}
            isActive={section === activeSection}
            availableAgents={availableAgents}
            hasOpenConversationsForAdapter={hasOpenConversationsForAdapter}
            onUpdateAgent={handleUpdateAgent}
            onOpenHistory={handleOpenHistory}
          />
        ))}
      </SectionPopup>

      <ConfirmationModal
        isOpen={pendingCloseTabIds !== null}
        title={pendingCloseTabIds && pendingCloseTabIds.length > 1 ? 'Close Chats' : 'Close Chat'}
        message={pendingCloseTabIds && pendingCloseTabIds.length > 1
          ? 'Some chats have unfinished prompts. Closing these chats will stop active prompts and discard all queued prompts.'
          : 'This chat has unfinished prompts. Closing it will stop any active prompt and discard all queued prompts.'}
        confirmLabel={pendingCloseTabIds && pendingCloseTabIds.length > 1 ? 'Close Chats' : 'Close Chat'}
        cancelLabel="Cancel"
        onConfirm={handleConfirmCloseTabs}
        onCancel={handleCancelCloseTabs}
      />

      <ConfirmationModal
        isOpen={pendingAgentSwitch !== null}
        title={`Switch to ${pendingAgentName}`}
        message={`Click "Continue" to pass the current chat context to ${pendingAgentName}.` + "\n" + `Click "Start New" to begin a new separate chat.`}
        confirmLabel="Continue"
        secondaryActionLabel="Start New"
        onSecondaryAction={handleContinueInNewTab}
        showCancelButton={false}
        onConfirm={handleContinueInCurrentConversation}
        onCancel={handleCancelAgentSwitch}
      />
    </div>
  );
}

export default App;
