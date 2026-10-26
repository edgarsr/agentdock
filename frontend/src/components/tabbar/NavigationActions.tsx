import type { JSX } from 'react';
import type { SectionType, SettingsSectionType } from '../../types/chat';
import {
  AppearanceTabIcon,
  ArchiveTabIcon,
  DesignTabIcon,
  GeneralTabIcon,
  HistoryTabIcon,
  ManagementTabIcon,
  McpTabIcon,
  CustomAcpTabIcon,
  PromptLibraryTabIcon,
  ShortcutsTabIcon,
  SystemInstructionsTabIcon,
} from './TabIcons';

export type NavigationAction = {
  type: SectionType;
  label: string;
  icon: JSX.Element;
  onClick: () => void;
};

export interface NavigationActionsProps {
  onOpenHistory: () => void;
  /** Lists "Chat Archive" only when given. */
  onOpenArchive?: () => void;
  onOpenManagement: () => void;
  onOpenDesignSystem: () => void;
  onOpenMcp: () => void;
  onOpenCustomAcp: () => void;
  onOpenPromptLibrary: () => void;
  /** Lists "System Instructions" only when given. */
  onOpenSystemInstructions?: () => void;
  onOpenSettings: (section: SettingsSectionType) => void;
}

export function getNavigationActions({
  onOpenHistory,
  onOpenArchive,
  onOpenManagement,
  onOpenDesignSystem,
  onOpenMcp,
  onOpenCustomAcp,
  onOpenPromptLibrary,
  onOpenSystemInstructions,
  onOpenSettings,
}: NavigationActionsProps): NavigationAction[] {
  const isDev = !!(window as any).__IS_DEV;
  return [
    { type: 'management', label: 'Agents', icon: <ManagementTabIcon />, onClick: onOpenManagement },
    { type: 'general', label: 'General', icon: <GeneralTabIcon />, onClick: () => onOpenSettings('general') },
    { type: 'appearance', label: 'Appearance', icon: <AppearanceTabIcon />, onClick: () => onOpenSettings('appearance') },
    { type: 'shortcuts', label: 'Shortcuts', icon: <ShortcutsTabIcon />, onClick: () => onOpenSettings('shortcuts') },
    { type: 'prompt-library', label: 'Prompt Library', icon: <PromptLibraryTabIcon />, onClick: onOpenPromptLibrary },
    ...(onOpenSystemInstructions ? [{
      type: 'system-instructions' as const, label: 'System Instructions', icon: <SystemInstructionsTabIcon />, onClick: onOpenSystemInstructions,
    }] : []),
    { type: 'mcp', label: 'MCP Servers', icon: <McpTabIcon />, onClick: onOpenMcp },
    { type: 'custom-acp', label: 'Custom ACP', icon: <CustomAcpTabIcon />, onClick: onOpenCustomAcp },
    { type: 'history', label: 'Chat History', icon: <HistoryTabIcon />, onClick: onOpenHistory },
    ...(onOpenArchive ? [{ type: 'archive' as const, label: 'Chat Archive', icon: <ArchiveTabIcon />, onClick: onOpenArchive }] : []),
    ...(isDev ? [{ type: 'design' as const, label: 'Design System', icon: <DesignTabIcon />, onClick: onOpenDesignSystem }] : []),
  ];
}
