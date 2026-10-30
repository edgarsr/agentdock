import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  ElementNode,
  LexicalEditor,
  LexicalNode,
} from 'lexical';
import { $createListItemNode, $createListNode, $isListItemNode, $isListNode, ListItemNode, ListNode } from '@lexical/list';
import type { ChatAttachment } from '../../../types/chat';
import {
  escapeListStarts,
  formatMarkdownList,
  isEmptyListItem,
  isListStart,
  parseMarkdownLists,
  type MarkdownList,
} from '../shared/markdownLists';
import { $createImageNode } from './ImageNode';
import { $createReferenceNode, type ReferenceKind } from './ReferenceNode';

// Marks the selection while the composer is rebuilt from its text.
const CARET = '';

/** The composer content as prompt text: lists in Markdown and inline attachments as placeholders. */
export function $composerText(): string {
  return $blocksText($getRoot().getChildren());
}

function $blocksText(blocks: LexicalNode[]): string {
  return blocks.map((block, index) => {
    const text = $isListNode(block) ? formatMarkdownList($markdownList(block)) : escapeListStarts(block.getTextContent());
    // A blank line ends a list, so that the following text does not continue its last item.
    return index > 0 && $isListNode(blocks[index - 1]) ? `\n${text}` : text;
  }).join('\n');
}

export function restoreComposerContent(
  editor: LexicalEditor,
  inputValue: string,
  attachments: ChatAttachment[],
  onUpdate?: () => void
) {
  editor.update(() => {
    const root = $getRoot();
    root.clear();
    root.append(...$blockNodes(inputValue, attachmentsMap(attachments)));
    root.selectEnd();
  }, { onUpdate });
}

/** Inserts prompt text at the selection. Lists in the text become lists. */
export function $insertComposerText(text: string, attachments: ChatAttachment[]) {
  if (!$isRangeSelection($getSelection())) $getRoot().selectEnd();
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;
  const attachmentsById = attachmentsMap(attachments);
  // Text without lists goes in as it is, which leaves the rest of the composer as it was.
  const [first, ...rest] = parseMarkdownLists(text);
  if (first.type === 'text' && rest.length === 0) {
    selection.insertNodes($appendInline($createParagraphNode(), first.text, attachmentsById).getChildren());
    return;
  }

  selection.insertText(CARET);
  const content = $composerText();
  const caret = content.indexOf(CARET);
  let before = content.slice(0, caret);
  const lineStart = before.lastIndexOf('\n') + 1;
  const line = before.slice(lineStart);
  // A list starts on a line of its own at the level of the line it goes into, and replaces an empty item.
  if (line.trim() && isListStart(text.split('\n', 1)[0])) {
    const indent = /^ */.exec(line)![0];
    before = isEmptyListItem(line) ? before.slice(0, lineStart) : `${before}\n`;
    text = text.replace(/^/gm, indent);
  }
  $replaceBlocks($getRoot().getChildren(), `${before}${text}${CARET}${content.slice(caret + CARET.length)}`, attachmentsById);
}

/** Turns the lines of the selected paragraph that start lists into lists, when the user has typed a list marker. */
export function $applyTypedListMarker(attachments: ChatAttachment[]) {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;
  const paragraph = selection.anchor.getNode().getTopLevelElementOrThrow();
  if (!parseMarkdownLists(paragraph.getTextContent()).some((block) => block.type === 'list')) return;
  selection.insertText(CARET);
  // Only the typed marker starts a list; the other lines that would start one have stayed text.
  $replaceBlocks([paragraph], escapeListStarts(paragraph.getTextContent(), CARET), attachmentsMap(attachments));
}

// Replaces blocks with the blocks of a text that holds the caret, and puts the caret back.
function $replaceBlocks(blocks: LexicalNode[], text: string, attachmentsById: Map<string, ChatAttachment>) {
  const nodes = $blockNodes(text, attachmentsById);
  nodes.forEach((node) => blocks[0].insertBefore(node));
  blocks.forEach((block) => block.remove());

  for (const block of nodes) {
    const node = block.getAllTextNodes().find((candidate) => candidate.getTextContent().includes(CARET));
    if (!node) continue;
    const offset = node.getTextContent().indexOf(CARET);
    const rest = node.getTextContent().replace(CARET, '');
    if (rest) {
      node.setTextContent(rest).select(offset, offset);
    } else {
      const parent = node.getParentOrThrow();
      const index = node.getIndexWithinParent();
      node.remove();
      parent.select(index, index);
    }
    return;
  }
}

function attachmentsMap(attachments: ChatAttachment[]) {
  return new Map(attachments.map((attachment) => [attachment.id, attachment]));
}

function $blockNodes(text: string, attachmentsById: Map<string, ChatAttachment>): ElementNode[] {
  return parseMarkdownLists(text).map((block) => block.type === 'list'
    ? $listNode(block.list, attachmentsById)
    : $appendInline($createParagraphNode(), block.text, attachmentsById));
}

function $markdownList(node: ListNode): MarkdownList {
  const list: MarkdownList = { ordered: node.getListType() === 'number', items: [] };
  for (const item of node.getChildren()) {
    if (!$isListItemNode(item)) continue;
    const children = item.getChildren();
    const lists = children.filter($isListNode).map($markdownList);
    const text = children.filter((child) => !$isListNode(child)).map((child) => child.getTextContent()).join('');
    const previous = list.items[list.items.length - 1];
    // Lexical holds the nested lists of an item in an item of their own after it.
    if (lists.length > 0 && !text && previous) {
      previous.lists.push(...lists);
    } else {
      list.items.push({ text, lists });
    }
  }
  return list;
}

function $listNode(list: MarkdownList, attachmentsById: Map<string, ChatAttachment>): ListNode {
  const node = $createListNode(list.ordered ? 'number' : 'bullet');
  for (const item of list.items) {
    node.append($appendInline($createListItemNode(), item.text, attachmentsById));
    for (const nested of item.lists) node.append($createListItemNode().append($listNode(nested, attachmentsById)));
  }
  return node;
}

function $appendInline<T extends ElementNode>(element: T, text: string, attachmentsById: Map<string, ChatAttachment>): T {
  const placeholderRegex = /\[(image|code-ref|quote)-([a-z0-9-]+)]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const appendText = (value: string) => {
    value.split('\n').forEach((part, index) => {
      if (index > 0) element.append($createLineBreakNode());
      if (part) element.append($createTextNode(part));
    });
  };

  while ((match = placeholderRegex.exec(text)) !== null) {
    appendText(text.slice(lastIndex, match.index));
    const attachment = attachmentsById.get(match[2]);

    if (match[1] === 'image' && attachment?.mimeType.startsWith('image/')) {
      element.append($createImageNode(attachment.id));
    } else if (match[1] !== 'image' && attachment) {
      element.append($createReferenceNode(attachment.id, match[1] as ReferenceKind));
    } else {
      appendText(match[0]);
    }

    lastIndex = placeholderRegex.lastIndex;
  }

  appendText(text.slice(lastIndex));
  return element;
}

/** The list item that holds the selection. */
export function $selectedListItem(): ListItemNode | null {
  const selection = $getSelection();
  for (let node = $isRangeSelection(selection) ? selection.anchor.getNode() : null; node; node = node.getParent()) {
    if ($isListItemNode(node)) return node;
  }
  return null;
}
