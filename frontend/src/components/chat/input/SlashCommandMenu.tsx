import type * as React from 'react';
import { SlashCommandItem, SlashMenuLayout } from './slashCommands';
import PopupMenu from './PopupMenu';

interface SlashCommandMenuProps {
  commands: SlashCommandItem[];
  highlightedIndex: number;
  layout: SlashMenuLayout;
  menuRef: React.RefObject<HTMLDivElement>;
  onHover: (index: number) => void;
  onSelect: (command: SlashCommandItem) => void;
}

export default function SlashCommandMenu({
  commands,
  highlightedIndex,
  layout,
  menuRef,
  onHover,
  onSelect,
}: SlashCommandMenuProps) {
  const items = commands.map(cmd => ({
    primary: `${cmd.displayPrefix}${cmd.name}`,
    secondary: cmd.description,
  }));

  return (
    <PopupMenu
      items={items}
      highlightedIndex={highlightedIndex}
      layout={layout}
      menuRef={menuRef}
      onHover={onHover}
      onSelect={(index) => onSelect(commands[index])}
    />
  );
}
