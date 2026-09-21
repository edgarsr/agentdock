import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { isAgentRunnable } from '../types/chat';
import type { GlobalSettings, HistorySessionMeta, SidebarSectionId } from '../types/chat';
import { clampSidebarWidth, MIN_SIDEBAR_WIDTH } from '../hooks/app/useAppLayout';
import { TabBarProps } from './TabBar';
import { SidebarLayoutControls } from './LayoutControls';
import { TabNavigationContent } from './tabbar/NavigationMenu';

type SidebarProps = Omit<TabBarProps, 'isIslandsTheme' | 'onUseSidebar' | 'sidebarPosition'> & {
  position: GlobalSettings['sidebarPosition'];
  hidden: boolean;
  animateVisibility: boolean;
  overlay: boolean;
  preferredWidth: number;
  viewportWidth: number;
  historyList: HistorySessionMeta[];
  expandedSections: SidebarSectionId[];
  onSectionExpandedChange: (section: SidebarSectionId, expanded: boolean) => void;
  onOpenRecentConversation: (session: HistorySessionMeta) => void;
  onWidthChange: (width: number) => void;
  onHide: () => void;
  onUseTabBar: () => void;
  openInEditor: boolean;
  onToggleOpenInEditor: () => void;
  onTogglePosition: () => void;
};

export function Sidebar({
  position,
  hidden,
  animateVisibility,
  overlay,
  preferredWidth,
  viewportWidth,
  historyList,
  expandedSections,
  onSectionExpandedChange,
  onOpenRecentConversation,
  onWidthChange,
  onHide,
  onUseTabBar,
  openInEditor,
  onToggleOpenInEditor,
  onTogglePosition,
  onNewTab,
  ...navigationProps
}: SidebarProps) {
  const containerRef = useRef<HTMLElement>(null);
  const stopResizingRef = useRef<(() => void) | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const clampWidth = useCallback((width: number, availableWidth: number) => {
    if (!overlay) return clampSidebarWidth(width, availableWidth);
    return Math.min(
      Math.max(MIN_SIDEBAR_WIDTH, width),
      Math.max(0, availableWidth - 40)
    );
  }, [overlay]);
  const effectiveWidth = clampWidth(preferredWidth, viewportWidth);

  const startResizing = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();

    const layoutBounds = containerRef.current?.parentElement?.getBoundingClientRect();
    if (!layoutBounds) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const cleanup = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setIsResizing(false);
      stopResizingRef.current = null;
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const requestedWidth = position === 'left'
        ? moveEvent.clientX - layoutBounds.left
        : layoutBounds.right - moveEvent.clientX;
      onWidthChange(Math.round(clampWidth(requestedWidth, layoutBounds.width)));
    };

    const handlePointerUp = () => {
      cleanup();
    };

    stopResizingRef.current = cleanup;
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  }, [clampWidth, onWidthChange, position]);

  useEffect(() => () => stopResizingRef.current?.(), []);

  return (
    <aside
      ref={containerRef}
      aria-hidden={hidden}
      {...(hidden ? { inert: '' } : {})}
      style={{ width: overlay || hidden ? '0px' : `${effectiveWidth}px` }}
      className={`relative z-40 h-full min-h-0 shrink-0 ${animateVisibility ? 'transition-[width] duration-200 ease-in-out' : ''} ${
        overlay ? 'overflow-visible' : 'overflow-hidden'
      } ${
        position === 'left' ? 'order-first' : 'order-last'
      }`}
    >
      <div
        style={{ width: `${effectiveWidth}px` }}
        className={`absolute inset-y-0 flex min-h-0 flex-col bg-background transition-transform duration-200 ease-in-out ${
          overlay ? 'shadow-lg' : ''
        } ${
          position === 'left'
            ? `left-0 border-r border-border ${hidden ? '-translate-x-full' : 'translate-x-0'}`
            : `right-0 border-l border-border ${hidden ? 'translate-x-full' : 'translate-x-0'}`
        }`}
      >
        <div className={`flex h-9 shrink-0 items-center px-2.5 ${position === 'right' ? 'justify-end' : ''}`}>
          <SidebarLayoutControls
            position={position}
            hidden={false}
            onToggleVisibility={onHide}
            onUseTabBar={onUseTabBar}
            openInEditor={openInEditor}
            onToggleOpenInEditor={onToggleOpenInEditor}
            onTogglePosition={onTogglePosition}
          />
        </div>
        <nav
          aria-label="Agent Dock navigation"
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-1.5 text-ide-small"
        >
          <TabNavigationContent
            {...navigationProps}
            tabUi={navigationProps.tabUi ?? {}}
            runnableAgents={navigationProps.agents.filter(isAgentRunnable)}
            onNewTab={onNewTab}
            historyList={historyList}
            sidebarExpandedSections={expandedSections}
            onSidebarSectionExpandedChange={onSectionExpandedChange}
            onOpenRecentConversation={onOpenRecentConversation}
            pinActionsToBottom
          />
        </nav>
        <div
          role="separator"
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          onPointerDown={startResizing}
          className={`group absolute inset-y-0 z-20 w-4 cursor-col-resize touch-none select-none ${hidden ? 'hidden' : ''} ${
            position === 'left' ? '-right-2' : '-left-2'
          }`}
        >
          <span
            aria-hidden="true"
            className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors duration-150 ${
              isResizing
                ? 'bg-[var(--ide-Button-default-focusColor)]'
                : 'bg-transparent group-hover:bg-[var(--ide-Button-default-focusColor)]'
            }`}
          />
        </div>
      </div>
    </aside>
  );
}
