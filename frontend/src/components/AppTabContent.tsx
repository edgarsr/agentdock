import { AgentOption, ChatTab, PendingHandoffContext } from '../types/chat';
import ChatSessionView from './chat/ChatSessionView';

interface AppTabContentProps {
  tab: ChatTab;
  isActive: boolean;
  runnableAgents: AgentOption[];
  promptNavigationHoverOnly: boolean;
  pendingHandoff?: PendingHandoffContext;
  onUserMessageSent: () => void;
  onAssistantActivity: () => void;
  onCanMarkReadChange: (canMarkRead: boolean) => void;
  onPermissionRequestChange: (hasPendingPermission: boolean) => void;
  onProcessingChange: (isProcessing: boolean) => void;
  onQueuedChange: (hasQueuedPrompts: boolean) => void;
  onAgentChangeRequest: Parameters<typeof ChatSessionView>[0]['onAgentChangeRequest'];
  onForkRequest: Parameters<typeof ChatSessionView>[0]['onForkRequest'];
  onHandoffConsumed: (handoffId: string) => void;
  onSessionStateChange: Parameters<typeof ChatSessionView>[0]['onSessionStateChange'];
}

export function AppTabContent({
  tab,
  isActive,
  runnableAgents,
  promptNavigationHoverOnly,
  pendingHandoff,
  onUserMessageSent,
  onAssistantActivity,
  onCanMarkReadChange,
  onPermissionRequestChange,
  onProcessingChange,
  onQueuedChange,
  onAgentChangeRequest,
  onForkRequest,
  onHandoffConsumed,
  onSessionStateChange,
}: AppTabContentProps) {
  return (
    <div className={`absolute inset-0 w-full h-full bg-background ${isActive ? 'z-10 visible' : 'z-0 invisible'}`}>
      <ChatSessionView
        initialAgentId={tab.agentId}
        conversationId={tab.conversationId}
        historySession={tab.historySession}
        pendingHandoff={pendingHandoff}
        initialMessages={tab.initialMessages}
        inheritedHandoffText={tab.inheritedHandoffText}
        metadataTitleOverride={tab.metadataTitleOverride}
        inheritedAdapterNames={tab.inheritedAdapterNames}
        forkBase={tab.forkBase}
        restored={tab.restored}
        availableAgents={runnableAgents}
        promptNavigationHoverOnly={promptNavigationHoverOnly}
        isActive={isActive}
        onUserMessageSent={onUserMessageSent}
        onAssistantActivity={onAssistantActivity}
        onCanMarkReadChange={onCanMarkReadChange}
        onPermissionRequestChange={onPermissionRequestChange}
        onProcessingChange={onProcessingChange}
        onQueuedChange={onQueuedChange}
        onAgentChangeRequest={onAgentChangeRequest}
        onForkRequest={onForkRequest}
        onHandoffConsumed={onHandoffConsumed}
        onSessionStateChange={onSessionStateChange}
      />
    </div>
  );
}
