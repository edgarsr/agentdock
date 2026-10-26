import { ReactNode, RefObject } from 'react';
import { History, Settings } from 'lucide-react';
import { AgentOption } from '../../types/chat';
import { moveMenuFocus } from './menuFocus';
import { AgentRow } from './NewChatSplitButton';
import { OpenChatList, OpenChatListProps } from './OpenChatList';
import { menuRowClassName, rowButtonClassName } from './rows';

interface NavigationMenuProps extends OpenChatListProps {
  menuListRef: RefObject<HTMLDivElement>;
  menuButtonRef: RefObject<HTMLButtonElement>;
  runnableAgents: AgentOption[];
  onNewTabWithAgent: (agentId: string) => void;
  onCloseMenu: () => void;
  onOpenHistory: () => void;
  onOpenLastSettings: () => void;
}

export function NavigationMenu({
  menuListRef,
  menuButtonRef,
  runnableAgents,
  onNewTabWithAgent,
  onCloseMenu,
  onOpenHistory,
  onOpenLastSettings,
  ...props
}: NavigationMenuProps) {
  const { agents } = props;

  return (
    <div
      ref={menuListRef}
      className="absolute top-full right-0 mt-1 min-w-[170px] max-w-[250px] max-h-[calc(100vh-4rem)] overflow-y-auto
        whitespace-nowrap bg-background-secondary border border-border rounded-[8px] py-1.5 z-50 text-ide-small"
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
      <SectionRow label="Chat History" icon={<History size={14} aria-hidden="true" />}
        onClick={() => { onOpenHistory(); onCloseMenu(); }} />
      {runnableAgents.length > 0 ? (
        <>
          <div className="flex min-h-7 items-center px-3.5 text-ide-small text-[var(--ide-Label-disabledForeground)]">New Chat</div>
          {runnableAgents.map((agent) => (
            <AgentRow key={agent.id} agent={agent} agents={agents} onNewTabWithAgent={onNewTabWithAgent} onAction={onCloseMenu} />
          ))}
        </>
      ) : null}
      <OpenChatList {...props} onAction={onCloseMenu} />
      <div className="h-px bg-border my-1 mx-2" />
      <SectionRow label="Settings" icon={<Settings size={14} aria-hidden="true" />}
        onClick={() => { onOpenLastSettings(); onCloseMenu(); }} />
    </div>
  );
}

function SectionRow({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <div className={menuRowClassName(false)}>
      <button type="button" role="menuitem" onClick={onClick} className={rowButtonClassName}>
        <span className="flex shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </button>
    </div>
  );
}
