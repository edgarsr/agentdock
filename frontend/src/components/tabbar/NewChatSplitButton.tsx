import { useState } from 'react';
import { ChevronRight, SquarePen, SquareTerminal } from 'lucide-react';
import type { AgentOption } from '../../types/chat';
import { ACPBridge } from '../../utils/bridge';
import { Tooltip } from '../chat/shared/Tooltip';
import { getAgentIcon } from './TabIcons';
import { menuRowClassName, rowButtonClassName, rowFocusClassName, RowAction, sidebarRowClassName } from './rows';

interface AgentRowProps {
  agent: AgentOption;
  agents: AgentOption[];
  onNewTabWithAgent: (agentId: string) => void;
  /** Given in the tab bar menu; closes it. */
  onAction?: () => void;
}

/** Starts a chat with the agent; the terminal button shows on hover. In the sidebar the icon lines up with "New Chat". */
export function AgentRow({ agent, agents, onNewTabWithAgent, onAction }: AgentRowProps) {
  const menu = onAction !== undefined;

  return (
    <div className={`group h-8 ${menu ? menuRowClassName(false) : sidebarRowClassName(false)}`}>
      <button
        type="button"
        role={menu ? 'menuitem' : undefined}
        onClick={() => {
          onNewTabWithAgent(agent.id);
          onAction?.();
        }}
        className={`${rowButtonClassName} ${menu ? '' : 'pl-[calc(0.5rem_+_12px_+_0.5rem)]'}`}
      >
        <span className="flex shrink-0">{getAgentIcon(agent.id, agents)}</span>
        <span className="truncate">{agent.name}</span>
      </button>
      {agent.cliAvailable ? (
        <RowAction
          label={`Open ${agent.name} in terminal`}
          menu={menu}
          wide
          onClick={() => {
            ACPBridge.openAgentCli(agent.id);
            onAction?.();
          }}
        >
          <SquareTerminal size={14} aria-hidden="true" />
        </RowAction>
      ) : null}
    </div>
  );
}

interface NewChatSplitButtonProps {
  agents: AgentOption[];
  runnableAgents: AgentOption[];
  defaultAgentId?: string;
  onNewTab: () => void;
  onNewTabWithAgent: (agentId: string) => void;
}

/** The row starts a chat with the default agent; its chevron expands the agent list below it. */
export function NewChatSplitButton({
  agents,
  runnableAgents,
  defaultAgentId,
  onNewTab,
  onNewTabWithAgent,
}: NewChatSplitButtonProps) {
  const [agentsExpanded, setAgentsExpanded] = useState(false);
  const optionsLabel = agentsExpanded ? 'Hide new chat options' : 'Show new chat options';

  return (
    <div className="flex flex-col">
      <div className={`${sidebarRowClassName(false)} h-8`}>
        <button type="button" onClick={onNewTab} disabled={!defaultAgentId} className={rowButtonClassName}>
          <SquarePen size={14} aria-hidden="true" className="shrink-0" />
          <span className="truncate">New Chat</span>
        </button>
        <Tooltip variant="minimal" placement="bottom" content={optionsLabel} className="flex">
          <button
            type="button"
            onClick={() => setAgentsExpanded((expanded) => !expanded)}
            className={`flex w-7 shrink-0 items-center justify-center text-foreground-secondary
              hover:text-foreground ${rowFocusClassName}`}
            aria-expanded={agentsExpanded}
            aria-label={optionsLabel}
          >
            <ChevronRight
              size={14}
              aria-hidden="true"
              className={`transition-transform duration-200 ${agentsExpanded ? 'rotate-90' : ''}`}
            />
          </button>
        </Tooltip>
      </div>
      <div
        {...(!agentsExpanded ? { inert: '' } : {})}
        className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${agentsExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-col gap-0.5 pt-0.5">
            {runnableAgents.map((agent) => (
              <AgentRow key={agent.id} agent={agent} agents={agents} onNewTabWithAgent={onNewTabWithAgent} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
