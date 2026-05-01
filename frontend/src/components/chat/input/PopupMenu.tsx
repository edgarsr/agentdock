import { SlashMenuLayout } from './slashCommands';

export interface MenuItem {
  primary: string;
  secondary?: string;
}

interface PopupMenuProps {
  items: MenuItem[];
  highlightedIndex: number;
  layout: SlashMenuLayout;
  menuRef: React.RefObject<HTMLDivElement>;
  onHover: (index: number) => void;
  onSelect: (index: number) => void;
}

export default function PopupMenu({
  items,
  highlightedIndex,
  layout,
  menuRef,
  onHover,
  onSelect,
}: PopupMenuProps) {
  return (
    <div
      ref={menuRef}
      className="absolute inset-x-3 bottom-full z-[140] mb-2 overflow-hidden rounded-md border border-border bg-editor-bg"
      style={{
        width: `${layout.width}px`,
        maxHeight: `${layout.maxHeight}px`,
      }}
    >
      <div className="max-h-full overflow-y-auto py-1">
        {items.map((item, index) => {
          const isSelected = index === highlightedIndex;
          return (
            <button
              key={index}
              data-command-index={index}
              type="button"
              onMouseEnter={() => onHover(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(index);
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-ide-small transition-colors ${
                isSelected ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              <span className="w-40 shrink-0 truncate font-mono leading-5">
                {item.primary}
              </span>
              {item.secondary && (
                <span className={`min-w-0 flex-1 truncate leading-5 ${isSelected ? 'text-accent-foreground' : 'text-foreground'}`}>
                  {item.secondary}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
