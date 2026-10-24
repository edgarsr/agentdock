import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { History, House, Settings } from 'lucide-react';
import { isAgentRunnable } from '../types/chat';
import type { GlobalSettings } from '../types/chat';
import { clampSidebarWidth, MIN_SIDEBAR_WIDTH } from '../hooks/app/useAppLayout';
import { TabBarProps } from './TabBar';
import {
  iconButtonClassName,
  OpenInBrowserButton,
  SidebarLayoutMenu,
  SidebarVisibilityButton,
  touchIconButtonClassName,
} from './LayoutControls';
import { Tooltip } from './chat/shared/Tooltip';
import { rowButtonClassName, sidebarRowClassName } from './tabbar/rows';
import { NewChatSplitButton } from './tabbar/NewChatSplitButton';
import { OpenChatList } from './tabbar/OpenChatList';

type SidebarProps = Omit<TabBarProps, 'isIslandsTheme' | 'onUseSidebar' | 'sidebarPosition'> & {
  position: GlobalSettings['sidebarPosition'];
  hidden: boolean;
  animateVisibility: boolean;
  overlay: boolean;
  preferredWidth: number;
  viewportWidth: number;
  newTabAgentId?: string;
  onWidthChange: (width: number) => void;
  onHide: () => void;
  onShowHome: () => void;
  onUseTabBar: () => void;
  openInEditor: boolean;
  onToggleOpenInEditor: () => void;
  browserAccessEnabled: boolean;
  onTogglePosition: () => void;
};

export function Sidebar({
  position,
  hidden,
  animateVisibility,
  overlay,
  preferredWidth,
  viewportWidth,
  newTabAgentId,
  onWidthChange,
  onHide,
  onShowHome,
  onUseTabBar,
  openInEditor,
  onToggleOpenInEditor,
  browserAccessEnabled,
  onTogglePosition,
  onNewTab,
  onNewTabWithAgent,
  noRunnableAgents,
  ...navigationProps
}: SidebarProps) {
  const { agents } = navigationProps;
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
        <div className="flex shrink-0 flex-col gap-1 px-2 pb-2 text-ide-small">
          {/* Hide sits at the outer edge, where Show appears once the sidebar is hidden. */}
          <div className={`flex h-10 items-center touch:h-12 touch:gap-2 ${position === 'right' ? 'flex-row-reverse' : ''}`}>
            <SidebarVisibilityButton position={position} hidden={false} onClick={onHide} />
            <OpenInBrowserButton browserAccessEnabled={browserAccessEnabled} />
            <SidebarLayoutMenu
              position={position}
              onTogglePosition={onTogglePosition}
              onUseTabBar={onUseTabBar}
              openInEditor={openInEditor}
              onToggleOpenInEditor={onToggleOpenInEditor}
            />
            {/* At the inner edge, next to the content it shows. */}
            <Tooltip variant="minimal" placement="bottom" content="Home" className={position === 'left' ? 'ml-auto' : 'mr-auto'}>
              <button
                type="button"
                onClick={onShowHome}
                className={`${iconButtonClassName} ${touchIconButtonClassName}`}
                aria-label="Home"
              >
                <House size={16} aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
          {!noRunnableAgents ? (
            <NewChatSplitButton
              agents={agents}
              runnableAgents={agents.filter(isAgentRunnable)}
              defaultAgentId={newTabAgentId}
              onNewTab={onNewTab}
              onNewTabWithAgent={onNewTabWithAgent}
            />
          ) : null}
          <div className={`${sidebarRowClassName(false)} h-8`}>
            <button
              type="button"
              data-section-opener
              onClick={navigationProps.onOpenHistory}
              className={rowButtonClassName}
            >
              <History size={14} aria-hidden="true" className="shrink-0" />
              <span className="truncate">Chat History</span>
            </button>
          </div>
        </div>
        <nav
          aria-label="Open chats"
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pt-1.5 text-ide-small"
        >
          <OpenChatList
            {...navigationProps}
            tabUi={navigationProps.tabUi ?? {}}
          />
        </nav>
        {/* Opens the section popup at the last section opened other than the history. */}
        <div className="shrink-0 px-2 pb-2 text-ide-small">
          <div className="mb-1.5 mt-1 border-t border-border" />
          <div className={`${sidebarRowClassName(false)} h-8`}>
            <button
              type="button"
              data-section-opener
              onClick={navigationProps.onOpenLastSettings}
              className={rowButtonClassName}
            >
              <Settings size={14} aria-hidden="true" className="shrink-0" />
              <span className="truncate">Settings</span>
            </button>
          </div>
        </div>
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
