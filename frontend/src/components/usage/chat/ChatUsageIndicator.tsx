import { ClaudeChatUsage } from './ClaudeChatUsage';
import { CopilotChatUsage } from './CopilotChatUsage';
import { CodexChatUsage } from './CodexChatUsage';

interface ChatUsageIndicatorProps {
  agentId: string;
  modelId?: string;
}

function isOpenCodeOpenAiModel(agentId: string, modelId?: string): boolean {
  return agentId === 'opencode' && modelId?.trim().toLowerCase().startsWith('openai/') === true;
}

export function ChatUsageIndicator({ agentId, modelId }: ChatUsageIndicatorProps) {
  if (isOpenCodeOpenAiModel(agentId, modelId)) {
    return <CodexChatUsage />;
  }

  switch (agentId) {
    case 'claude-code':
      return <ClaudeChatUsage />;
    case 'codex':
      return <CodexChatUsage />;
    case 'github-copilot-cli':
      return <CopilotChatUsage />;
    default:
      return null;
  }
}
