import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  LexicalEditor,
} from 'lexical';
import { AvailableCommand } from '../../../types/chat';
import { PromptLibraryItem } from '../../../types/promptLibrary';

export interface SlashCommandItem {
  id: string;
  name: string;
  description: string;
  insertText: string;
  displayPrefix: string;
}

export function buildAgentSlashItems(commands: AvailableCommand[]): SlashCommandItem[] {
  return commands.map((command) => ({
    id: `agent-${command.name}`,
    name: command.name,
    description: command.description,
    insertText: `/${command.name} `,
    displayPrefix: '/',
  }));
}

export function buildPromptLibrarySlashItems(prompts: PromptLibraryItem[]): SlashCommandItem[] {
  return prompts
    .filter((prompt) => prompt.name.trim() && prompt.prompt.trim())
    .map((prompt) => ({
      id: prompt.id,
      name: prompt.name.trim(),
      description: prompt.prompt.trim(),
      insertText: prompt.prompt,
      displayPrefix: '',
    }));
}

export interface SlashMenuLayout {
  left: number;
  width: number;
  maxHeight: number;
}

export function extractSlashQuery(inputValue: string): string | null {
  const match = inputValue.match(/^\/([^\s]*)$/);
  return match ? match[1].toLowerCase() : null;
}

export function hasMatchingSlashCommand(commands: SlashCommandItem[], slashQuery: string | null): boolean {
  if (slashQuery === null) return false;
  if (slashQuery.length === 0) return commands.length > 0;
  return commands.some((command) => command.name.toLowerCase().startsWith(slashQuery));
}

export function findHighlightedSlashCommandIndex(commands: SlashCommandItem[], slashQuery: string | null): number {
  if (commands.length === 0) return 0;
  if (slashQuery === null || slashQuery.length === 0) return 0;
  const normalizedQuery = slashQuery.toLowerCase();
  const matchingIndex = commands.findIndex((command) => command.name.toLowerCase().startsWith(normalizedQuery));
  return matchingIndex >= 0 ? matchingIndex : 0;
}

export function calculateSlashMenuLayout(
  rootElement: HTMLDivElement,
  commandCount: number,
  viewportTopInset: number
): SlashMenuLayout {
  const rootRect = rootElement.getBoundingClientRect();
  const contentElement = rootElement.firstElementChild instanceof HTMLElement
    ? rootElement.firstElementChild
    : rootElement;
  const contentRect = contentElement.getBoundingClientRect();
  const left = Math.max(0, Math.floor(contentRect.left - rootRect.left));
  const width = Math.max(320, Math.floor(contentRect.width));
  const rowHeight = 34;
  const naturalHeight = Math.max(48, commandCount * rowHeight + 8);
  const gap = 8;
  const availableAbove = Math.max(120, Math.floor(rootRect.top - gap - viewportTopInset));
  const availableBelow = Math.max(120, Math.floor(window.innerHeight - rootRect.bottom - gap - 12));
  const preferAbove = availableAbove >= naturalHeight || availableAbove >= availableBelow;

  return {
    left,
    width,
    maxHeight: preferAbove ? availableAbove : availableBelow,
  };
}

export function computeViewportTopInset(rootElement: HTMLDivElement): number {
  const rootRect = rootElement.getBoundingClientRect();
  const elementsAtTop = document.elementsFromPoint(
    Math.max(16, rootRect.left + 16),
    16
  );
  const bottomEdge = elementsAtTop.reduce((max, element) => {
    const rect = element.getBoundingClientRect();
    return rect.bottom > 0 ? Math.max(max, rect.bottom) : max;
  }, 12);
  return Math.max(12, Math.floor(bottomEdge + 8));
}

export function applySlashCommandToEditor(
  editor: LexicalEditor | null,
  command: SlashCommandItem,
  onInputChange: (value: string) => void
): string {
  const nextValue = command.insertText;
  onInputChange(nextValue);

  if (editor) {
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode(nextValue));
      root.append(paragraph);
      paragraph.selectEnd();
    });
    editor.focus();
  }

  return nextValue;
}
