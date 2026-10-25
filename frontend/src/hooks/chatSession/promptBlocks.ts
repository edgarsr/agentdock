import { ChatAttachment } from '../../types/chat';

export function buildPromptBlocks(inputValue: string, attachments: ChatAttachment[]): any[] {
  const blocks: any[] = [];
  let currentText = inputValue;

  const usedAttachmentIds = new Set<string>();
  const placeholderRegex = /\[(image|code-ref|quote)-([a-z0-9-]+)\]/g;
  let lastIndex = 0;
  let match;

  while ((match = placeholderRegex.exec(currentText)) !== null) {
    const beforeText = currentText.substring(lastIndex, match.index);
    if (beforeText) blocks.push({ type: 'text', text: beforeText });

    const attType = match[1];
    const attId = match[2];
    const att = attachments.find(a => a.id === attId);
    if (att) {
      if (attType === 'image') {
        blocks.push({ type: 'image', data: att.data, mimeType: att.mimeType, isInline: true });
      } else if (att.attachmentType === 'code_ref' && att.path) {
        blocks.push({
          type: 'code_ref',
          id: att.id,
          name: att.name,
          path: att.path,
          startLine: att.startLine,
          endLine: att.endLine,
          isInline: true,
        });
      } else if (att.attachmentType === 'quote' && att.quote) {
        blocks.push({ type: 'quote', quote: att.quote });
      } else {
        blocks.push({ type: 'text', text: match[0] });
      }
      usedAttachmentIds.add(attId);
    } else {
      blocks.push({ type: 'text', text: match[0] });
    }
    lastIndex = placeholderRegex.lastIndex;
  }

  const remainingText = currentText.substring(lastIndex);
  if (remainingText) blocks.push({ type: 'text', text: remainingText });

  attachments.forEach(att => {
    if (!usedAttachmentIds.has(att.id) && att.attachmentType !== 'code_ref' && att.attachmentType !== 'quote') {
      if (att.mimeType.startsWith('image/') && att.data) {
        blocks.push({ type: 'image', data: att.data, mimeType: att.mimeType, isInline: false });
      } else if (att.mimeType.startsWith('video/') && att.data) {
        blocks.push({
          type: 'video',
          name: att.name,
          data: att.data,
          path: att.path,
          mimeType: att.mimeType,
          isInline: false
        });
      } else if (att.mimeType.startsWith('audio/') && att.data) {
        blocks.push({ type: 'audio', data: att.data, mimeType: att.mimeType, isInline: false });
      } else {
        blocks.push({
          type: 'file',
          name: att.name,
          mimeType: att.mimeType,
          data: att.data,
          path: att.path,
          isInline: false
        });
      }
    }
  });

  return blocks;
}
