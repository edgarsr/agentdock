import {
  AppWindow,
  EllipsisVertical,
  Globe,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  PanelRightClose,
  PanelRightOpen,
  PanelTop,
  SquareArrowDownLeft,
} from 'lucide-react';
import type { GlobalSettings } from '../types/chat';
import { Tooltip } from './chat/shared/Tooltip';
import { PopupMenu, popupMenuActions } from './ui/PopupMenu';
import { rowFocusClassName } from './tabbar/rows';
import { uiWorkspace } from '../utils/uiWorkspace';

export const iconButtonClassName = `flex h-7 w-7 items-center justify-center rounded-[4px] text-foreground-secondary
  hover:bg-hover hover:text-foreground ${rowFocusClassName}`;

/** Larger on touch screens, for the buttons of the tab bar and the sidebar's top row, which fingers hit poorly. */
export const touchIconButtonClassName = 'touch:h-9 touch:w-9 touch:[&>svg]:h-5 touch:[&>svg]:w-5';

interface SidebarVisibilityButtonProps {
  position: GlobalSettings['sidebarPosition'];
  hidden: boolean;
  onClick: () => void;
}

/**
 * Shown: sits in the sidebar's top row (`h-10`, on touch screens `h-12`, `px-2`). The edge margin puts the 16px icon 1rem from the sidebar
 * edge, in line with the icons below it. Hidden: floats at the same spot, so the toggle stays under the pointer.
 */
export function SidebarVisibilityButton({ position, hidden, onClick }: SidebarVisibilityButtonProps) {
  const label = hidden ? 'Show sidebar' : 'Hide sidebar';
  const icon = position === 'left'
    ? hidden ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />
    : hidden ? <PanelRightOpen size={16} aria-hidden="true" /> : <PanelRightClose size={16} aria-hidden="true" />;

  return (
    <div className={`${hidden ? `fixed top-1.5 z-40 ${position === 'left' ? 'left-2' : 'right-2'}` : 'flex shrink-0'} ${
      position === 'left' ? 'ml-0.5' : 'mr-0.5'
    }`}
    >
      <Tooltip variant="minimal" placement="bottom" content={label}>
        <button
          type="button"
          onClick={onClick}
          className={`${iconButtonClassName} ${touchIconButtonClassName} ${hidden ? 'border border-border bg-background' : ''}`}
          aria-label={label}
        >
          {icon}
        </button>
      </Tooltip>
    </div>
  );
}

/** Moves the UI from the IDE to a web browser; the browser page restores the saved workspace. */
export function openInBrowser() {
  uiWorkspace.save();
  window.__openInBrowser?.();
}

/** Moving the UI to a web browser concerns only the IDE's own page. */
export function OpenInBrowserButton({ browserAccessEnabled }: { browserAccessEnabled: boolean }) {
  if (!browserAccessEnabled || window.__AGENT_DOCK_CLIENT === 'browser') return null;
  return (
    <Tooltip variant="minimal" placement="bottom" content="Open in browser">
      <button type="button" onClick={openInBrowser} className={iconButtonClassName} aria-label="Open in browser">
        <Globe size={16} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

interface SidebarLayoutMenuProps {
  position: GlobalSettings['sidebarPosition'];
  onTogglePosition: () => void;
  onUseTabBar: () => void;
  openInEditor: boolean;
  onToggleOpenInEditor: () => void;
}

export function SidebarLayoutMenu({
  position,
  onTogglePosition,
  onUseTabBar,
  openInEditor,
  onToggleOpenInEditor,
}: SidebarLayoutMenuProps) {
  const items = [
    {
      label: position === 'left' ? 'Move sidebar to right' : 'Move sidebar to left',
      icon: position === 'left' ? <PanelRight size={14} aria-hidden="true" /> : <PanelLeft size={14} aria-hidden="true" />,
      onClick: onTogglePosition,
    },
    { label: 'Use tab bar', icon: <PanelTop size={14} aria-hidden="true" />, onClick: onUseTabBar },
    // Where the UI opens in the IDE concerns only the IDE's own page.
    ...(window.__AGENT_DOCK_CLIENT === 'browser' ? [] : [{
      label: openInEditor ? 'Open in tool window' : 'Open in editor tab',
      icon: openInEditor ? <SquareArrowDownLeft size={14} aria-hidden="true" /> : <AppWindow size={14} aria-hidden="true" />,
      onClick: onToggleOpenInEditor,
    }]),
  ];

  return (
    <PopupMenu
      renderTrigger={(triggerProps) => (
        <Tooltip variant="minimal" placement="bottom" content="Layout">
          <button
            type="button"
            {...triggerProps}
            className={`${iconButtonClassName} ${touchIconButtonClassName}`}
            aria-label="Layout"
          >
            <EllipsisVertical size={16} aria-hidden="true" />
          </button>
        </Tooltip>
      )}
    >
      {popupMenuActions(items)}
    </PopupMenu>
  );
}

interface UseSidebarButtonProps {
  position: GlobalSettings['sidebarPosition'];
  onClick: () => void;
}

export function UseSidebarButton({ position, onClick }: UseSidebarButtonProps) {
  return (
    <Tooltip variant="minimal" placement="bottom" content="Use sidebar" className="flex h-full shrink-0 items-center pl-2">
      <button
        type="button"
        onClick={onClick}
        className={`${iconButtonClassName} ${touchIconButtonClassName}`}
        aria-label="Use sidebar"
      >
        {position === 'left'
          ? <PanelLeft size={16} aria-hidden="true" />
          : <PanelRight size={16} aria-hidden="true" />}
      </button>
    </Tooltip>
  );
}
