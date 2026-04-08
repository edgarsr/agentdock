import { useState, useRef, useEffect } from 'react';
import { Bookmark, Bot, FileText, History, Network, Palette, SlidersHorizontal } from 'lucide-react';
import { AgentOption, ChatTab, TabUiFlags, isAgentRunnable } from '../types/chat';
import { ACPBridge } from '../utils/bridge';
import { Tooltip } from './chat/shared/Tooltip';

interface TabBarProps {
  tabs: ChatTab[];
  activeTabId: string;
  tabUi?: Record<string, TabUiFlags>;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseAllTabs: () => void;
  onNewTab: () => void;
  onNewTabWithAgent: (agentId: string) => void;
  agents: AgentOption[];
  onOpenHistory: () => void;
  onOpenManagement: () => void;
  onOpenDesignSystem: () => void;
  onOpenMcp: () => void;
  onOpenPromptLibrary: () => void;
  onOpenSystemInstructions: () => void;
  onOpenSettings: () => void;
}

function getMenuItems(menu: HTMLDivElement | null): HTMLButtonElement[] {
  if (!menu) {
    return [];
  }
  return Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
}

function focusMenuItem(menu: HTMLDivElement | null, index: number) {
  const items = getMenuItems(menu);
  if (items.length === 0) {
    return;
  }
  items[((index % items.length) + items.length) % items.length]?.focus();
}

function moveMenuFocus(menu: HTMLDivElement | null, delta: number) {
  const items = getMenuItems(menu);
  if (items.length === 0) {
    return;
  }
  const activeIndex = items.findIndex((item) => item === document.activeElement);
  const nextIndex = activeIndex === -1 ? (delta > 0 ? 0 : items.length - 1) : activeIndex + delta;
  items[((nextIndex % items.length) + items.length) % items.length]?.focus();
}

const getAgentIcon = (agentId: string | undefined, agents: AgentOption[]) => {
  const agent = agentId ? agents.find(a => a.id === agentId) : undefined;
  if (agent && agent.iconPath) {
    if (agent.iconPath.startsWith('<svg')) {
      return (
         <div className="w-4 h-4 flex-shrink-0 flex items-center justify-center text-foreground" dangerouslySetInnerHTML={{ __html: agent.iconPath }} />
      );
    }
    return <img src={agent.iconPath} className="w-4 h-4 flex-shrink-0" alt="icon" />;
  }
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/70 flex-shrink-0">
      <path d="M12 8V4H8"></path>
      <rect width="16" height="12" x="4" y="8" rx="2"></rect>
      <path d="M2 14h2"></path>
      <path d="M20 14h2"></path>
      <path d="M15 13v2"></path>
      <path d="M9 13v2"></path>
    </svg>
  );
};

/** Icon for the management tab in the tab bar */
const ManagementTabIcon = () => <Bot size={14} className="text-foreground/70 flex-shrink-0" />;

/** Icon for the design system tab in the tab bar */
const DesignTabIcon = () => <Palette size={14} className="text-foreground/70 flex-shrink-0" />;

/** Icon for the MCP servers tab in the tab bar */
const McpTabIcon = () => <Network size={14} className="text-foreground/70 flex-shrink-0" />;

/** Icon for the history tab in the tab bar */
const HistoryTabIcon = () => <History size={14} className="text-foreground/70 flex-shrink-0" />;
const PromptLibraryTabIcon = () => <Bookmark size={14} className="text-foreground/70 flex-shrink-0" />;
const SystemInstructionsTabIcon = () => <FileText size={14} className="text-foreground/70 flex-shrink-0" />;
const SettingsTabIcon = () => <SlidersHorizontal size={14} className="text-foreground/70 flex-shrink-0" />;

/** Get the icon for a tab based on its type */
const getTabIcon = (tab: ChatTab, agents: AgentOption[]) => {
  if (tab.type === 'management') return <ManagementTabIcon />;
  if (tab.type === 'design') return <DesignTabIcon />;
  if (tab.type === 'history') return <HistoryTabIcon />;
  if (tab.type === 'mcp') return <McpTabIcon />;
  if (tab.type === 'prompt-library') return <PromptLibraryTabIcon />;
  if (tab.type === 'system-instructions') return <SystemInstructionsTabIcon />;
  if (tab.type === 'settings') return <SettingsTabIcon />;
  return getAgentIcon(tab.agentId, agents);
};

interface TabItemProps {
  tab: ChatTab;
  agents: AgentOption[];
  isActive: boolean;
  hasWarning: boolean;
  hasUnread: boolean;
  titleClassName: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

function TabItem({
  tab,
  agents,
  isActive,
  hasWarning,
  hasUnread,
  titleClassName,
  onSelectTab,
  onCloseTab
}: TabItemProps) {
  return (
    <div
      className={`
        text-foreground group relative flex h-full max-w-[180px] shrink items-center bg-background pl-3 pr-2 pb-0.5
        ${isActive ? 'text-foreground before:absolute before:inset-0 before:bg-background before:[filter:var(--ide-surface-active-filter)] ' +
          'after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[3px] after:bg-primary' :
          ''}
      `}
    >
      <button
        type="button"
        role="tab"
        aria-selected={isActive}
        onClick={() => onSelectTab(tab.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelectTab(tab.id);
          }
        }}
        className="relative z-10 flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-[4px] text-left cursor-default focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
      >
        <div className="flex shrink-0 items-center mt-[-2px]">
          {getTabIcon(tab, agents)}
        </div>
        <div className={`min-w-0 flex-1 overflow-hidden ${titleClassName}`}>
          <div className="truncate text-ide-small">
            {tab.title}
          </div>
        </div>
      </button>
      {hasWarning ? (
        <span className="relative z-10 ml-2 -mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-warning" />
      ) : hasUnread ? (
        <span className="relative z-10 ml-2 -mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-sky-500" />
      ) : null}

      <button
        onClick={(e) => {
          e.stopPropagation();
          onCloseTab(tab.id);
        }}
        className={`
          relative z-10 ml-2 mr-0.5 shrink-0 rounded-sm opacity-0 cursor-pointer
          focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]
          ${isActive ? 'opacity-100' : 'group-hover:opacity-100 group-focus-within:opacity-100'}
        `}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  );
}

export default function TabBar({
  tabs,
  activeTabId,
  tabUi = {},
  onSelectTab,
  onCloseTab,
  onCloseAllTabs,
  onNewTab,
  onNewTabWithAgent,
  agents,
  onOpenHistory,
  onOpenManagement,
  onOpenDesignSystem,
  onOpenMcp,
  onOpenPromptLibrary,
  onOpenSystemInstructions,
  onOpenSettings
}: TabBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hamburgerMenuOpen, setHamburgerMenuOpen] = useState(false);
  const [tabFocusedControl, setTabFocusedControl] = useState<'new' | 'menu' | 'hamburger' | null>(null);
  const [tabsViewportWidth, setTabsViewportWidth] = useState(0);
  const tabsListRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const hamburgerRef = useRef<HTMLDivElement>(null);
  const menuListRef = useRef<HTMLDivElement>(null);
  const hamburgerMenuListRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const hamburgerButtonRef = useRef<HTMLButtonElement>(null);
  const lastInteractionWasTabRef = useRef(false);
  const focusFirstMenuItemOnOpenRef = useRef(false);
  const focusFirstHamburgerItemOnOpenRef = useRef(false);
  const runnableAgents = agents.filter(isAgentRunnable);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      lastInteractionWasTabRef.current = false;
      setTabFocusedControl(null);
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
      if (hamburgerRef.current && !hamburgerRef.current.contains(event.target as Node)) {
        setHamburgerMenuOpen(false);
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
    const element = tabsListRef.current;
    if (!element) {
      return;
    }

    const updateWidth = () => {
      setTabsViewportWidth(element.clientWidth);
    };

    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [tabs.length]);

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

  useEffect(() => {
    if (!hamburgerMenuOpen) {
      return;
    }
    if (!focusFirstHamburgerItemOnOpenRef.current) {
      return;
    }
    focusFirstHamburgerItemOnOpenRef.current = false;
    focusMenuItem(hamburgerMenuListRef.current, 0);
  }, [hamburgerMenuOpen]);

  const averageTabWidth = tabs.length > 0 ? tabsViewportWidth / tabs.length : Number.POSITIVE_INFINITY;
  const titleClassName =
    averageTabWidth < 76 ? 'hidden' :
    averageTabWidth < 92 ? 'max-w-[20px]' :
    averageTabWidth < 112 ? 'max-w-[35px]' :
    averageTabWidth < 132 ? 'max-w-[68px]' :
    averageTabWidth < 156 ? 'max-w-[80px]' :
    'max-w-[120px]';

  return (
    <div className="relative z-30 flex h-[36px] bg-background border-t border-b border-[var(--ide-Borders-ContrastBorderColor)] select-none shadow-[0_2px_8px_rgba(0,0,0,0.08)]">
      {/* Tabs List */}
      <div
        ref={tabsListRef}
        role="tablist"
        className="flex min-w-0 flex-1 overflow-x-auto scroll-smooth [&::-webkit-scrollbar]:h-1.5"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const flags = tabUi[tab.id];
          const hasWarning = !!flags?.warning;
          const hasUnread = !!flags?.unread;
          return (
            <TabItem
              key={tab.id}
              tab={tab}
              agents={agents}
              isActive={isActive}
              hasWarning={hasWarning}
              hasUnread={hasUnread}
              titleClassName={titleClassName}
              onSelectTab={onSelectTab}
              onCloseTab={onCloseTab}
            />
          );
        })}
      </div>

      {/* Controls: +, More (chevron), Hamburger */}
      <div className="flex items-center bg-background pl-1 pr-2 gap-0.5 z-10 shadow-[-10px_0_10px_-5px_var(--background)]">
        {/* New Tab (+ matches default agent) */}
        <button
          onClick={onNewTab}
          onFocus={() => setTabFocusedControl(lastInteractionWasTabRef.current ? 'new' : null)}
          onBlur={() => setTabFocusedControl((current) => current === 'new' ? null : current)}
          className={`flex items-center justify-center w-[28px] h-[24px] rounded bg-background hover:text-foreground hover:bg-hover transition-[filter,color] focus:outline-none ${tabFocusedControl === 'new' ? 'shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]' : ''}`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>

        {/* More/Menu (Chevron dropdown) */}
        <div className="relative" ref={menuRef}>
          <button
            ref={menuButtonRef}
            onClick={() => {
              focusFirstMenuItemOnOpenRef.current = false;
              setMenuOpen((current) => {
                const next = !current;
                if (next) {
                  setHamburgerMenuOpen(false);
                }
                return next;
              });
            }}
            onFocus={() => setTabFocusedControl(lastInteractionWasTabRef.current ? 'menu' : null)}
            onBlur={() => setTabFocusedControl((current) => current === 'menu' ? null : current)}
            onKeyDown={(event) => {
              if ((event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') && !menuOpen) {
                event.preventDefault();
                focusFirstMenuItemOnOpenRef.current = true;
                setHamburgerMenuOpen(false);
                setMenuOpen(true);
              }
            }}
            className={`flex items-center justify-center w-[24px] h-[24px] rounded bg-background hover:text-foreground hover:bg-hover transition-colors focus:outline-none ${menuOpen ? 'bg-hover text-foreground' : ''} ${tabFocusedControl === 'menu' ? 'shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]' : ''}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>

          {menuOpen && (
            <div
              ref={menuListRef}
              className="absolute top-full right-0 mt-1 w-max max-w-[250px] overflow-y-auto whitespace-nowrap bg-background border border-[var(--ide-Button-startBorderColor)] rounded-[8px] py-1.5 z-50 no-scrollbar text-ide-small"
              role="menu"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setMenuOpen(false);
                  menuButtonRef.current?.focus();
                  return;
                }
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  moveMenuFocus(menuListRef.current, 1);
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  moveMenuFocus(menuListRef.current, -1);
                }
              }}
            >

              {/* Open Tabs Section */}
              {tabs.length > 0 && (
                <div className="mb-1">
                  <div className="text-ide-small px-5 py-1 text-[var(--ide-Label-disabledForeground)]">
                    Open Tabs
                  </div>
                  {tabs.map((tab) => {
                    const flags = tabUi[tab.id];
                    const hasWarning = !!flags?.warning;
                    const hasUnread = !!flags?.unread;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => {
                           onSelectTab(tab.id);
                           setMenuOpen(false);
                        }}
                        className={`mb-0.5 mx-2 flex w-[calc(100%-1rem)] items-center rounded-[4px] px-3 min-h-8 text-left transition-colors group focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] ${tab.id === activeTabId ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'}`}
                        role="menuitem"
                      >
                        <span className="mr-2 flex items-center justify-center">
                          {getTabIcon(tab, agents)}
                        </span>
                        <span className="flex-1 truncate min-w-0">{tab.title}</span>
                        {hasWarning ? (
                          <span className="ml-2 w-2 h-2 rounded-full bg-warning flex-shrink-0" />
                        ) : hasUnread ? (
                          <span className="ml-2 w-2 h-2 rounded-full bg-sky-500 flex-shrink-0" />
                        ) : null}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => {
                      onCloseAllTabs();
                      setMenuOpen(false);
                    }}
                    className="mx-2 flex w-[calc(100%-1rem)] items-center rounded-[4px] px-3 py-1 text-left text-foreground hover:bg-accent hover:text-accent-foreground transition-colors focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                    role="menuitem"
                  >
                    <span className="mr-2 flex items-center justify-center">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
                           stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </span>
                    Close all tabs
                  </button>
                  <div className="h-[1px] bg-border my-1 mx-2" />
                </div>
              )}

              {/* New Chat With Agent Section */}
              <div>
                <div className="text-ide-small px-5 py-1 text-[var(--ide-Label-disabledForeground)]">
                  New Chat
                </div>
                {runnableAgents.length > 0 ? (
                  runnableAgents.map((agent) => (
                    <div
                      key={agent.id}
                      className="mb-0.5 mx-2 flex w-[calc(100%-1rem)] items-stretch rounded-[4px] text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-within:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                    >
                      <button
                        onClick={() => {
                           onNewTabWithAgent(agent.id);
                           setMenuOpen(false);
                        }}
                        className="flex flex-1 items-center rounded-l-[4px] px-3 min-h-8 text-left focus:outline-none"
                        role="menuitem"
                      >
                        <span className="mr-2 flex items-center justify-center">
                          {getAgentIcon(agent.id, agents)}
                        </span>
                        <span className="flex-1 min-w-0 truncate">{agent.name}</span>
                      </button>
                      {agent.cliAvailable ? (
                        <div className="ml-2 flex items-stretch self-stretch">
                          <Tooltip variant="minimal" content={`Open ${agent.name} in  terminal`} className="flex self-stretch">
                            <button
                              type="button"
                              onClick={() => {
                                ACPBridge.openAgentCli(agent.id);
                                setMenuOpen(false);
                              }}
                              className="relative flex items-center self-stretch pl-4 pr-2 text-foreground-secondary hover:text-accent-foreground focus:outline-none focus:text-accent-foreground before:pointer-events-none before:absolute before:bottom-[28%] before:left-[3px] before:top-[28%] before:w-px before:bg-[var(--ide-Borders-color)]"
                              aria-label={`Open ${agent.name} CLI`}
                              role="menuitem"
                            >
                              CLI
                            </button>
                          </Tooltip>
                        </div>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="px-5 min-h-8 text-[var(--ide-Label-disabledForeground)] italic">No available agents</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Hamburger Menu */}
        <div className="relative" ref={hamburgerRef}>
          <button
            ref={hamburgerButtonRef}
            onClick={() => {
              focusFirstHamburgerItemOnOpenRef.current = false;
              setHamburgerMenuOpen((current) => {
                const next = !current;
                if (next) {
                  setMenuOpen(false);
                }
                return next;
              });
            }}
            onFocus={() => setTabFocusedControl(lastInteractionWasTabRef.current ? 'hamburger' : null)}
            onBlur={() => setTabFocusedControl((current) => current === 'hamburger' ? null : current)}
            onKeyDown={(event) => {
              if ((event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') && !hamburgerMenuOpen) {
                event.preventDefault();
                focusFirstHamburgerItemOnOpenRef.current = true;
                setMenuOpen(false);
                setHamburgerMenuOpen(true);
              }
            }}
            className={`flex items-center justify-center w-[28px] h-[24px] rounded bg-background transition-colors focus:outline-none ${hamburgerMenuOpen ? 'bg-hover text-foreground' : 'hover:text-foreground hover:bg-hover'} ${tabFocusedControl === 'hamburger' ? 'shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]' : ''}`}
            aria-haspopup="menu"
            aria-expanded={hamburgerMenuOpen}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>

          {hamburgerMenuOpen && (
            <div
              ref={hamburgerMenuListRef}
              className="absolute top-full right-0 mt-1 w-max whitespace-nowrap bg-background border border-[var(--ide-Button-startBorderColor)] rounded-[8px] py-1.5 z-50 text-ide-small"
              role="menu"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setHamburgerMenuOpen(false);
                  hamburgerButtonRef.current?.focus();
                  return;
                }
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  moveMenuFocus(hamburgerMenuListRef.current, 1);
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  moveMenuFocus(hamburgerMenuListRef.current, -1);
                }
              }}
            >
              <button
                onClick={() => {
                  onOpenHistory();
                  setHamburgerMenuOpen(false);
                }}
                className="mb-0.5 ml-2 mr-4 flex w-[calc(100%-1rem)] items-center rounded-[4px] px-3 min-h-8 text-left text-foreground hover:bg-accent hover:text-accent-foreground transition-colors group focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                role="menuitem"
              >
                <span className="mr-2 flex items-center justify-center">
                  <HistoryTabIcon />
                </span>
                <span>History</span>
              </button>
              <button
                onClick={() => {
                  onOpenSettings();
                  setHamburgerMenuOpen(false);
                }}
                className="mb-0.5 ml-2 mr-4 flex w-[calc(100%-1rem)] items-center rounded-[4px] px-3 min-h-8 text-left text-foreground hover:bg-accent hover:text-accent-foreground transition-colors group focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                role="menuitem"
              >
                <span className="mr-2 flex items-center justify-center">
                  <SettingsTabIcon />
                </span>
                <span>Settings</span>
              </button>
              <button
                onClick={() => {
                  onOpenManagement();
                  setHamburgerMenuOpen(false);
                }}
                className="mb-0.5 ml-2 mr-4  flex w-[calc(100%-1rem)] items-center rounded-[4px] px-3 min-h-8 text-left text-foreground hover:bg-accent hover:text-accent-foreground transition-colors group focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                role="menuitem"
              >
                <span className="mr-2 flex items-center justify-center">
                  <ManagementTabIcon />
                </span>
                <span>Service Providers</span>
              </button>
              <button
                onClick={() => {
                  onOpenPromptLibrary();
                  setHamburgerMenuOpen(false);
                }}
                className="mb-0.5 ml-2 mr-4 flex w-[calc(100%-1rem)] items-center rounded-[4px] px-3 min-h-8 text-left text-foreground hover:bg-accent hover:text-accent-foreground transition-colors group focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                role="menuitem"
              >
                <span className="mr-2 flex items-center justify-center">
                  <PromptLibraryTabIcon />
                </span>
                <span>Prompt Library</span>
              </button>
              <button
                onClick={() => {
                  onOpenSystemInstructions();
                  setHamburgerMenuOpen(false);
                }}
                className="mb-0.5 ml-2 mr-4 flex w-[calc(100%-1rem)] items-center rounded-[4px] px-3 min-h-8 text-left text-foreground hover:bg-accent hover:text-accent-foreground transition-colors group focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                role="menuitem"
              >
                <span className="mr-2 flex items-center justify-center">
                  <SystemInstructionsTabIcon />
                </span>
                <span>System Instructions</span>
              </button>
              <button
                onClick={() => {
                  onOpenDesignSystem();
                  setHamburgerMenuOpen(false);
                }}
                className="ml-2 mr-4  flex w-[calc(100%-1rem)] items-center rounded-[4px] px-3 min-h-8 text-left text-foreground hover:bg-accent hover:text-accent-foreground transition-colors group focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                role="menuitem"
              >
                <span className="mr-2 flex items-center justify-center">
                  <DesignTabIcon />
                </span>
                <span>Design System</span>
              </button>
              <button
                onClick={() => {
                  onOpenMcp();
                  setHamburgerMenuOpen(false);
                }}
                className="ml-2 mr-4  flex w-[calc(100%-1rem)] items-center rounded-[4px] px-3 min-h-8 text-left text-foreground hover:bg-accent hover:text-accent-foreground transition-colors group focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                role="menuitem"
              >
                <span className="mr-2 flex items-center justify-center">
                  <McpTabIcon />
                </span>
                <span>MCP Servers</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
