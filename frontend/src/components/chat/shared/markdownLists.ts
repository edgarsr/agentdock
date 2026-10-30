/** Markdown lists in prompt text, which the composer edits as lists and user messages show as lists. */

export interface MarkdownList {
  ordered: boolean;
  items: MarkdownListItem[];
}

export interface MarkdownListItem {
  // Lines after the first continue the item.
  text: string;
  lists: MarkdownList[];
}

export type MarkdownListBlock = { type: 'text'; text: string } | { type: 'list'; list: MarkdownList };

// Not `+`, so that added lines of a pasted diff stay as they are.
const LIST_LINE = /^( *)([-*]|(\d{1,9})[.)])(?: (.*))?$/;
// A numbered list starts at 1, so that a line such as `15. novembrī` or `2026. gadā` stays text.
const LIST_START = /^ *([-*]|1[.)])( |$)/;
const EMPTY_LIST_ITEM = /^ *([-*]|\d{1,9}[.)]) ?$/;
const CODE_FENCE = /^ *(```|~~~)/;
// The start of a line that would start a list, and the backslashes before its marker that keep it text.
const ESCAPED_LIST_START = /^([ \t]*)(\\*)(?=(?:[-*]|1[.)])(?: |$))/;
/** The text of a line when the user has just typed a list marker and its space at its start. */
export const TYPED_LIST_MARKER = /^ *([-*]|1[.)]) $/;

export function listClassName(ordered: boolean): string {
  return `${ordered ? 'list-decimal' : 'list-disc'} pl-[calc(var(--ide-list-indent)*2)] mb-ide-paragraph`;
}

/** Whether a line starts a list. */
export function isListStart(line: string): boolean {
  return LIST_START.test(line);
}

export function isEmptyListItem(line: string): boolean {
  return EMPTY_LIST_ITEM.test(line);
}

/**
 * Text whose lines that would start lists stay text, as a backslash before their markers tells; parseMarkdownLists
 * removes it. Code blocks and the line that holds [exceptIn] stay as they are.
 */
export function escapeListStarts(text: string, exceptIn?: string): string {
  let inCode = false;
  return text.split('\n').map((line) => {
    if (CODE_FENCE.test(line)) inCode = !inCode;
    return inCode || (exceptIn && line.includes(exceptIn)) ? line : line.replace(ESCAPED_LIST_START, '$1\\$2');
  }).join('\n');
}

/**
 * Splits text into lists and the text between them. A line indented by two or more spaces more than an item's
 * marker belongs to that item, as a nested item or a continuation line; Markdown written for people often indents
 * nested items less than the item's text. A list ends at a line that is neither an item nor indented under one;
 * a blank line that ends it separates it from the following text and belongs to neither. Code blocks hold no lists.
 * Any number continues a numbered list, but only 1 starts one.
 */
export function parseMarkdownLists(text: string): MarkdownListBlock[] {
  const blocks: MarkdownListBlock[] = [];
  let textLines: string[] = [];
  let open: Array<{ list: MarkdownList; indent: number; nested: number }> = [];
  let inCode = false;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/^[ \t]+/, (space) => space.replace(/\t/g, '    '));
    const marker = inCode ? null : LIST_LINE.exec(line);
    if (CODE_FENCE.test(line)) inCode = !inCode;
    if (marker) {
      const indent = marker[1].length;
      const ordered = marker[3] !== undefined;
      let depth = open.length;
      while (depth > 0 && indent < open[depth - 1].indent) depth--;
      // An item of the other kind at the same level starts a new list.
      if (depth > 0 && indent < open[depth - 1].nested && open[depth - 1].list.ordered !== ordered) depth--;
      const top = open[depth - 1];
      const continues = top && indent < top.nested;
      if (continues || !ordered || Number(marker[3]) === 1) {
        open.length = depth;
        const item: MarkdownListItem = { text: marker[4] ?? '', lists: [] };
        const level = { indent, nested: indent + 2 };
        if (continues) {
          top.list.items.push(item);
          Object.assign(top, level);
          continue;
        }
        const list: MarkdownList = { ordered, items: [item] };
        if (top) {
          top.list.items[top.list.items.length - 1].lists.push(list);
        } else {
          if (textLines.length > 0) blocks.push({ type: 'text', text: textLines.join('\n') });
          textLines = [];
          blocks.push({ type: 'list', list });
        }
        open.push({ list, ...level });
        continue;
      }
    }

    if (open.length > 0 && line.trim()) {
      const indent = line.length - line.trimStart().length;
      while (open.length > 0 && indent < open[open.length - 1].nested) open.pop();
      const top = open[open.length - 1];
      if (top) {
        top.list.items[top.list.items.length - 1].text += `\n${line.slice(indent)}`;
        continue;
      }
    } else if (open.length > 0) {
      open = [];
      continue;
    }
    textLines.push(inCode ? rawLine : rawLine.replace(ESCAPED_LIST_START, (_, space: string, escapes: string) => space + escapes.slice(1)));
  }

  if (textLines.length > 0 || blocks.length === 0) blocks.push({ type: 'text', text: textLines.join('\n') });
  return blocks;
}

export function formatMarkdownList(list: MarkdownList, indent = ''): string {
  return list.items.map((item, index) => {
    const marker = list.ordered ? `${index + 1}.` : '-';
    const inner = indent + ' '.repeat(marker.length + 1);
    return [
      `${indent}${marker} ${item.text.replace(/\n/g, `\n${inner}`)}`,
      ...item.lists.map((nested) => formatMarkdownList(nested, inner)),
    ].join('\n');
  }).join('\n');
}

const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'BLOCKQUOTE', 'TR', 'TABLE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER']);
const SKIPPED_TAGS = new Set(['STYLE', 'SCRIPT', 'META', 'TITLE', 'TEMPLATE']);

/** Pasted HTML as text with Markdown lists, or null when it has no list, so its plain text is used as before. */
export function markdownFromHtmlLists(html: string): string | null {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  if (!body.querySelector('li')) return null;

  let text = '';
  let lineEmpty = true;
  let indentPending = false;
  const write = (value: string, indent: string) => {
    if (indentPending) text += indent;
    text += value;
    indentPending = false;
    lineEmpty = false;
  };
  const newline = () => {
    if (lineEmpty) return;
    text += '\n';
    lineEmpty = true;
    indentPending = true;
  };
  // Ends the line even if it is empty.
  const lineBreak = () => {
    lineEmpty = false;
    newline();
  };

  const walk = (node: Node, indent: string, preformatted: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent ?? '';
      if (preformatted) {
        value.split('\n').forEach((part, index) => {
          if (index > 0) lineBreak();
          if (part) write(part, indent);
        });
        return;
      }
      const collapsed = value.replace(/\s+/g, ' ');
      const visible = lineEmpty ? collapsed.trimStart() : collapsed;
      if (visible) write(visible, indent);
      return;
    }
    if (!(node instanceof HTMLElement) || SKIPPED_TAGS.has(node.tagName)) return;

    const tag = node.tagName;
    if (tag === 'BR') {
      lineBreak();
      return;
    }
    if (tag === 'UL' || tag === 'OL') {
      // Only 1 starts a list, so a copied part of a numbered list is numbered from 1.
      let number = 1;
      for (const item of Array.from(node.children)) {
        if (item.tagName !== 'LI') continue;
        const marker = tag === 'OL' ? `${number}.` : '-';
        // The composer copies the nested lists of an item in an item of their own, without a marker.
        const nestedOnly = item.children.length > 0 && Array.from(item.childNodes).every((child) => child instanceof HTMLElement
          ? child.tagName === 'UL' || child.tagName === 'OL'
          : !child.textContent?.trim());
        if (!nestedOnly) {
          number++;
          newline();
          text += `${indent}${marker} `;
          indentPending = false;
          lineEmpty = true;
        }
        const itemStart = text.length;
        item.childNodes.forEach((child) => walk(child, indent + ' '.repeat(marker.length + 1), preformatted));
        // An empty item keeps its line.
        if (!nestedOnly && text.length === itemStart) lineEmpty = false;
      }
      newline();
      return;
    }
    // A code block stays one, so that its lines do not become list items.
    const fence = tag === 'PRE' && !preformatted ? '```' : '';
    const block = BLOCK_TAGS.has(tag);
    if (block) newline();
    if (fence) {
      write(fence, indent);
      newline();
    }
    node.childNodes.forEach((child) => walk(child, indent, preformatted || tag === 'PRE'));
    if (fence) {
      newline();
      write(fence, indent);
    }
    if (block) newline();
  };

  walk(body, '', false);
  return text.replace(/[ \t]+$/gm, '').replace(/^\n+|\n+$/g, '');
}
