import {
  Archive, Bookmark, Bot, FileText, History, Keyboard, Network, Paintbrush, Palette, Pin, Plug, SlidersHorizontal,
} from 'lucide-react';
import { AgentOption, ChatTab } from '../../types/chat';
import { sanitizeSvg } from '../../utils/sanitizeHtml';

export const ManagementTabIcon = () => <Bot size={14} className="text-foreground/70 flex-shrink-0" />;
export const DesignTabIcon = () => <Palette size={14} className="text-foreground/70 flex-shrink-0" />;
export const McpTabIcon = () => <Network size={14} className="text-foreground/70 flex-shrink-0" />;
export const CustomAcpTabIcon = () => <Plug size={14} className="text-foreground/70 flex-shrink-0" />;
export const HistoryTabIcon = () => <History size={14} className="text-foreground/70 flex-shrink-0" />;
export const ArchiveTabIcon = () => <Archive size={14} className="text-foreground/70 flex-shrink-0" />;
export const PromptLibraryTabIcon = () => <Bookmark size={14} className="text-foreground/70 flex-shrink-0" />;
export const SystemInstructionsTabIcon = () => <FileText size={14} className="text-foreground/70 flex-shrink-0" />;
export const AppearanceTabIcon = () => <Paintbrush size={14} className="text-foreground/70 flex-shrink-0" />;
export const GeneralTabIcon = () => <SlidersHorizontal size={14} className="text-foreground/70 flex-shrink-0" />;
export const ShortcutsTabIcon = () => <Keyboard size={14} className="text-foreground/70 flex-shrink-0" />;
export const PinIcon = ({ pinned }: { pinned: boolean }) => (
  <Pin size={12} fill={pinned ? 'currentColor' : 'none'} className="rotate-45" aria-hidden="true" />
);
export const getAgentIcon = (agentId: string | undefined, agents: AgentOption[], sizeClassName = 'w-4 h-4') => {
  const agent = agentId ? agents.find(a => a.id === agentId) : undefined;
  if (agent && agent.iconPath) {
    if (agent.iconPath.startsWith('<svg')) {
      return (
        <div className={`${sizeClassName} flex-shrink-0 flex items-center justify-center text-foreground`} dangerouslySetInnerHTML={{ __html: sanitizeSvg(agent.iconPath) }} />
      );
    }
    return <img src={agent.iconPath} draggable={false} className={`${sizeClassName} flex-shrink-0`} alt="icon" />;
  }
  return <Bot size={14} className="text-foreground flex-shrink-0" />;
};

export const getTabIcon = (tab: ChatTab, agents: AgentOption[]) => {
  return getAgentIcon(tab.agentId, agents);
};
