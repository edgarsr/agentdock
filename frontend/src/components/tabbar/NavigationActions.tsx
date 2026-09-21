import { X } from 'lucide-react';
import type { SectionType } from '../../types/chat';
import { Tooltip } from '../chat/shared/Tooltip';
import {
  DesignTabIcon,
  HistoryTabIcon,
  ManagementTabIcon,
  McpTabIcon,
  CustomAcpTabIcon,
  PromptLibraryTabIcon,
  SettingsTabIcon,
  SystemInstructionsTabIcon,
} from './TabIcons';

type MenuAction = {
  type: SectionType;
  label: string;
  icon: JSX.Element;
  onClick: () => void;
};

export interface NavigationActionsProps {
  activeSection: SectionType | null;
  onCloseActiveSection: () => void;
  onOpenHistory: () => void;
  onOpenManagement: () => void;
  onOpenDesignSystem: () => void;
  onOpenMcp: () => void;
  onOpenCustomAcp: () => void;
  onOpenPromptLibrary: () => void;
  onOpenSystemInstructions: () => void;
  onOpenSettings: () => void;
  onAction?: () => void;
}

export function NavigationActions({
  activeSection,
  onCloseActiveSection,
  onAction,
  onOpenHistory,
  onOpenManagement,
  onOpenDesignSystem,
  onOpenMcp,
  onOpenCustomAcp,
  onOpenPromptLibrary,
  onOpenSystemInstructions,
  onOpenSettings,
}: NavigationActionsProps) {
  const isDev = !!(window as any).__IS_DEV;
  const tooltipPlacement = onAction ? 'bottom' : 'top';
  const actions: MenuAction[] = [
    { type: 'history', label: 'History', icon: <HistoryTabIcon />, onClick: onOpenHistory },
    { type: 'management', label: 'Service Providers', icon: <ManagementTabIcon />, onClick: onOpenManagement },
    { type: 'settings', label: 'Settings', icon: <SettingsTabIcon />, onClick: onOpenSettings },
    { type: 'prompt-library', label: 'Prompt Library', icon: <PromptLibraryTabIcon />, onClick: onOpenPromptLibrary },
    { type: 'system-instructions', label: 'System Instructions', icon: <SystemInstructionsTabIcon />, onClick: onOpenSystemInstructions },
    { type: 'mcp', label: 'MCP Servers', icon: <McpTabIcon />, onClick: onOpenMcp },
    { type: 'custom-acp', label: 'Custom ACP', icon: <CustomAcpTabIcon />, onClick: onOpenCustomAcp },
    ...(isDev ? [{ type: 'design' as const, label: 'Design System', icon: <DesignTabIcon />, onClick: onOpenDesignSystem }] : []),
  ];

  return (
    <>
      {actions.map((action) => {
        const isActive = action.type === activeSection;
        return (
          <div
            key={action.type}
            className={`group mx-2 mb-0.5 flex min-h-8 items-stretch rounded-[4px] ${isActive
              ? 'relative text-foreground before:pointer-events-none before:absolute before:inset-0 before:rounded-[4px] before:bg-background before:[filter:var(--ide-surface-active-filter)]'
              : 'relative text-foreground before:pointer-events-none before:absolute before:inset-0 before:rounded-[4px] before:bg-background before:opacity-0 before:[filter:var(--ide-surface-active-filter)] hover:before:opacity-100 focus-within:before:opacity-100'}`}
          >
            <button
              onClick={() => {
                action.onClick();
                onAction?.();
              }}
              className="relative z-10 flex min-w-0 flex-1 items-center rounded-[4px] px-3 text-left focus:outline-none
                focus-visible:shadow-[inset_0_0_0_1px_var(--ide-Button-default-focusColor)]"
              role={onAction ? 'menuitem' : undefined}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className="mr-2 flex shrink-0 items-center justify-center">{action.icon}</span>
              <span className="truncate">{action.label}</span>
            </button>
            {isActive ? (
              <div className="relative z-10 w-0 overflow-hidden opacity-0 pointer-events-none
                group-hover:mr-1.5 group-hover:w-5 group-hover:opacity-100 group-hover:pointer-events-auto
                group-focus-within:mr-1.5 group-focus-within:w-5 group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
              >
                <Tooltip variant="minimal" placement={tooltipPlacement} content="Close" className="flex h-full w-5">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onCloseActiveSection();
                      onAction?.();
                    }}
                    className="flex min-h-8 w-5 shrink-0 items-center justify-center rounded-r-[4px]
                      text-foreground-secondary hover:text-foreground focus:outline-none"
                    role={onAction ? 'menuitem' : undefined}
                    aria-label={`Close ${action.label}`}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </Tooltip>
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
