import { ClaudeChatUsage } from './ClaudeChatUsage';
import { CopilotChatUsage } from './CopilotChatUsage';
import { CodexChatUsage } from './CodexChatUsage';

interface ChatUsageIndicatorProps {
  agentId: string;
  modelId?: string;
}

export function ChatUsageIndicator({ agentId }: ChatUsageIndicatorProps) {
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
