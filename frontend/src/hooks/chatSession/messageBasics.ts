import { Message } from '../../types/chat';
import { buildConversationHandoffPromptPrefix } from '../../utils/conversationHandoff';

let messageCounter = 0;

export function nextMessageId(suffix: string): string {
  return `msg-${++messageCounter}-${Date.now()}-${suffix}`;
}

function codeReferenceText(path: string, startLine?: number, endLine?: number): string {
  if (!startLine || !endLine) return `@${path}`;
  return startLine === endLine
    ? `@${path}#L${startLine}`
    : `@${path}#L${startLine}-${endLine}`;
}

export function plainTextFromBlocks(blocks: any[]): string {
  return blocks.map((block) => {
    if (block.type === 'text') return block.text || '';
    if (block.type === 'code_ref') return codeReferenceText(block.path, block.startLine, block.endLine);
    return '';
  }).join('');
}

export function titleFromFirstPrompt(messages: Message[]): string | undefined {
  const firstUserMessage = messages.find((message) => message.role === 'user');
  const raw = firstUserMessage?.content?.replace(/\s+/g, ' ').trim() || '';
  if (!raw) return undefined;
  if (raw.length <= 64) return raw;
  return `${raw.slice(0, 64)}...`;
}

export function normalizeOutgoingBlocks(blocks: any[]): any[] {
  return blocks.filter((block) => {
    if (!block) return false;
    if (block.type === 'text') {
      return typeof block.text === 'string' && block.text.length > 0;
    }
    if (block.type === 'code_ref') {
      return typeof block.path === 'string' && block.path.length > 0;
    }
    return true;
  }).map((block) => {
    if (block.type === 'code_ref') {
      return {
        ...block,
        text: codeReferenceText(block.path, block.startLine, block.endLine),
      };
    }
    return block;
  });
}

export function prependHandoffContext(
  blocks: any[],
  handoffText: string,
  sourceConversationTitle?: string,
): any[] {
  const prefix = buildConversationHandoffPromptPrefix(handoffText, sourceConversationTitle);
  if (!prefix) return blocks;
  return [
    { type: 'text', text: `${prefix}\n\n` },
    ...blocks,
  ];
}
