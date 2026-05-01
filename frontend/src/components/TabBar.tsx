import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Menu, Plus } from 'lucide-react';
import { AgentOption, ChatTab, TabUiFlags, isAgentRunnable } from '../types/chat';
import { HamburgerMenuPanel } from './tabbar/HamburgerMenuPanel';
import { TabItem } from './tabbar/TabItem';
import { TabOverflowMenu } from './tabbar/TabOverflowMenu';
import { focusMenuItem } from './tabbar/menuFocus';

interface TabBarProps {
  tabs: ChatTab[];
  activeTabId: string;
  tabUi?: Record<string, TabUiFlags>;
  onSelectTab: (id: string) => void;
  onReorderTabs: (draggedId: string, targetId: string, position: 'before' | 'after') => void;
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

export default function TabBar({
  tabs,
  activeTabId,
  tabUi = {},
  onSelectTab,
  onReorderTabs,
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
  const [focusedTabId, setFocusedTabId] = useState<string | null>(null);
  const [tabsViewportWidth, setTabsViewportWidth] = useState(0);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null);
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
  const suppressClickTabIdRef = useRef<string | null>(null);
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
    averageTabWidth < 125 ? 'max-w-[35px]' :
    averageTabWidth < 140 ? 'max-w-[68px]' :
    averageTabWidth < 170 ? 'max-w-[80px]' :
    'max-w-[120px]';

  const findDropTarget = (sourceId: string, clientX: number, clientY: number) => {
    const tabElements = Array.from(tabsListRef.current?.querySelectorAll<HTMLElement>('[data-tab-id]') ?? []);
    for (const element of tabElements) {
      const id = element.dataset.tabId;
      if (!id || id === sourceId) {
        continue;
      }
      const rect = element.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        continue;
      }
      return {
        id,
        position: clientX < rect.left + rect.width / 2 ? 'before' as const : 'after' as const,
      };
    }
    return null;
  };

  const handleTabPointerDown = (id: string, event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('[data-close-tab]')) {
      return;
    }

    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    let latestDropTarget: { id: string; position: 'before' | 'after' } | null = null;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const distance = Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY);
      if (distance < 4) {
        return;
      }

      moved = true;
      latestDropTarget = findDropTarget(id, moveEvent.clientX, moveEvent.clientY);
      setDropTarget(latestDropTarget);
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      setDropTarget(null);

      if (!moved) {
        return;
      }

      suppressClickTabIdRef.current = id;
      window.setTimeout(() => {
        if (suppressClickTabIdRef.current === id) {
          suppressClickTabIdRef.current = null;
        }
      }, 0);

      if (latestDropTarget) {
        onReorderTabs(id, latestDropTarget.id, latestDropTarget.position);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  return (
    <div className="relative z-30 flex h-[40px] bg-background border-t border-b
      border-[var(--ide-Borders-ContrastBorderColor)] select-none shadow-[0_2px_8px_rgba(0,0,0,0.05)]">
      {/* Tabs List */}
      <div ref={tabsListRef} role="tablist"
        className="flex min-w-0 flex-1 overflow-x-auto scroll-smooth [&::-webkit-scrollbar]:h-1.5"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const flags = tabUi[tab.id];
          const hasWarning = flags?.warning;
          const hasUnread = flags?.unread;
          const hasProcessing = !!flags?.processing;
          return (
            <TabItem
              key={tab.id}
              tab={tab}
              agents={agents}
              isActive={isActive}
              isKeyboardFocused={focusedTabId === tab.id}
              hasWarning={hasWarning}
              hasUnread={hasUnread}
              hasProcessing={hasProcessing}
              titleClassName={titleClassName}
              onSelectTab={onSelectTab}
              onPointerDown={handleTabPointerDown}
              shouldSuppressClick={(id) => suppressClickTabIdRef.current === id}
              onCloseTab={onCloseTab}
              onFocusTab={(id) => setFocusedTabId(lastInteractionWasTabRef.current ? id : null)}
              onBlurTab={(id) => setFocusedTabId((current) => current === id ? null : current)}
              dropIndicator={dropTarget?.id === tab.id ? dropTarget.position : null}
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
          className={`flex items-center justify-center w-[28px] h-[24px] rounded bg-background hover:text-foreground 
            hover:bg-hover transition-[filter,color] focus:outline-none 
            ${tabFocusedControl === 'new' ? 'shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]' : ''}`}
        >
          <Plus size={14} strokeWidth={2.5} aria-hidden="true" />
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
            className={`flex items-center justify-center w-[24px] h-[24px] rounded bg-background 
              hover:text-foreground hover:bg-hover transition-colors focus:outline-none 
              ${menuOpen ? 'bg-hover text-foreground' : ''} 
              ${tabFocusedControl === 'menu' ? 'shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]' : ''}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <ChevronDown size={12} aria-hidden="true" />
          </button>

          {menuOpen && (
            <TabOverflowMenu
              menuListRef={menuListRef}
              menuButtonRef={menuButtonRef}
              tabs={tabs}
              tabUi={tabUi}
              activeTabId={activeTabId}
              agents={agents}
              runnableAgents={runnableAgents}
              onSelectTab={onSelectTab}
              onCloseTab={onCloseTab}
              onCloseAllTabs={onCloseAllTabs}
              onNewTabWithAgent={onNewTabWithAgent}
              onCloseMenu={() => setMenuOpen(false)}
            />
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
            className={`flex items-center justify-center w-[28px] h-[24px] rounded bg-background transition-colors 
              focus:outline-none ${hamburgerMenuOpen ? 'bg-hover text-foreground' : 'hover:text-foreground hover:bg-hover'} 
              ${tabFocusedControl === 'hamburger' ? 'shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]' : ''}`}
            aria-haspopup="menu"
            aria-expanded={hamburgerMenuOpen}
          >
            <Menu size={16} aria-hidden="true" />
          </button>

          {hamburgerMenuOpen && (
            <HamburgerMenuPanel
              menuListRef={hamburgerMenuListRef}
              menuButtonRef={hamburgerButtonRef}
              onCloseMenu={() => setHamburgerMenuOpen(false)}
              onOpenHistory={onOpenHistory}
              onOpenManagement={onOpenManagement}
              onOpenDesignSystem={onOpenDesignSystem}
              onOpenMcp={onOpenMcp}
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
