import { useState, useRef, useEffect } from 'react';
import { History, Menu, Plus } from 'lucide-react';
import { AgentOption, ChatTab, GlobalSettings, SectionType, TabUiFlags, isAgentRunnable } from '../types/chat';
import { UseSidebarButton } from './LayoutControls';
import { TabItem } from './tabbar/TabItem';
import { NavigationMenu } from './tabbar/NavigationMenu';
import { focusMenuItem } from './tabbar/menuFocus';
import { useTabReordering } from './tabbar/useTabReordering';
import { Tooltip } from './chat/shared/Tooltip';

export interface TabBarProps {
  isIslandsTheme: boolean;
  tabs: ChatTab[];
  activeTabId: string;
  activeSection: SectionType | null;
  tabUi?: Record<string, TabUiFlags>;
  onSelectTab: (id: string) => void;
  onReorderTabs: (draggedId: string, targetId: string, position: 'before' | 'after') => void;
  onCloseTab: (id: string) => void;
  onCloseAllChats: () => void;
  onCloseActiveSection: () => void;
  onNewTab: () => void;
  onNewTabWithAgent: (agentId: string) => void;
  onRenameTab: (tabId: string, newTitle: string) => void;
  agents: AgentOption[];
  onOpenHistory: () => void;
  onOpenManagement: () => void;
  onOpenDesignSystem: () => void;
  onOpenMcp: () => void;
  onOpenCustomAcp: () => void;
  onOpenPromptLibrary: () => void;
  onOpenSystemInstructions: () => void;
  onOpenSettings: () => void;
  sidebarPosition?: GlobalSettings['sidebarPosition'];
  onUseSidebar?: () => void;
}

export default function TabBar({
  isIslandsTheme,
  tabs,
  activeTabId,
  activeSection,
  tabUi = {},
  onSelectTab,
  onReorderTabs,
  onCloseTab,
  onCloseAllChats,
  onCloseActiveSection,
  onNewTab,
  onNewTabWithAgent,
  onRenameTab,
  agents,
  onOpenHistory,
  onOpenManagement,
  onOpenDesignSystem,
  onOpenMcp,
  onOpenCustomAcp,
  onOpenPromptLibrary,
  onOpenSystemInstructions,
  onOpenSettings,
  sidebarPosition = 'left',
  onUseSidebar,
}: TabBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [tabFocusedControl, setTabFocusedControl] = useState<'new' | 'history' | 'menu' | null>(null);
  const [focusedTabId, setFocusedTabId] = useState<string | null>(null);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuListRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const lastInteractionWasTabRef = useRef(false);
  const focusFirstMenuItemOnOpenRef = useRef(false);
  const {
    listRef: tabsListRef,
    dropTarget,
    startReordering,
    shouldSuppressClick,
  } = useTabReordering('horizontal', onReorderTabs);
  const runnableAgents = agents.filter(isAgentRunnable);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      lastInteractionWasTabRef.current = false;
      setTabFocusedControl(null);
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      lastInteractionWasTabRef.current = event.key === 'Tab';
      if (event.key !== 'Tab') {
        setTabFocusedControl(null);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
}, []);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    if (!focusFirstMenuItemOnOpenRef.current) {
      return;
    }
    focusFirstMenuItemOnOpenRef.current = false;
    focusMenuItem(menuListRef.current, 0);
  }, [menuOpen]);

  const handleTabPointerDown = (id: string, event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('[data-close-tab]')) {
      return;
    }
    startReordering(id, event);
  };

  return (
    <div className="relative z-30 flex h-[40px] bg-background border-t border-b
      border-[var(--ide-Borders-ContrastBorderColor)] select-none shadow-[0_2px_8px_rgba(0,0,0,0.05)]">
      {onUseSidebar ? <UseSidebarButton position={sidebarPosition} onClick={onUseSidebar} /> : null}
      {/* Tabs List */}
      <div ref={tabsListRef} role="tablist"
        className={`flex min-w-0 flex-1 overflow-x-auto scroll-smooth [&::-webkit-scrollbar]:h-1.5 ${isIslandsTheme ? '' : 'pl-2'}`}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const flags = tabUi[tab.id];
          const hasWarning = flags?.warning;
          const hasUnread = flags?.unread;
          const hasProcessing = flags?.processing;
          return (
            <div key={tab.id} className="flex min-w-[70px] flex-1 max-w-max">
              <TabItem
                tab={tab}
                agents={agents}
                isActive={isActive}
                isKeyboardFocused={focusedTabId === tab.id}
                hasWarning={hasWarning}
                hasUnread={hasUnread}
                hasProcessing={hasProcessing}
                isIslandsTheme={isIslandsTheme}
                onSelectTab={onSelectTab}
                onPointerDown={handleTabPointerDown}
                shouldSuppressClick={shouldSuppressClick}
                onCloseTab={onCloseTab}
                onFocusTab={(id) => setFocusedTabId(lastInteractionWasTabRef.current ? id : null)}
                onBlurTab={(id) => setFocusedTabId((current) => current === id ? null : current)}
                isRenaming={renamingTabId === tab.id}
                onStartRename={setRenamingTabId}
                onRename={onRenameTab}
                onStopRename={() => setRenamingTabId(null)}
                dropIndicator={dropTarget?.id === tab.id ? dropTarget.position : null}
              />
            </div>
          );
        })}
      </div>

      {/* Controls: new chat and navigation */}
      <div className="flex shrink-0 items-center bg-background pl-1 pr-2 gap-0.5 z-10 shadow-[-10px_0_10px_-5px_var(--background)]">
        {/* New Tab (+ matches default agent) */}
        <button
          onClick={onNewTab}
          onFocus={() => setTabFocusedControl(lastInteractionWasTabRef.current ? 'new' : null)}
          onBlur={() => setTabFocusedControl((current) => current === 'new' ? null : current)}
          className={`flex items-center justify-center w-[28px] h-[24px] rounded bg-background hover:text-foreground 
            hover:bg-hover transition-[filter,color] focus:outline-none 
            ${tabFocusedControl === 'new' ? 'shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]' : ''}`}
        >
          <Plus size={14} strokeWidth={2.5} aria-hidden="true" />
        </button>

        <Tooltip variant="minimal" placement="bottom" content="History" className="flex">
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onOpenHistory();
            }}
            onFocus={() => setTabFocusedControl(lastInteractionWasTabRef.current ? 'history' : null)}
            onBlur={() => setTabFocusedControl((current) => current === 'history' ? null : current)}
            className={`flex h-[24px] w-[28px] items-center justify-center rounded bg-background
              transition-colors hover:bg-hover hover:text-foreground focus:outline-none
              ${tabFocusedControl === 'history' ? 'shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]' : ''}`}
            aria-label="History"
          >
            <History size={15} aria-hidden="true" />
          </button>
        </Tooltip>

        {/* Navigation menu */}
        <div className="relative" ref={menuRef}>
          <button
            ref={menuButtonRef}
            onClick={() => {
              focusFirstMenuItemOnOpenRef.current = false;
              setMenuOpen((current) => !current);
            }}
            onFocus={() => setTabFocusedControl(lastInteractionWasTabRef.current ? 'menu' : null)}
            onBlur={() => setTabFocusedControl((current) => current === 'menu' ? null : current)}
            onKeyDown={(event) => {
              if ((event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') && !menuOpen) {
                event.preventDefault();
                focusFirstMenuItemOnOpenRef.current = true;
                setMenuOpen(true);
              }
            }}
            className={`flex items-center justify-center w-[28px] h-[24px] rounded bg-background
              hover:text-foreground hover:bg-hover transition-colors focus:outline-none
              ${menuOpen ? 'bg-hover text-foreground' : ''}
              ${tabFocusedControl === 'menu' ? 'shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]' : ''}`}
            aria-label="Navigation menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <Menu size={16} aria-hidden="true" />
          </button>

          {menuOpen && (
            <NavigationMenu
              menuListRef={menuListRef}
              menuButtonRef={menuButtonRef}
              tabs={tabs}
              tabUi={tabUi}
              activeTabId={activeTabId}
              activeSection={activeSection}
              agents={agents}
              runnableAgents={runnableAgents}
              onSelectTab={onSelectTab}
              onReorderTabs={onReorderTabs}
              onCloseTab={onCloseTab}
              onCloseAllChats={onCloseAllChats}
              onCloseActiveSection={onCloseActiveSection}
              onNewTabWithAgent={onNewTabWithAgent}
              onRenameTab={onRenameTab}
              onCloseMenu={() => setMenuOpen(false)}
              onOpenHistory={onOpenHistory}
              onOpenManagement={onOpenManagement}
              onOpenDesignSystem={onOpenDesignSystem}
              onOpenMcp={onOpenMcp}
              onOpenCustomAcp={onOpenCustomAcp}
              onOpenPromptLibrary={onOpenPromptLibrary}
              onOpenSystemInstructions={onOpenSystemInstructions}
              onOpenSettings={onOpenSettings}
            />
          )}
        </div>

      </div>
    </div>
  );
}
