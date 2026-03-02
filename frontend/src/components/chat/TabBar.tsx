import { useState, useRef, useEffect } from 'react';
import { AgentOption, ChatTab } from '../../types/chat';

interface TabBarProps {
  tabs: ChatTab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onNewTabWithAgent: (agentId: string) => void;
  agents: AgentOption[];
  showHistory: boolean;
  onToggleHistory: () => void;
}

export default function TabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onNewTabWithAgent,
  agents,
  showHistory,
  onToggleHistory
}: TabBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, []);

  return (
    <div className="flex h-[32px] bg-background border-b border-border select-none">
      {/* Tabs List */}
      <div className="flex-1 flex overflow-x-auto no-scrollbar scroll-smooth">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`
                group relative flex items-center min-w-[120px] max-w-[200px] h-full px-3 gap-2 cursor-default transition-colors
                ${isActive ? 'bg-background-secondary text-foreground font-medium' : 'text-foreground/60  hover:text-foreground/90'}
              `}
            >
              <div className="flex-1 truncate leading-none">
                {tab.title}
              </div>
              
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                className={`
                  p-0.5 rounded-sm opacity-0 group-hover:opacity-100 hover:bg-background hover:text-foreground transition-all
                  ${isActive ? 'opacity-100' : ''}
                `}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>

              {/* Separator (only if not active and next isn't active) - tricky with React map, simplify for now */}
              {!isActive && (
                <div className="absolute right-0 top-1.5 bottom-1.5 w-[1px] border-l border-border opacity-50 group-hover:opacity-0 pointer-events-none" />
              )}
            </div>
          );
        })}
      </div>

      {/* Controls: +, More, History */}
      <div className="flex items-center bg-background pl-1 pr-2 gap-0.5 z-10 shadow-[-10px_0_10px_-5px_var(--background)]">
        {/* New Tab (+ matches default agent) */}
        <button
          onClick={onNewTab}
          className="flex items-center justify-center w-[28px] h-[24px] rounded  text-foreground/60 hover:text-foreground transition-colors"
          title="New Chat Tab"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>

        {/* More/Menu (Chevron) */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className={`flex items-center justify-center w-[24px] h-[24px] rounded  text-foreground/60 hover:text-foreground transition-colors ${menuOpen ? 'bg-background-secondary text-foreground' : ''}`}
            title="Open a new tab with a specific profile"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>

          {menuOpen && (
            <div className="absolute top-full right-0 mt-1 min-w-[200px] bg-background-secondary border border-border rounded-md shadow-xl py-1 z-50 animate-in fade-in zoom-in-95 duration-100">
               {agents.length > 0 ? (
                 agents.map((agent) => (
                   <button
                     key={agent.id}
                     onClick={() => {
                        onNewTabWithAgent(agent.id);
                        setMenuOpen(false);
                     }}
                     className="flex items-center w-full px-3 py-1.5 text-left text-foreground/80 hover:bg-accent hover:text-accent-foreground transition-colors group"
                   >
                     {/* Placeholder icon */}
                     <span className="w-5 h-5 mr-2 flex items-center justify-center opacity-60 group-hover:opacity-100">
                       <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                         <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                         <circle cx="12" cy="7" r="4"></circle>
                       </svg>
                     </span>
                     {agent.displayName}
                   </button>
                 ))
               ) : (
                 <div className="px-3 py-2 text-xs text-foreground/50 italic text-center">No agents found</div>
               )}
            </div>
          )}
        </div>

        {/* Separator */}
        <div className="w-[1px] h-4 border-l border-border mx-1" />

         {/* History */}
         <button
            onClick={onToggleHistory}
            className={`flex items-center justify-center w-[28px] h-[24px] rounded transition-colors
              ${showHistory 
                ? 'bg-background-secondary text-foreground' 
                : 'text-foreground/60  hover:text-foreground'
              }
            `}
            title="Chat History"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </button>
      </div>
    </div>
  );
}
