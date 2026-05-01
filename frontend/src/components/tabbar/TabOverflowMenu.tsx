import { RefObject } from 'react';
import { X } from 'lucide-react';
import { AgentOption, ChatTab, TabUiFlags } from '../../types/chat';
import { ACPBridge } from '../../utils/bridge';
import { Tooltip } from '../chat/shared/Tooltip';
import { getAgentIcon, getTabIcon } from './TabIcons';
import { moveMenuFocus } from './menuFocus';

interface TabOverflowMenuProps {
  menuListRef: RefObject<HTMLDivElement>;
  menuButtonRef: RefObject<HTMLButtonElement>;
  tabs: ChatTab[];
  tabUi: Record<string, TabUiFlags>;
  activeTabId: string;
  agents: AgentOption[];
  runnableAgents: AgentOption[];
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseAllTabs: () => void;
  onNewTabWithAgent: (agentId: string) => void;
  onCloseMenu: () => void;
}

export function TabOverflowMenu({
  menuListRef,
  menuButtonRef,
  tabs,
  tabUi,
  activeTabId,
  agents,
  runnableAgents,
  onSelectTab,
  onCloseTab,
  onCloseAllTabs,
  onNewTabWithAgent,
  onCloseMenu,
}: TabOverflowMenuProps) {
  return (
    <div
      ref={menuListRef}
      className="absolute top-full right-0 mt-1 w-max max-w-[250px] overflow-y-auto whitespace-nowrap bg-background
        border border-[var(--ide-Button-startBorderColor)] rounded-[8px] py-1.5 z-50 no-scrollbar text-ide-small"
      role="menu"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onCloseMenu();
          menuButtonRef.current?.focus();
          return;
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          moveMenuFocus(menuListRef.current, 1);
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          moveMenuFocus(menuListRef.current, -1);
        }
      }}
    >
      {tabs.length > 0 && (
        <div className="mb-1">
          <div className="text-ide-small px-5 py-1 text-[var(--ide-Label-disabledForeground)]">
            Open Tabs
          </div>
          {tabs.map((tab) => {
            const flags = tabUi[tab.id];
            const hasWarning = !!flags?.warning;
            const hasUnread = !!flags?.unread;
            const hasProcessing = !!flags?.processing;
            const activeClassName = tab.id === activeTabId
              ? 'bg-accent text-accent-foreground'
              : 'text-foreground hover:bg-accent hover:text-accent-foreground';
            return (
              <div
                key={tab.id}
                className={`mb-0.5 mx-2 flex w-[calc(100%-1rem)] items-stretch rounded-[4px] transition-colors ${activeClassName}`}
              >
                <button
                  onClick={() => {
                    onSelectTab(tab.id);
                    onCloseMenu();
                  }}
                  className="flex min-h-8 min-w-0 flex-1 items-center rounded-l-[4px] px-3 text-left focus:outline-none
                    focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                  role="menuitem"
                >
                  <span className={`mr-2 flex items-center justify-center ${hasProcessing ? 'animate-pulse' : ''}`}>
                    {getTabIcon(tab, agents)}
                  </span>
                  <span className="flex-1 truncate min-w-0">{tab.title}</span>
                  {hasWarning ? (
                    <span className="ml-2 w-2 h-2 rounded-full bg-warning flex-shrink-0" />
                  ) : hasUnread ? (
                    <span className="ml-2 w-2 h-2 rounded-full bg-sky-500 flex-shrink-0" />
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  className="flex min-h-8 w-8 flex-shrink-0 items-center justify-center rounded-r-[4px]
                    text-foreground-secondary hover:bg-hover hover:text-foreground focus:outline-none
                    focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                  role="menuitem"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            );
          })}
          <button
            onClick={() => {
              onCloseAllTabs();
              onCloseMenu();
            }}
            className="mx-2 flex w-[calc(100%-1rem)] items-center rounded-[4px] px-3 py-1 text-left text-foreground
              hover:bg-accent hover:text-accent-foreground transition-colors focus:outline-none
              focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
            role="menuitem"
          >
            <span className="mr-2 flex items-center justify-center">
              <X size={14} aria-hidden="true" />
            </span>
            Close all tabs
          </button>
          <div className="h-[1px] bg-border my-1 mx-2" />
        </div>
      )}

      <div>
        <div className="text-ide-small px-5 py-1 text-[var(--ide-Label-disabledForeground)]">
          New Chat
        </div>
        {runnableAgents.length > 0 ? (
          runnableAgents.map((agent) => (
            <div key={agent.id}
              className="mb-0.5 mx-2 flex w-[calc(100%-1rem)] items-stretch rounded-[4px] text-foreground
              transition-colors hover:bg-accent hover:text-accent-foreground
              focus-within:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
            >
              <button
                onClick={() => {
                  onNewTabWithAgent(agent.id);
                  onCloseMenu();
                }}
                className="flex flex-1 items-center rounded-l-[4px] px-3 min-h-8 text-left focus:outline-none"
                role="menuitem"
              >
                <span className="mr-2 flex items-center justify-center">
                  {getAgentIcon(agent.id, agents)}
                </span>
                <span className="flex-1 min-w-0 truncate">{agent.name}</span>
              </button>
              {agent.cliAvailable ? (
                <div className="ml-2 flex items-stretch self-stretch">
                  <Tooltip variant="minimal" content={`Open ${agent.name} in terminal`} className="flex self-stretch">
                    <button
                      type="button"
                      onClick={() => {
                        ACPBridge.openAgentCli(agent.id);
                        onCloseMenu();
                      }}
                      className="relative flex items-center self-stretch pl-4 pr-2 text-foreground-secondary
                        hover:text-accent-foreground focus:outline-none focus:text-accent-foreground
                        before:pointer-events-none before:absolute before:bottom-[28%] before:left-[3px]
                        before:top-[28%] before:w-px before:bg-[var(--ide-Borders-color)]"
                      role="menuitem"
                    >
                      CLI
                    </button>
                  </Tooltip>
                </div>
              ) : null}
            </div>
          ))
        ) : (
          <div className="px-5 min-h-8 text-[var(--ide-Label-disabledForeground)] italic">No available agents</div>
        )}
      </div>
    </div>
  );
}
