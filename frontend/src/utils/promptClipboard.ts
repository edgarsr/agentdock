import type { Message, RichContentBlock } from '../types/chat';
import { plainTextFromBlocks } from '../hooks/chatSession/messageBasics';

const PREFIX = 'agentdock-prompt:v1:';
export const PROMPT_MIME = 'application/x-agentdock-prompt';

export function copyablePrompt(message: Message): string {
  const blocks = message.blocks?.length ? message.blocks : [{ type: 'text', text: message.content }];
  return PREFIX + JSON.stringify(blocks);
}

export function copyPrompt(message: Message): boolean {
  const selection = window.getSelection();
  const previousRanges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const marker = document.createElement('span');
  marker.className = 'fixed -left-[9999px]';
  marker.textContent = '#';
  document.body.append(marker);
  const range = document.createRange();
  range.selectNodeContents(marker);
  selection?.removeAllRanges();
  selection?.addRange(range);

  let copied = false;
  const onCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData('text/plain', message.blocks?.length
      ? plainTextFromBlocks(message.blocks, '[image]')
      : message.content);
    event.clipboardData.setData(PROMPT_MIME, copyablePrompt(message));
    event.preventDefault();
    copied = true;
  };

  document.addEventListener('copy', onCopy, true);
  try {
    return document.execCommand('copy') && copied;
  } finally {
    document.removeEventListener('copy', onCopy, true);
    marker.remove();
    selection?.removeAllRanges();
    previousRanges.forEach((previousRange) => selection?.addRange(previousRange));
  }
}

export function pastedPrompt(text: string): RichContentBlock[] | null {
  if (!text.startsWith(PREFIX)) return null;
  try {
    const blocks: unknown = JSON.parse(text.slice(PREFIX.length));
    if (!Array.isArray(blocks) || !blocks.every(isPromptBlock)) return null;
    return blocks as RichContentBlock[];
  } catch {
    return null;
  }
}

function isPromptBlock(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const block = value as Record<string, unknown>;
  switch (block.type) {
    case 'text':
      return typeof block.text === 'string';
    case 'image':
    case 'audio':
      return typeof block.data === 'string' && typeof block.mimeType === 'string';
    case 'video':
      return typeof block.mimeType === 'string'
        && (block.data === undefined || typeof block.data === 'string')
        && (block.path === undefined || typeof block.path === 'string')
        && (block.name === undefined || typeof block.name === 'string');
    case 'file':
      return typeof block.name === 'string' && typeof block.mimeType === 'string'
        && (block.data === undefined || typeof block.data === 'string')
        && (block.path === undefined || typeof block.path === 'string');
    case 'quote':
      return typeof block.quote === 'string';
    case 'code_ref':
      return typeof block.path === 'string' && typeof block.name === 'string'
        && (block.startLine === undefined || typeof block.startLine === 'number')
        && (block.endLine === undefined || typeof block.endLine === 'number');
    default:
      return false;
  }
}
