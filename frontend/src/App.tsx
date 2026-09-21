import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import TabBar, { TabBarProps } from './components/TabBar';
import { Sidebar } from './components/Sidebar';
import { AppTabContent } from './components/AppTabContent';
import { AppSectionContent } from './components/AppSectionContent';
import { EmptyStateView } from './components/EmptyStateView';
import { SidebarLayoutControls } from './components/LayoutControls';
import ConfirmationModal from './components/ConfirmationModal';
import { useAppController } from './hooks/app/useAppController';
import { useAppLayout } from './hooks/app/useAppLayout';
import { ACPBridge } from './utils/bridge';
import {
  DEFAULT_SIDEBAR_EXPANDED_SECTIONS,
  type GlobalSettings,
  type SidebarSectionId,
} from './types/chat';

const SIDEBAR_ANIMATION_MS = 200;

function normalizeSidebarExpandedSections(value: unknown): SidebarSectionId[] {
  if (!Array.isArray(value)) return [...DEFAULT_SIDEBAR_EXPANDED_SECTIONS];
  return [...new Set(value.filter((section): section is SidebarSectionId => (
    section === 'new-chat' || section === 'recent-chats' || section === 'sections'
  )))];
}

function App() {
  const { isWide, isIslandsTheme, viewportWidth } = useAppLayout();
  const [openInEditor, setOpenInEditor] = useState(
    () => ACPBridge.getGlobalSettingsSnapshot()?.settings?.openInEditor ?? true
  );
  const [sidebarEnabled, setSidebarEnabled] = useState(
    () => ACPBridge.getGlobalSettingsSnapshot()?.settings?.sidebarEnabled ?? true
  );
  const [sidebarPosition, setSidebarPosition] = useState<GlobalSettings['sidebarPosition']>(
    () => ACPBridge.getGlobalSettingsSnapshot()?.settings?.sidebarPosition === 'right' ? 'right' : 'left'
  );
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [sidebarExpandedSections, setSidebarExpandedSections] = useState<SidebarSectionId[]>(
    () => normalizeSidebarExpandedSections(
      ACPBridge.getGlobalSettingsSnapshot()?.settings?.sidebarExpandedSections
    )
  );
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

  useEffect(() => {
    const userMessageBgMap: Record<string, string> = {
      'default': 'var(--ide-user-message-default-bg)',
      'blue-highlight': 'var(--ide-user-message-blue-highlight-bg)',
      'blue': 'var(--ide-user-message-blue-bg)',
      'background-secondary': 'var(--ide-background-secondary)',
      'accent': 'var(--ide-List-selectionBackground)',
      'custom': 'var(--ide-user-message-custom-bg)',
    };

    const applyGlobalSettings = (payload: { settings?: Partial<GlobalSettings> } | undefined) => {
      setOpenInEditor(payload?.settings?.openInEditor ?? true);
      const nextSidebarEnabled = payload?.settings?.sidebarEnabled ?? true;
      setSidebarEnabled(nextSidebarEnabled);
      if (!nextSidebarEnabled) setSidebarHidden(false);
      setSidebarPosition(payload?.settings?.sidebarPosition === 'right' ? 'right' : 'left');
      setSidebarExpandedSections(normalizeSidebarExpandedSections(payload?.settings?.sidebarExpandedSections));
      const offset = payload?.settings?.uiFontSizeOffsetPx ?? 0;
      document.documentElement.style.setProperty('--ui-font-size-offset', `${offset}px`);

      const styleId = payload?.settings?.userMessageBackgroundStyle ?? 'default';
      const customColor = payload?.settings?.userMessageCustomColor ?? '#193d70';
      document.documentElement.style.setProperty(
        '--ide-user-message-custom-bg', /^#[0-9a-fA-F]{6}$/.test(customColor) ? customColor : '#193d70'
      );
      const bg = userMessageBgMap[styleId] ?? userMessageBgMap['default'];
      document.documentElement.style.setProperty('--user-message-bg', bg);
    };

    const cleanup = ACPBridge.onGlobalSettings((e) => {
      applyGlobalSettings(e.detail?.payload);
    });

    const requestSettings = () => ACPBridge.loadGlobalSettings();

    if (window.__settingsBridgeReady) {
      requestSettings();
    } else {
      window.addEventListener('settings-bridge-ready', requestSettings);
    }

    return () => {
      cleanup();
      window.removeEventListener('settings-bridge-ready', requestSettings);
    };
  }, []);

  const {
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
    pendingAgentName,
    pendingHandoffsByTab,
    handleSelectTab,
    handleReorderTabs,
    handleCloseTab,
    handleCloseAllChats,
    hasOpenConversationsForAdapter,
    handleUpdateAgent,
    handleNewTab,
    handleOpenHistory,
    openSection,
    closeActiveSection,
    handleUserMessageSent,
    handleAssistantActivity,
    handleAtBottomChange,
    handleCanMarkReadChange,
    handlePermissionRequestChange,
    handleProcessingChange,
    requestAgentSwitch,
    handleHandoffConsumed,
    handleForkRequest,
    handleChatSessionStateChange,
    handleContinueInNewTab,
    handleContinueInCurrentConversation,
    handleCancelAgentSwitch,
  } = useAppController();

  const navigationProps: TabBarProps = {
    isIslandsTheme,
    tabs,
    activeTabId,
    activeSection,
    tabUi,
    onSelectTab: handleSelectTab,
    onReorderTabs: handleReorderTabs,
    onCloseTab: handleCloseTab,
    onCloseAllChats: handleCloseAllChats,
    onCloseActiveSection: closeActiveSection,
    onNewTab: () => handleNewTab(),
    onNewTabWithAgent: (agentId) => handleNewTab(agentId),
    onRenameTab: handleRenameTab,
    agents: availableAgents,
    onOpenHistory: () => openSection('history'),
    onOpenManagement: () => openSection('management'),
    onOpenDesignSystem: () => openSection('design'),
    onOpenMcp: () => openSection('mcp'),
    onOpenCustomAcp: () => openSection('custom-acp'),
    onOpenPromptLibrary: () => openSection('prompt-library'),
    onOpenSystemInstructions: () => openSection('system-instructions'),
    onOpenSettings: () => openSection('settings'),
    sidebarPosition,
    onUseSidebar: !sidebarEnabled ? () => setSidebarLayoutEnabled(true) : undefined,
  };

  function setSidebarLayoutEnabled(enabled: boolean) {
    const settings = ACPBridge.getGlobalSettingsSnapshot()?.settings;
    setSidebarEnabled(enabled);
    setSidebarHidden(false);
    if (settings && settings.sidebarEnabled !== enabled) {
      ACPBridge.saveGlobalSettings({ ...settings, sidebarEnabled: enabled });
    }
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

  const setSidebarSectionExpanded = (section: SidebarSectionId, expanded: boolean) => {
    const next = expanded
      ? [...new Set([...sidebarExpandedSections, section])]
      : sidebarExpandedSections.filter((item) => item !== section);
    setSidebarExpandedSections(next);
    const settings = ACPBridge.getGlobalSettingsSnapshot()?.settings;
    if (settings) {
      ACPBridge.saveGlobalSettings({ ...settings, sidebarExpandedSections: next });
    }
  };

  return (
    <div
      style={{ '--content-top-inset': sidebarEnabled && isWide ? '1rem' : '0px' } as CSSProperties}
      className={`h-full bg-background text-foreground overflow-hidden flex ${sidebarEnabled ? 'flex-row' : 'flex-col'}`}
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
          historyList={historyList}
          expandedSections={sidebarExpandedSections}
          onSectionExpandedChange={setSidebarSectionExpanded}
          onOpenRecentConversation={(session) => handleOpenHistory(session, true)}
          onWidthChange={setSidebarWidth}
          onHide={() => setSidebarVisibility(true)}
          onUseTabBar={() => setSidebarLayoutEnabled(false)}
          openInEditor={openInEditor}
          onToggleOpenInEditor={toggleOpenInEditor}
          onTogglePosition={toggleSidebarPosition}
        />
      ) : <TabBar {...navigationProps} />}

      {sidebarEnabled && sidebarHidden ? (
        <SidebarLayoutControls
          position={sidebarPosition}
          hidden
          onToggleVisibility={() => setSidebarVisibility(false)}
          onUseTabBar={() => setSidebarLayoutEnabled(false)}
          openInEditor={openInEditor}
          onToggleOpenInEditor={toggleOpenInEditor}
          onTogglePosition={toggleSidebarPosition}
          floating
        />
      ) : null}

      <div className="flex-1 relative min-h-0 min-w-0">
        {/* Chat tabs stay mounted so their sessions and UI state are preserved. */}
        {tabs.map((tab) => {
          const isTabActive = tab.id === activeTabId;

          return (
            <AppTabContent
              key={tab.id}
              tab={tab}
              isActive={isTabActive}
              runnableAgents={runnableAgents}
              pendingHandoff={pendingHandoffsByTab[tab.id]}
              onUserMessageSent={() => handleUserMessageSent(tab.id)}
              onAssistantActivity={() => handleAssistantActivity(tab.id)}
              onAtBottomChange={(isAtBottom) => handleAtBottomChange(tab.id, isAtBottom)}
              onCanMarkReadChange={(canMarkRead) => handleCanMarkReadChange(tab.id, canMarkRead)}
              onPermissionRequestChange={(hasPendingPermission) => handlePermissionRequestChange(tab.id, hasPendingPermission)}
              onProcessingChange={(isProcessing) => handleProcessingChange(tab.id, isProcessing)}
              onAgentChangeRequest={(payload) => requestAgentSwitch(tab.id, payload)}
              onForkRequest={(payload) => handleForkRequest(tab.id, payload)}
              onHandoffConsumed={(handoffId) => handleHandoffConsumed(tab.id, handoffId)}
              onSessionStateChange={(state) => handleChatSessionStateChange(tab.id, state)}
            />
          );
        })}

        {/* Sections mount on first use and remain cached without becoming tabs. */}
        {mountedSections.map((section) => (
          <AppSectionContent
            key={section}
            section={section}
            tabs={tabs}
            historyList={historyList}
            historyLoaded={historyLoaded}
            isActive={section === activeSection}
            availableAgents={availableAgents}
            hasOpenConversationsForAdapter={hasOpenConversationsForAdapter}
            onUpdateAgent={handleUpdateAgent}
            onOpenHistory={handleOpenHistory}
          />
        ))}

        {/* Empty state */}
        {!activeTabId && !activeSection && (
          <EmptyStateView
            runnableAgents={runnableAgents}
            adaptersResolved={agentAvailabilityResolved}
            onStartWithAgent={handleNewTab}
            onOpenManagement={() => openSection('management')}
          />
        )}
      </div>

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
