import { Bookmark, Bot, FileText, History, Network, Palette, SlidersHorizontal } from 'lucide-react';
import { AgentOption, ChatTab } from '../../types/chat';
import { sanitizeSvg } from '../../utils/sanitizeHtml';

export const ManagementTabIcon = () => <Bot size={14} className="text-foreground/70 flex-shrink-0" />;
export const DesignTabIcon = () => <Palette size={14} className="text-foreground/70 flex-shrink-0" />;
export const McpTabIcon = () => <Network size={14} className="text-foreground/70 flex-shrink-0" />;
export const HistoryTabIcon = () => <History size={14} className="text-foreground/70 flex-shrink-0" />;
export const PromptLibraryTabIcon = () => <Bookmark size={14} className="text-foreground/70 flex-shrink-0" />;
export const SystemInstructionsTabIcon = () => <FileText size={14} className="text-foreground/70 flex-shrink-0" />;
export const SettingsTabIcon = () => <SlidersHorizontal size={14} className="text-foreground/70 flex-shrink-0" />;

export const getAgentIcon = (agentId: string | undefined, agents: AgentOption[]) => {
  const agent = agentId ? agents.find(a => a.id === agentId) : undefined;
  if (agent && agent.iconPath) {
    if (agent.iconPath.startsWith('<svg')) {
      return (
        <div className="w-4 h-4 flex-shrink-0 flex items-center justify-center text-foreground" dangerouslySetInnerHTML={{ __html: sanitizeSvg(agent.iconPath) }} />
      );
    }
    return <img src={agent.iconPath} className="w-4 h-4 flex-shrink-0" alt="icon" />;
  }
  return <Bot size={14} className="text-foreground flex-shrink-0" />;
};

export const getTabIcon = (tab: ChatTab, agents: AgentOption[]) => {
  if (tab.type === 'management') return <ManagementTabIcon />;
  if (tab.type === 'design') return <DesignTabIcon />;
  if (tab.type === 'history') return <HistoryTabIcon />;
  if (tab.type === 'mcp') return <McpTabIcon />;
  if (tab.type === 'prompt-library') return <PromptLibraryTabIcon />;
  if (tab.type === 'system-instructions') return <SystemInstructionsTabIcon />;
  if (tab.type === 'settings') return <SettingsTabIcon />;
  return getAgentIcon(tab.agentId, agents);
};
