import { useChatSession } from '../../hooks/useChatSession';
import { AgentOption, HistorySessionMeta } from '../../types/chat';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import PermissionModal from './PermissionModal';

interface ChatSessionProps {
  isActive: boolean;
  initialAgentId?: string;
  chatId: string;
  availableAgents: AgentOption[];
  historySession?: HistorySessionMeta;
  onAgentChangeRequest?: (agentId: string) => void;
}

export default function ChatSessionView({ 
  isActive, 
  initialAgentId, 
  chatId,
  availableAgents,
  historySession,
  onAgentChangeRequest
}: ChatSessionProps) {
  const {
    messages,
    inputValue,
    setInputValue,
    status,
    isSending,
    agentOptions,
    selectedAgentId,
    modelOptions,
    selectedModelId,
    handleModelChange,
    modeOptions,
    selectedModeId,
    handleModeChange,
    permissionRequest,
    handleSend,
    handleStop,
    handlePermissionDecision,
    hasSelectedAgent
  } = useChatSession(chatId, availableAgents, initialAgentId, historySession);

  return (
    <div className="flex flex-col h-full relative">
      <MessageList messages={messages} />

      <ChatInput
        inputValue={inputValue}
        onInputChange={setInputValue}
        onSend={handleSend}
        onStop={handleStop}
        isSending={isSending}
        status={status}
        
        agentOptions={agentOptions}
        selectedAgentId={selectedAgentId}
        onAgentChange={(id) => {
          if (onAgentChangeRequest && id !== selectedAgentId) {
            onAgentChangeRequest(id);
          }
        }}
        
        modelOptions={modelOptions}
        selectedModelId={selectedModelId}
        onModelChange={handleModelChange}
        
        modeOptions={modeOptions}
        selectedModeId={selectedModeId}
        onModeChange={handleModeChange}
        
        hasSelectedAgent={hasSelectedAgent}
      />

      {status === 'initializing' && (
        <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex flex-col items-center justify-center animate-in fade-in duration-300">
           <div className="flex flex-col items-center gap-4 p-8 bg-surface border border-border shadow-2xl rounded-2xl max-w-sm text-center">
              <div className="w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin"></div>
              <div>
                <h3 className="text-lg font-bold text-foreground">Preparing Agent</h3>
                <p className="text-sm text-foreground/60 mt-1">Downloading and initializing resources. This might take a moment.</p>
              </div>
           </div>
        </div>
      )}

      {permissionRequest && isActive && (
        <PermissionModal 
          request={permissionRequest} 
          onRespond={handlePermissionDecision} 
        />
      )}
    </div>
  );
}
