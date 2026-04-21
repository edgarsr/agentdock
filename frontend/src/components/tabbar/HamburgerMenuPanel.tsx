import { RefObject } from 'react';
import {
  DesignTabIcon,
  HistoryTabIcon,
  ManagementTabIcon,
  McpTabIcon,
  PromptLibraryTabIcon,
  SettingsTabIcon,
  SystemInstructionsTabIcon,
} from './TabIcons';
import { moveMenuFocus } from './menuFocus';

type MenuAction = {
  label: string;
  icon: JSX.Element;
  onClick: () => void;
};

interface HamburgerMenuPanelProps {
  menuListRef: RefObject<HTMLDivElement>;
  menuButtonRef: RefObject<HTMLButtonElement>;
  onCloseMenu: () => void;
  onOpenHistory: () => void;
  onOpenManagement: () => void;
  onOpenDesignSystem: () => void;
  onOpenMcp: () => void;
  onOpenPromptLibrary: () => void;
  onOpenSystemInstructions: () => void;
  onOpenSettings: () => void;
}

export function HamburgerMenuPanel({
  menuListRef,
  menuButtonRef,
  onCloseMenu,
  onOpenHistory,
  onOpenManagement,
  onOpenDesignSystem,
  onOpenMcp,
  onOpenPromptLibrary,
  onOpenSystemInstructions,
  onOpenSettings,
}: HamburgerMenuPanelProps) {
  const isDev = !!(window as any).__IS_DEV;

  const actions: MenuAction[] = [
    { label: 'History', icon: <HistoryTabIcon />, onClick: onOpenHistory },
    { label: 'Service Providers', icon: <ManagementTabIcon />, onClick: onOpenManagement },
    { label: 'Settings', icon: <SettingsTabIcon />, onClick: onOpenSettings },
    { label: 'Prompt Library', icon: <PromptLibraryTabIcon />, onClick: onOpenPromptLibrary },
    { label: 'System Instructions', icon: <SystemInstructionsTabIcon />, onClick: onOpenSystemInstructions },
    { label: 'MCP Servers', icon: <McpTabIcon />, onClick: onOpenMcp },
    ...(isDev ? [{ label: 'Design System', icon: <DesignTabIcon />, onClick: onOpenDesignSystem }] : []),
  ];

  return (
    <div
      ref={menuListRef}
      className="absolute top-full right-0 mt-1 w-max whitespace-nowrap bg-background border
        border-[var(--ide-Button-startBorderColor)] rounded-[8px] py-1.5 z-50 text-ide-small"
      role="menu"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onCloseMenu();
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
      {actions.map((action) => (
        <button
          key={action.label}
          onClick={() => {
            action.onClick();
            onCloseMenu();
          }}
          className="mb-0.5 ml-2 mr-4 flex w-[calc(100%-1rem)] items-center rounded-[4px] px-3 min-h-8 text-left
            text-foreground hover:bg-accent hover:text-accent-foreground transition-colors group focus:outline-none
            focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
          role="menuitem"
        >
          <span className="mr-2 flex items-center justify-center">
            {action.icon}
          </span>
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  );
}
