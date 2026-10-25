import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  LexicalEditor,
} from 'lexical';
import type { ChatAttachment } from '../../../types/chat';
import { $createImageNode } from './ImageNode';
import { $createReferenceNode, type ReferenceKind } from './ReferenceNode';

export function restoreComposerContent(
  editor: LexicalEditor,
  inputValue: string,
  attachments: ChatAttachment[],
  onUpdate?: () => void
) {
  const attachmentsById = new Map(attachments.map((attachment) => [attachment.id, attachment]));

  editor.update(() => {
    const root = $getRoot();
    const paragraph = $createParagraphNode();
    const placeholderRegex = /\[(image|code-ref|quote)-([a-z0-9-]+)]/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    const appendText = (value: string) => {
      value.split('\n').forEach((part, index) => {
        if (index > 0) paragraph.append($createLineBreakNode());
        if (part) paragraph.append($createTextNode(part));
      });
    };

    while ((match = placeholderRegex.exec(inputValue)) !== null) {
      appendText(inputValue.slice(lastIndex, match.index));
      const attachment = attachmentsById.get(match[2]);

      if (match[1] === 'image' && attachment?.mimeType.startsWith('image/')) {
        paragraph.append($createImageNode(attachment.id));
      } else if (match[1] !== 'image' && attachment) {
        paragraph.append($createReferenceNode(attachment.id, match[1] as ReferenceKind));
      } else {
        appendText(match[0]);
      }

      lastIndex = placeholderRegex.lastIndex;
    }

    appendText(inputValue.slice(lastIndex));
    root.clear();
    root.append(paragraph);
    paragraph.selectEnd();
  }, { onUpdate });
}
