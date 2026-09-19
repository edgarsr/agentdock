import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import type { ChatAttachment } from '../../../types/chat';

const INPUT_MIN_HEIGHT = 120;
const INPUT_MIN_HEIGHT_WITH_ATTACHMENTS = 192;
const INPUT_MAX_HEIGHT = 424;
const INPUT_DEFAULT_HEIGHT = 180;
const INPUT_BOTTOM_BAR_BUFFER = 70;
const ATTACHMENT_BAR_HEIGHT = 48;
const MAX_HEIGHT_RATIO = 0.8;

export function useChatInputResize(attachments: ChatAttachment[]) {
  const [inputHeight, setInputHeight] = useState(INPUT_DEFAULT_HEIGHT);
  const [contentHeight, setContentHeight] = useState(0);
  const [isResizing, setIsResizing] = useState(false);
  const previousBodyStyleRef = useRef<{ cursor: string; userSelect: string } | null>(null);
  const [isManualSize, setIsManualSize] = useState(false);

  const handleMouseMoveRef = useRef<((e: globalThis.MouseEvent) => void) | null>(null);
  const handleMouseUpRef = useRef<(() => void) | null>(null);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
    if (previousBodyStyleRef.current) {
      document.body.style.cursor = previousBodyStyleRef.current.cursor;
      document.body.style.userSelect = previousBodyStyleRef.current.userSelect;
      previousBodyStyleRef.current = null;
    }
    if (handleMouseMoveRef.current) {
      document.removeEventListener('mousemove', handleMouseMoveRef.current);
    }
    if (handleMouseUpRef.current) {
      document.removeEventListener('mouseup', handleMouseUpRef.current);
    }
    window.removeEventListener('blur', stopResizing);
  }, []);

  const startResizing = useCallback((e: MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsResizing(true);
    setIsManualSize(true);
    const startY = e.clientY;
    const startHeight = inputHeight;
    previousBodyStyleRef.current = {
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
    };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    handleMouseMoveRef.current = (ev: globalThis.MouseEvent) => {
      const newHeight = startHeight + startY - ev.clientY;
      const maxHeight = window.innerHeight * MAX_HEIGHT_RATIO;
      const clampedHeight = Math.max(INPUT_MIN_HEIGHT, Math.min(newHeight, maxHeight));
      setInputHeight(clampedHeight);
    };

    handleMouseUpRef.current = stopResizing;

    document.addEventListener('mousemove', handleMouseMoveRef.current);
    document.addEventListener('mouseup', handleMouseUpRef.current);
    window.addEventListener('blur', stopResizing);
  }, [inputHeight, stopResizing]);

  useEffect(() => {
    if (isManualSize) return;

    const hasAttachmentBar = attachments.some(a => !a.isInline);
    const extraHeight = hasAttachmentBar ? ATTACHMENT_BAR_HEIGHT : 0;

    const totalContentNeeded = contentHeight + INPUT_BOTTOM_BAR_BUFFER + extraHeight;
    const maxHeightLimit = Math.min(INPUT_MAX_HEIGHT, window.innerHeight * MAX_HEIGHT_RATIO);
    const minTarget = hasAttachmentBar ? INPUT_MIN_HEIGHT_WITH_ATTACHMENTS : INPUT_MIN_HEIGHT;
    const clampedTarget = Math.max(minTarget, Math.min(totalContentNeeded, maxHeightLimit));

    setInputHeight(clampedTarget);
  }, [contentHeight, isManualSize, attachments]);

  useEffect(() => {
    return () => {
      stopResizing();
    };
  }, [stopResizing]);

  return {
    inputHeight,
    isResizing,
    setContentHeight,
    startResizing,
  };
}
