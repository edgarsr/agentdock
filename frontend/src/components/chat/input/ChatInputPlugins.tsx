import { useEffect, useCallback, useRef } from 'react';
import type { RefObject } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $createLineBreakNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $nodesOfType,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_BACKSPACE_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  FORMAT_TEXT_COMMAND,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
  LexicalEditor,
  LexicalNode
} from 'lexical';
import { $createImageNode, ImageNode } from './ImageNode';
import { ReferenceNode, $createReferenceNode, $isReferenceNode, type ReferenceKind } from './ReferenceNode';
import { ChatAttachment, RichContentBlock } from '../../../types/chat';
import { pastedPrompt, PROMPT_MIME } from '../../../utils/promptClipboard';
import { restoreComposerContent } from './composerContent';

export function AttachmentsSyncPlugin({ attachments, onAttachmentsChange }: {
  attachments: ChatAttachment[],
  onAttachmentsChange: (items: ChatAttachment[]) => void
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const syncRemovedAttachments = () => {
      editor.read(() => {
        const existingIds = new Set([
          ...$nodesOfType(ImageNode).map((node) => node.__id),
          ...$nodesOfType(ReferenceNode).map((node) => node.__id),
        ]);
        const filtered = attachments.filter((attachment) => !attachment.isInline || existingIds.has(attachment.id));
        if (filtered.length !== attachments.length) {
          onAttachmentsChange(filtered);
        }
      });
    };

    const unregister = [ImageNode, ReferenceNode].map((nodeClass) =>
      editor.registerMutationListener(nodeClass, (mutations) => {
        for (const [, mutation] of mutations) {
          if (mutation === 'destroyed') {
            syncRemovedAttachments();
            break;
          }
        }
      })
    );

    return () => unregister.forEach((stop) => stop());
  }, [editor, attachments, onAttachmentsChange]);

  return null;
}

function insertPrompt(editor: LexicalEditor, blocks: RichContentBlock[], attachments: ChatAttachment[], onAttachmentsChange: (items: ChatAttachment[]) => void) {
  const nodes: Array<() => LexicalNode> = [];
  const added: ChatAttachment[] = [];

  for (const block of blocks) {
    if (block.type === 'text') {
      block.text.split('\n').forEach((part, index) => {
        if (index > 0) nodes.push(() => $createLineBreakNode());
        if (part) nodes.push(() => $createTextNode(part));
      });
    } else if (block.type === 'code_ref') {
      const id = crypto.randomUUID();
      added.push({ id, name: block.name, path: block.path, mimeType: 'application/x-code-reference', attachmentType: 'code_ref', isInline: true, startLine: block.startLine, endLine: block.endLine });
      nodes.push(() => $createReferenceNode(id, 'code-ref'));
    } else if (block.type === 'quote') {
      const id = crypto.randomUUID();
      added.push(quoteAttachment(id, block.quote));
      nodes.push(() => $createReferenceNode(id, 'quote'));
    } else if (block.type === 'image' || block.type === 'audio' || block.type === 'video' || block.type === 'file') {
      const id = crypto.randomUUID();
      const isInline = block.type === 'image' && block.isInline !== false;
      added.push({
        id,
        name: block.type === 'file' ? block.name : block.type === 'video' ? block.name || 'video' : block.type === 'image' ? 'Image' : 'audio',
        mimeType: block.mimeType,
        data: block.data,
        path: block.type === 'file' || block.type === 'video' ? block.path : undefined,
        isInline,
      });
      if (isInline) nodes.push(() => $createImageNode(id));
    }
  }

  if (added.length > 0) onAttachmentsChange([...attachments, ...added]);
  if (nodes.length > 0) {
    editor.update(() => {
      let selection = $getSelection();
      if (!$isRangeSelection(selection)) {
        $getRoot().selectEnd();
        selection = $getSelection();
      }
      if ($isRangeSelection(selection)) selection.insertNodes(nodes.map((create) => create()));
    });
  }
}

export function PasteLogPlugin({ attachments, onAttachmentsChange }: {
  attachments: ChatAttachment[];
  onAttachmentsChange: (items: ChatAttachment[]) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event: ClipboardEvent) => {
        const plainText = event.clipboardData?.getData('text/plain');
        const prompt = pastedPrompt(event.clipboardData?.getData(PROMPT_MIME) || '')
          || pastedPrompt(plainText || '');
        if (prompt) {
          event.preventDefault();
          insertPrompt(editor, prompt, attachments, onAttachmentsChange);
          return true;
        }

        // Text wins over images: Office apps (e.g. Excel) add a rendered picture of copied text.
        if (!plainText) {
          const files = Array.from(event.clipboardData?.items || [])
            .filter((item) => item.type.startsWith('image/'))
            .map((item) => item.getAsFile())
            .filter((file): file is File => !!file);
          if (files.length === 0) return false;
          event.preventDefault();
          for (const file of files) {
            const reader = new FileReader();
            reader.onload = () => {
              if (!editor.getRootElement() || typeof reader.result !== 'string') return;
              const id = crypto.randomUUID();
              const attachment = { id, name: file.name || 'pasted-image.png', data: reader.result.split(',')[1], mimeType: file.type, isInline: true };
              attachmentsRef.current = [...attachmentsRef.current, attachment];
              onAttachmentsChange(attachmentsRef.current);
              editor.update(() => {
                if (!$isRangeSelection($getSelection())) $getRoot().selectEnd();
                $getSelection()?.insertNodes([$createImageNode(id)]);
              });
            };
            reader.readAsDataURL(file);
          }
          return true;
        }

        const normalizedText = plainText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        event.preventDefault();
        editor.update(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            selection.insertText(normalizedText);
            return;
          }
          $getRoot().selectEnd();
          const nextSelection = $getSelection();
          if ($isRangeSelection(nextSelection)) {
            nextSelection.insertText(normalizedText);
          }
        });
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
  }, [editor, attachments, onAttachmentsChange]);

  return null;
}

export function KeyboardPlugin({
  onSend,
  sendMode,
  disabled = false,
}: {
  onSend?: () => void,
  sendMode: 'enter' | 'ctrl-enter',
  disabled?: boolean,
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent) => {
        if (disabled) return false;
        if (!onSend) {
          if (event.isComposing) return false;
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return false;
          event.preventDefault();
          selection.insertNodes([$createLineBreakNode()]);
          return true;
        } else if (sendMode === 'enter') {
          if (!event.shiftKey && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            onSend();
            return true;
          }
        } else {
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            onSend();
            return true;
          }
        }
        return false;
      },
      COMMAND_PRIORITY_CRITICAL
    );
  }, [disabled, editor, onSend, sendMode]);

  return null;
}

export function PlainTextFormattingGuardPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      FORMAT_TEXT_COMMAND,
      () => true,
      COMMAND_PRIORITY_CRITICAL
    );
  }, [editor]);

  return null;
}

export function RegisterEditorPlugin({ onReady }: { onReady: (editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    onReady(editor);
  }, [editor, onReady]);

  return null;
}

export function InlineAttachmentBackspacePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      () => {
        let removed = false;

        editor.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;

          const anchorNode = selection.anchor.getNode();
          let previousNode =
            $isTextNode(anchorNode) && selection.anchor.offset === 0
              ? anchorNode.getPreviousSibling()
              : null;

          if (!previousNode && $isElementNode(anchorNode) && selection.anchor.offset > 0) {
            previousNode = anchorNode.getChildAtIndex(selection.anchor.offset - 1);
          }

          if (previousNode && (previousNode instanceof ImageNode || $isReferenceNode(previousNode))) {
            previousNode.remove();
            removed = true;
          }
        });

        return removed;
      },
      COMMAND_PRIORITY_HIGH
    );
  }, [editor]);

  return null;
}

function quoteAttachment(id: string, quote: string): ChatAttachment {
  return { id, name: 'Quote', mimeType: 'text/plain', isInline: true, attachmentType: 'quote', quote };
}

/** Inserts code references from the IDE and quotes from the chat into the active composer. */
export function ExternalReferencePlugin({
  isActive,
  attachments,
  onAttachmentsChange,
}: {
  isActive: boolean;
  attachments: ChatAttachment[];
  onAttachmentsChange: (items: ChatAttachment[]) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  const onAttachmentsChangeRef = useRef(onAttachmentsChange);
  onAttachmentsChangeRef.current = onAttachmentsChange;

  useEffect(() => {
    if (!isActive) return;

    const insert = (attachment: ChatAttachment, kind: ReferenceKind) => {
      onAttachmentsChangeRef.current([...attachmentsRef.current, attachment]);

      editor.update(() => {
        if (!$isRangeSelection($getSelection())) $getRoot().selectEnd();
        $getSelection()?.insertNodes([$createReferenceNode(attachment.id, kind), $createTextNode(' ')]);
      });
    };

    const handleExternalReference = (event: Event) => {
      const detail = (event as CustomEvent<{ path: string; fileName: string; startLine?: number; endLine?: number }>).detail;
      if (!detail?.path || !detail?.fileName) return;

      insert({
        id: crypto.randomUUID(),
        path: detail.path,
        name: detail.fileName,
        mimeType: 'application/x-code-reference',
        isInline: true,
        attachmentType: 'code_ref',
        startLine: detail.startLine,
        endLine: detail.endLine,
      }, 'code-ref');
    };

    const handleQuote = (event: Event) => {
      const quote = (event as CustomEvent<{ quote: string }>).detail?.quote;
      if (!quote) return;

      insert(quoteAttachment(crypto.randomUUID(), quote), 'quote');
      // The user comments on the quote next.
      editor.focus();
    };

    window.addEventListener('external-code-reference', handleExternalReference as EventListener);
    window.addEventListener('external-quote', handleQuote as EventListener);
    return () => {
      window.removeEventListener('external-code-reference', handleExternalReference as EventListener);
      window.removeEventListener('external-quote', handleQuote as EventListener);
    };
  }, [isActive, editor]);

  return null;
}

type ScrollSnapshot = {
  scrollTop: number;
};

function readScrollSnapshot(container: HTMLDivElement): ScrollSnapshot | null {
  if (container.scrollHeight <= container.clientHeight + 1) return null;

  return {
    scrollTop: container.scrollTop,
  };
}

function isDeleteInput(event: Event): boolean {
  if (event instanceof InputEvent) {
    return event.inputType.startsWith('delete');
  }

  if (event instanceof KeyboardEvent) {
    return event.key === 'Backspace' || event.key === 'Delete';
  }

  return event.type === 'cut';
}

export function AutoHeightPlugin({
  onHeightChange,
  scrollContainerRef,
}: {
  onHeightChange: (height: number) => void;
  scrollContainerRef?: RefObject<HTMLDivElement>;
}) {
  const [editor] = useLexicalComposerContext();
  const pendingRestoreRef = useRef<ScrollSnapshot | null>(null);
  const restoreFrameRef = useRef<number | null>(null);

  const captureDeleteScroll = useCallback((event: Event) => {
    const container = scrollContainerRef?.current;
    if (!container || !isDeleteInput(event)) return;
    pendingRestoreRef.current = readScrollSnapshot(container);
  }, [scrollContainerRef]);

  const restoreDeleteScroll = useCallback(() => {
    const container = scrollContainerRef?.current;
    const snapshot = pendingRestoreRef.current;
    if (!container || !snapshot) return;

    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const nextScrollTop = Math.min(snapshot.scrollTop, maxScrollTop);
    if (Math.abs(container.scrollTop - nextScrollTop) > 1) {
      container.scrollTop = nextScrollTop;
    }
  }, [scrollContainerRef]);

  const scheduleDeleteScrollRestore = useCallback(() => {
    if (!pendingRestoreRef.current) return;

    if (restoreFrameRef.current !== null) {
      cancelAnimationFrame(restoreFrameRef.current);
    }

    restoreFrameRef.current = requestAnimationFrame(() => {
      restoreFrameRef.current = null;
      restoreDeleteScroll();

      restoreFrameRef.current = requestAnimationFrame(() => {
        restoreFrameRef.current = null;
        restoreDeleteScroll();
        pendingRestoreRef.current = null;
      });
    });
  }, [restoreDeleteScroll]);

  useEffect(() => {
    const updateHeight = () => {
      const rootElement = editor.getRootElement();
      if (rootElement) {
        onHeightChange(rootElement.scrollHeight);
        scheduleDeleteScrollRestore();
      }
    };
    
    updateHeight();
    return editor.registerUpdateListener(updateHeight);
  }, [editor, onHeightChange, scheduleDeleteScrollRestore]);

  useEffect(() => {
    const rootElement = editor.getRootElement();
    if (!rootElement || !scrollContainerRef?.current) return;

    rootElement.addEventListener('beforeinput', captureDeleteScroll, true);
    rootElement.addEventListener('keydown', captureDeleteScroll, true);
    rootElement.addEventListener('cut', captureDeleteScroll, true);

    return () => {
      rootElement.removeEventListener('beforeinput', captureDeleteScroll, true);
      rootElement.removeEventListener('keydown', captureDeleteScroll, true);
      rootElement.removeEventListener('cut', captureDeleteScroll, true);
    };
  }, [captureDeleteScroll, editor, scrollContainerRef]);

  useEffect(() => {
    return () => {
      if (restoreFrameRef.current !== null) {
        cancelAnimationFrame(restoreFrameRef.current);
      }
    };
  }, []);

  return null;
}

export function ClickToFocusPlugin({ containerRef }: { containerRef: React.RefObject<HTMLDivElement> }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleClick = (e: MouseEvent) => {
      // Focus if clicking directly on the container or its padding area
      if (e.target === container) {
        editor.update(() => {
          $getRoot().selectEnd();
          editor.focus();
        });
      }
    };

    container.addEventListener('click', handleClick);
    return () => container.removeEventListener('click', handleClick);
  }, [editor, containerRef]);

  return null;
}

export function ClearEditorPlugin({ inputValue }: { inputValue: string }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (inputValue === '') {
      editor.update(() => {
        const root = $getRoot();
        if (root.getTextContent() !== '' || root.getChildrenSize() > 1) {
          root.clear();
        }
      });
    }
  }, [inputValue, editor]);

  return null;
}

export function LoadComposerDraftPlugin({
  revision,
  inputValue,
  attachments,
}: {
  revision: number;
  inputValue: string;
  attachments: ChatAttachment[];
}) {
  const [editor] = useLexicalComposerContext();
  const draftRef = useRef({ inputValue, attachments });
  draftRef.current = { inputValue, attachments };

  useEffect(() => {
    if (revision === 0) return;
    const draft = draftRef.current;
    restoreComposerContent(editor, draft.inputValue, draft.attachments);
  }, [editor, revision]);

  return null;
}
