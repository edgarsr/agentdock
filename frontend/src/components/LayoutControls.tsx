import {
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  PanelRightClose,
  PanelRightOpen,
  PanelTop,
} from 'lucide-react';
import type { GlobalSettings } from '../types/chat';
import { Tooltip } from './chat/shared/Tooltip';

const buttonClassName = `flex h-7 w-7 items-center justify-center rounded-[4px] text-foreground-secondary
  hover:bg-hover hover:text-foreground focus:outline-none
  focus-visible:shadow-[inset_0_0_0_1px_var(--ide-Button-default-focusColor)]`;

interface SidebarLayoutControlsProps {
  position: GlobalSettings['sidebarPosition'];
  hidden: boolean;
  onToggleVisibility: () => void;
  onUseTabBar: () => void;
  floating?: boolean;
}

export function SidebarLayoutControls({
  position,
  hidden,
  onToggleVisibility,
  onUseTabBar,
  floating = false,
}: SidebarLayoutControlsProps) {
  const visibilityIcon = position === 'left'
    ? hidden ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />
    : hidden ? <PanelRightOpen size={16} aria-hidden="true" /> : <PanelRightClose size={16} aria-hidden="true" />;

  return (
    <div className={`flex items-center gap-0.5 ${floating
      ? `fixed top-2 z-40 rounded-[5px] border border-border bg-background p-0.5 ${position === 'left' ? 'left-1.5' : 'right-1.5'}`
      : ''}`}
    >
      <Tooltip variant="minimal" placement="bottom" content={hidden ? 'Show sidebar' : 'Hide sidebar'}>
        <button
          type="button"
          onClick={onToggleVisibility}
          className={buttonClassName}
          aria-label={hidden ? 'Show sidebar' : 'Hide sidebar'}
        >
          {visibilityIcon}
        </button>
      </Tooltip>
      <Tooltip variant="minimal" placement="bottom" content="Use tab bar">
        <button
          type="button"
          onClick={onUseTabBar}
          className={buttonClassName}
          aria-label="Use tab bar"
        >
          <PanelTop size={16} aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
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
        className={buttonClassName}
        aria-label="Use sidebar"
      >
        {position === 'left'
          ? <PanelLeft size={16} aria-hidden="true" />
          : <PanelRight size={16} aria-hidden="true" />}
      </button>
    </Tooltip>
  );
}
