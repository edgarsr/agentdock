import { useEffect, useCallback, useRef } from 'react';
import type { RefObject } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
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
  LexicalEditor
} from 'lexical';
import { ImageNode } from './ImageNode';
import { CodeReferenceNode, $createCodeReferenceNode, $isCodeReferenceNode } from './CodeReferenceNode';
import { ChatAttachment } from '../../../types/chat';

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
          ...$nodesOfType(CodeReferenceNode).map((node) => node.__id),
        ]);
        const filtered = attachments.filter((attachment) => !attachment.isInline || existingIds.has(attachment.id));
        if (filtered.length !== attachments.length) {
          onAttachmentsChange(filtered);
        }
      });
    };

    const unregisterImage = editor.registerMutationListener(ImageNode, (mutations) => {
      for (const [, mutation] of mutations) {
        if (mutation === 'destroyed') {
          syncRemovedAttachments();
          break;
        }
      }
    });

    const unregisterCodeReference = editor.registerMutationListener(CodeReferenceNode, (mutations) => {
      for (const [, mutation] of mutations) {
        if (mutation === 'destroyed') {
          syncRemovedAttachments();
          break;
        }
      }
    });

    return () => {
      unregisterImage();
      unregisterCodeReference();
    };
  }, [editor, attachments, onAttachmentsChange]);

  return null;
}

export function PasteLogPlugin({ onImagePaste }: { onImagePaste: (file: File, editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext();

  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          onImagePaste(file, editor);
        }
      }
    }
  }, [onImagePaste, editor]);

  useEffect(() => {
    const rootElement = editor.getRootElement();
    if (rootElement) {
      rootElement.addEventListener('paste', handlePaste);
      return () => rootElement.removeEventListener('paste', handlePaste);
    }
  }, [editor, handlePaste]);

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event: ClipboardEvent) => {
        const items = event.clipboardData?.items;
        if (items) {
          for (let i = 0; i < items.length; i++) {
            if (items[i].type.startsWith('image/')) {
              return false;
            }
          }
        }

        const plainText = event.clipboardData?.getData('text/plain');
        if (!plainText) return false;

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
  }, [editor]);

  return null;
}

export function KeyboardPlugin({
  onSend,
  sendMode,
  disabled = false,
}: {
  onSend: () => void,
  sendMode: 'enter' | 'ctrl-enter',
  disabled?: boolean,
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent) => {
        if (disabled) return false;
        if (sendMode === 'enter') {
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

          if (previousNode && (previousNode instanceof ImageNode || $isCodeReferenceNode(previousNode))) {
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

export function ExternalCodeReferencePlugin({
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

    const handleExternalReference = (event: Event) => {
      const detail = (event as CustomEvent<{ path: string; fileName: string; startLine?: number; endLine?: number }>).detail;
      if (!detail?.path || !detail?.fileName) return;

      const id = crypto.randomUUID();
      const attachment: ChatAttachment = {
        id,
        path: detail.path,
        name: detail.fileName,
        mimeType: 'application/x-code-reference',
        isInline: true,
        attachmentType: 'code_ref',
        startLine: detail.startLine,
        endLine: detail.endLine,
      };

      onAttachmentsChangeRef.current([...attachmentsRef.current, attachment]);

      editor.update(() => {
        const selection = $getSelection();
        const node = $createCodeReferenceNode(
          id,
          detail.path,
          detail.fileName,
          detail.startLine,
          detail.endLine
        );
        if ($isRangeSelection(selection)) {
          selection.insertNodes([node, $createTextNode(' ')]);
        } else {
          $getRoot().selectEnd();
          $getSelection()?.insertNodes([node, $createTextNode(' ')]);
        }
      });
    };

    window.addEventListener('external-code-reference', handleExternalReference as EventListener);
    return () => {
      window.removeEventListener('external-code-reference', handleExternalReference as EventListener);
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
