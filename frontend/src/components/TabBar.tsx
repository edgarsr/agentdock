import { useState, useRef, useEffect } from 'react';
import { FileText, History, Network, Palette, Settings } from 'lucide-react';
import { AgentOption, ChatTab, TabUiFlags, isAgentRunnable } from '../types/chat';
import { ACPBridge } from '../utils/bridge';

interface TabBarProps {
  tabs: ChatTab[];
  activeTabId: string;
  tabUi?: Record<string, TabUiFlags>;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseAllTabs: () => void;
  onNewTab: () => void;
  onNewTabWithAgent: (agentId: string) => void;
  agents: AgentOption[];
  onOpenHistory: () => void;
  onOpenManagement: () => void;
  onOpenDesignSystem: () => void;
  onOpenMcp: () => void;
  onOpenSystemInstructions: () => void;
}

const getAgentIcon = (agentId: string | undefined, agents: AgentOption[]) => {
  let agent = agents.find(a => a.id === agentId);
  if (!agent && agents.length > 0) {
    agent = agents.find(isAgentRunnable) || agents[0];
  }
  if (agent && agent.iconPath) {
    if (agent.iconPath.startsWith('<svg')) {
      return (
         <div className="w-4 h-4 flex-shrink-0 flex items-center justify-center text-foreground" dangerouslySetInnerHTML={{ __html: agent.iconPath }} />
      );
    }
    return <img src={agent.iconPath} className="w-4 h-4 flex-shrink-0" alt="icon" />;
  }
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/70 flex-shrink-0">
      <path d="M12 8V4H8"></path>
      <rect width="16" height="12" x="4" y="8" rx="2"></rect>
      <path d="M2 14h2"></path>
      <path d="M20 14h2"></path>
      <path d="M15 13v2"></path>
      <path d="M9 13v2"></path>
    </svg>
  );
};

/** Icon for the management tab in the tab bar */
const ManagementTabIcon = () => <Settings size={14} className="text-foreground/70 flex-shrink-0" />;

/** Icon for the design system tab in the tab bar */
const DesignTabIcon = () => <Palette size={14} className="text-foreground/70 flex-shrink-0" />;

/** Icon for the MCP servers tab in the tab bar */
const McpTabIcon = () => <Network size={14} className="text-foreground/70 flex-shrink-0" />;

/** Icon for the history tab in the tab bar */
const HistoryTabIcon = () => <History size={14} className="text-foreground/70 flex-shrink-0" />;
const SystemInstructionsTabIcon = () => <FileText size={14} className="text-foreground/70 flex-shrink-0" />;

/** Get the icon for a tab based on its type */
const getTabIcon = (tab: ChatTab, agents: AgentOption[]) => {
  if (tab.type === 'management') return <ManagementTabIcon />;
  if (tab.type === 'design') return <DesignTabIcon />;
  if (tab.type === 'history') return <HistoryTabIcon />;
  if (tab.type === 'mcp') return <McpTabIcon />;
  if (tab.type === 'system-instructions') return <SystemInstructionsTabIcon />;
  return getAgentIcon(tab.agentId, agents);
};

export default function TabBar({
  tabs,
  activeTabId,
  tabUi = {},
  onSelectTab,
  onCloseTab,
  onCloseAllTabs,
  onNewTab,
  onNewTabWithAgent,
  agents,
  onOpenHistory,
  onOpenManagement,
  onOpenDesignSystem,
  onOpenMcp,
  onOpenSystemInstructions
}: TabBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hamburgerMenuOpen, setHamburgerMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const hamburgerRef = useRef<HTMLDivElement>(null);
  const runnableAgents = agents.filter(isAgentRunnable);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
      if (hamburgerRef.current && !hamburgerRef.current.contains(event.target as Node)) {
        setHamburgerMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, []);

  return (
    <div className="relative z-30 flex h-[40px] bg-background border-t border-b border-border select-none shadow-[0_4px_15px_rgba(0,0,0,0.15)]">
      {/* Tabs List */}
      <div className="flex-1 flex overflow-x-auto no-scrollbar scroll-smooth">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const flags = tabUi[tab.id];
          const hasWarning = !!flags?.warning;
          const hasUnread = !!flags?.unread;
          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`
                group relative flex items-center min-w-[120px] max-w-[200px]
                h-full px-3 gap-2 cursor-default transition-colors
                ${isActive ? 'bg-background-secondary text-foreground font-medium after:content-[""] ' +
                  'after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[3px] after:bg-primary' :
                  'text-foreground/60 hover:text-foreground/90'}
              `}
            >
              <div className="cursor-pointer flex items-center justify-center pt-0.5">
                {getTabIcon(tab, agents)}
              </div>
              <div className="flex-1 truncate leading-none min-w-0">
                {tab.title}
              </div>
              {hasWarning ? (
                <span className="w-2 h-2 rounded-full bg-warning flex-shrink-0" />
              ) : hasUnread ? (
                <span className="w-2 h-2 rounded-full bg-sky-500 flex-shrink-0" />
              ) : null}

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                className={`
                  p-0.5 rounded-sm opacity-0 group-hover:opacity-100 hover:bg-background hover:text-foreground transition-all cursor-pointer
                  ${isActive ? 'opacity-100' : ''}
                `}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>

            </div>
          );
        })}
      </div>

      {/* Controls: +, More (chevron), Hamburger */}
      <div className="flex items-center bg-background pl-1 pr-2 gap-0.5 z-10 shadow-[-10px_0_10px_-5px_var(--background)]">
        {/* New Tab (+ matches default agent) */}
        <button
          onClick={onNewTab}
          className="flex items-center justify-center w-[28px] h-[24px] rounded text-foreground/60 hover:text-foreground hover:bg-background-secondary transition-colors"
          title="New chat"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>

        {/* More/Menu (Chevron dropdown) */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className={`flex items-center justify-center w-[24px] h-[24px] rounded text-foreground/60 hover:text-foreground hover:bg-background-secondary transition-colors ${menuOpen ? 'bg-background-secondary text-foreground' : ''}`}
            title="Open tabs and agents"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>

          {menuOpen && (
            <div className="absolute top-full right-0 mt-1 w-[280px] max-w-[320px] max-h-[80vh] overflow-y-auto bg-background-secondary border border-border rounded-md shadow-xl py-1 z-50 animate-in fade-in zoom-in-95 duration-100 no-scrollbar">

              {/* Open Tabs Section */}
              {tabs.length > 0 && (
                <div className="mb-1">
                  <div className="px-3 py-1.5 text-xs font-semibold text-foreground/50 uppercase tracking-wider">
                    Open Tabs
                  </div>
                  {tabs.map((tab) => {
                    const flags = tabUi[tab.id];
                    const hasWarning = !!flags?.warning;
                    const hasUnread = !!flags?.unread;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => {
                           onSelectTab(tab.id);
                           setMenuOpen(false);
                        }}
                        className={`flex items-center px-3 py-1.5 w-full text-left transition-colors group ${tab.id === activeTabId ? 'bg-accent/10 text-accent-foreground' : 'text-foreground/80 hover:bg-accent hover:text-accent-foreground'}`}
                      >
                        <span className="mr-2 flex items-center justify-center opacity-70 group-hover:opacity-100">
                          {getTabIcon(tab, agents)}
                        </span>
                        <span className="flex-1 truncate min-w-0">{tab.title}</span>
                        {hasWarning ? (
                          <span className="ml-2 w-2 h-2 rounded-full bg-warning flex-shrink-0" />
                        ) : hasUnread ? (
                          <span className="ml-2 w-2 h-2 rounded-full bg-sky-500 flex-shrink-0" />
                        ) : null}
                        {tab.id === activeTabId && (
                          <svg className="ml-2 w-3 h-3 text-accent-foreground flex-shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                        )}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => {
                      onCloseAllTabs();
                      setMenuOpen(false);
                    }}
                    className="flex items-center w-full px-3 py-1.5 text-left text-foreground/80 hover:bg-accent hover:text-accent-foreground transition-colors"
                  >
                    Close all tabs
                  </button>
                  <div className="h-[1px] bg-border my-1 mx-2" />
                </div>
              )}

              {/* New Chat With Agent Section */}
              <div>
                <div className="px-3 py-1.5 text-xs font-semibold text-foreground/50 uppercase tracking-wider">
                  New Chat
                </div>
                {runnableAgents.length > 0 ? (
                  runnableAgents.map((agent) => (
                    <div
                      key={agent.id}
                      className="flex items-center gap-1 px-1.5 py-0.5"
                    >
                      <button
                        onClick={() => {
                           onNewTabWithAgent(agent.id);
                           setMenuOpen(false);
                        }}
                        className="flex items-center flex-1 min-w-0 px-1.5 py-1 text-left text-foreground/80 hover:bg-accent hover:text-accent-foreground transition-colors group rounded"
                      >
                        <span className="mr-2 flex items-center justify-center opacity-70 group-hover:opacity-100">
                          {getAgentIcon(agent.id, agents)}
                        </span>
                        <span className="flex-1 min-w-0 truncate">{agent.name}</span>
                      </button>
                      {agent.cliAvailable && (
                        <button
                          onClick={() => {
                            ACPBridge.openAgentCli(agent.id);
                            setMenuOpen(false);
                          }}
                          className="flex items-center justify-center w-7 h-7 rounded text-foreground/55 hover:text-foreground hover:bg-accent transition-colors"
                          title={`Open ${agent.name} in IDE terminal`}
                          aria-label={`Open ${agent.name} in IDE terminal`}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="4 17 10 11 4 5"></polyline>
                            <line x1="12" y1="19" x2="20" y2="19"></line>
                          </svg>
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="px-3 py-2 text-xs text-foreground/50 italic text-center">No available agents</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Separator */}
        <div className="w-[1px] h-4 border-l border-border mx-1" />

        {/* History Button */}
        <button
          onClick={onOpenHistory}
          className="flex items-center justify-center w-[28px] h-[24px] rounded text-foreground/60 hover:text-foreground hover:bg-background-secondary transition-colors"
          title="History"
        >
          <History size={14} />
        </button>

        {/* Hamburger Menu */}
        <div className="relative" ref={hamburgerRef}>
          <button
            onClick={() => setHamburgerMenuOpen(!hamburgerMenuOpen)}
            className={`flex items-center justify-center w-[28px] h-[24px] rounded transition-colors ${hamburgerMenuOpen ? 'bg-background-secondary text-foreground' : 'text-foreground/60 hover:text-foreground hover:bg-background-secondary'}`}
            title="More options"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>

          {hamburgerMenuOpen && (
            <div className="absolute top-full right-0 mt-1 w-[200px] bg-background-secondary border border-border rounded-md shadow-xl py-1 z-50 animate-in fade-in zoom-in-95 duration-100">
              <button
                onClick={() => {
                  onOpenManagement();
                  setHamburgerMenuOpen(false);
                }}
                className="flex items-center w-full px-3 py-2 text-left text-foreground/80 hover:bg-accent hover:text-accent-foreground transition-colors group"
              >
                <span className="mr-2 flex items-center justify-center opacity-70 group-hover:opacity-100">
                  <ManagementTabIcon />
                </span>
                <span>Service Providers</span>
              </button>
              <button
                onClick={() => {
                  onOpenSystemInstructions();
                  setHamburgerMenuOpen(false);
                }}
                className="flex items-center w-full px-3 py-2 text-left text-foreground/80 hover:bg-accent hover:text-accent-foreground transition-colors group"
              >
                <span className="mr-2 flex items-center justify-center opacity-70 group-hover:opacity-100">
                  <SystemInstructionsTabIcon />
                </span>
                <span>System Instructions</span>
              </button>
              <button
                onClick={() => {
                  onOpenDesignSystem();
                  setHamburgerMenuOpen(false);
                }}
                className="flex items-center w-full px-3 py-2 text-left text-foreground/80 hover:bg-accent hover:text-accent-foreground transition-colors group"
              >
                <span className="mr-2 flex items-center justify-center opacity-70 group-hover:opacity-100">
                  <DesignTabIcon />
                </span>
                <span>Design System</span>
              </button>
              <button
                onClick={() => {
                  onOpenMcp();
                  setHamburgerMenuOpen(false);
                }}
                className="flex items-center w-full px-3 py-2 text-left text-foreground/80 hover:bg-accent hover:text-accent-foreground transition-colors group"
              >
                <span className="mr-2 flex items-center justify-center opacity-70 group-hover:opacity-100">
                  <McpTabIcon />
                </span>
                <span>MCP Servers</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
