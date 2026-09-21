import type { AgentOption, ChatTab, HistorySessionMeta, SectionType } from '../types/chat';
import { AgentManagementView } from './AgentManagement';
import { DesignSystemView } from './DesignSystem';
import HistoryPanel from './HistoryPanel';
import { McpServersView } from './McpServersView';
import { CustomAcpView } from './CustomAcpView';
import { PromptLibraryView } from './PromptLibraryView';
import { SettingsView } from './SettingsView';
import { SystemInstructionsView } from './SystemInstructionsView';

interface AppSectionContentProps {
  section: SectionType;
  isActive: boolean;
  availableAgents: AgentOption[];
  tabs: ChatTab[];
  historyList: HistorySessionMeta[];
  historyLoaded: boolean;
  hasOpenConversationsForAdapter: (adapterId: string) => boolean;
  onUpdateAgent: (adapterId: string) => void;
  onOpenHistory: Parameters<typeof HistoryPanel>[0]['onOpenSession'];
}

export function AppSectionContent({
  section,
  isActive,
  availableAgents,
  tabs,
  historyList,
  historyLoaded,
  hasOpenConversationsForAdapter,
  onUpdateAgent,
  onOpenHistory,
}: AppSectionContentProps) {
  return (
    <div className={`absolute inset-0 h-full w-full bg-background ${isActive ? 'z-10 visible' : 'z-0 invisible'}`}>
      {section === 'management' && (
        <AgentManagementView
          initialAgents={availableAgents}
          isActive={isActive}
          hasOpenConversationsForAdapter={hasOpenConversationsForAdapter}
          onUpdateAgent={onUpdateAgent}
        />
      )}
      {section === 'design' && <DesignSystemView />}
      {section === 'history' && (
        <HistoryPanel
          availableAgents={availableAgents}
          tabs={tabs}
          historyList={historyList}
          historyLoaded={historyLoaded}
          isActive={isActive}
          onOpenSession={onOpenHistory}
        />
      )}
      {section === 'mcp' && <McpServersView />}
      {section === 'custom-acp' && <CustomAcpView />}
      {section === 'prompt-library' && <PromptLibraryView />}
      {section === 'system-instructions' && <SystemInstructionsView />}
      {section === 'settings' && <SettingsView />}
    </div>
  );
}
