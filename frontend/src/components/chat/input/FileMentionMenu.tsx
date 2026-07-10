import { FileMentionItem } from '../../../hooks/useFileMentions';
import { SlashMenuLayout } from './slashCommands';
import PopupMenu from './PopupMenu';

interface FileMentionMenuProps {
  files: FileMentionItem[];
  highlightedIndex: number;
  layout: SlashMenuLayout;
  menuRef: React.RefObject<HTMLDivElement>;
  onHover: (index: number) => void;
  onSelect: (file: FileMentionItem) => void;
}

export default function FileMentionMenu({
  files,
  highlightedIndex,
  layout,
  menuRef,
  onHover,
  onSelect,
}: FileMentionMenuProps) {
  const items = files.map(file => ({
    primary: file.name,
    secondary: file.path,
    fileName: file.name,
    filePath: file.path,
    icon: file.icon
  }));

  return (
    <PopupMenu
      items={items}
      highlightedIndex={highlightedIndex}
      layout={layout}
      menuRef={menuRef}
      onHover={onHover}
      onSelect={(index) => onSelect(files[index])}
    />
  );
}
