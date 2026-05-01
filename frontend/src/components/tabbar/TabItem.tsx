import { X } from 'lucide-react';
import { AgentOption, ChatTab } from '../../types/chat';
import { getTabIcon } from './TabIcons';

interface TabItemProps {
  tab: ChatTab;
  agents: AgentOption[];
  isActive: boolean;
  isKeyboardFocused: boolean;
  hasWarning: boolean;
  hasUnread: boolean;
  hasProcessing: boolean;
  titleClassName: string;
  onSelectTab: (id: string) => void;
  onPointerDown: (id: string, event: React.PointerEvent<HTMLDivElement>) => void;
  shouldSuppressClick: (id: string) => boolean;
  onCloseTab: (id: string) => void;
  onFocusTab: (id: string) => void;
  onBlurTab: (id: string) => void;
  dropIndicator: 'before' | 'after' | null;
}

export function TabItem({
  tab,
  agents,
  isActive,
  isKeyboardFocused,
  hasWarning,
  hasUnread,
  hasProcessing,
  titleClassName,
  onSelectTab,
  onPointerDown,
  shouldSuppressClick,
  onCloseTab,
  onFocusTab,
  onBlurTab,
  dropIndicator
}: TabItemProps) {
  return (
    <div
      data-tab-id={tab.id}
      onPointerDown={(event) => onPointerDown(tab.id, event)}
      className={`text-foreground group relative pl-1 pr-2 flex h-full max-w-[180px] shrink items-center rounded-[4px] 
        bg-background cursor-grab active:cursor-grabbing
        ${isActive ? 'text-foreground before:absolute before:inset-0 before:bg-background before:[filter:var(--ide-surface-active-filter)] ' +
          'after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[3px] after:bg-[var(--ide-Button-default-focusColor)]' :
          ''}
      `}
    >
      {dropIndicator === 'before' ? (
        <span aria-hidden="true" className="pointer-events-none absolute bottom-1 left-0 top-1 z-30 w-px bg-primary" />
      ) : null}
      {dropIndicator === 'after' ? (
        <span aria-hidden="true" className="pointer-events-none absolute bottom-1 right-0 top-1 z-30 w-px bg-primary" />
      ) : null}
      {isKeyboardFocused ? (<span aria-hidden="true"
          className="pointer-events-none absolute inset-[1px] z-20 rounded-[3px] shadow-[inset_0_0_0_1px_var(--ide-Button-default-focusColor)]"
        />
      ) : null}
      <button
        type="button"
        role="tab"
        aria-selected={isActive}
        onClick={(event) => {
          if (shouldSuppressClick(tab.id)) {
            event.preventDefault();
            return;
          }
          onSelectTab(tab.id);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelectTab(tab.id);
          }
        }}
        onFocus={() => onFocusTab(tab.id)}
        onBlur={() => onBlurTab(tab.id)}
        className="w-full h-full px-1 pb-0.5 relative z-10 flex min-w-0 flex-1 items-center gap-2 overflow-hidden
          rounded-[4px] text-left cursor-default focus:outline-none"
      >
        <div className={`flex shrink-0 items-center relative left-[1px] ${hasProcessing ? 'animate-pulse' : 'opacity-80'}`}>
          {getTabIcon(tab, agents)}
        </div>
        <div className={`min-w-0 flex-1 overflow-hidden ${titleClassName}`}>
          <div className="truncate text-ide-small relative top-[1px]">{tab.title}</div>
        </div>
      </button>
      {hasWarning ? (
        <span className="relative z-10 ml-2 -mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-warning" />
      ) : hasUnread ? (
        <span className="relative z-10 ml-2 -mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-sky-500" />
      ) : null}

      <button
        data-close-tab="true"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onCloseTab(tab.id);
        }}
        className={`relative z-10 ml-2 mr-0.5 shrink-0 rounded-sm opacity-0 cursor-pointer -mt-0.5
          focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]
          ${isActive ? 'opacity-100' : 'group-hover:opacity-100 group-focus-within:opacity-100'}
        `}
      >
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  );
}
