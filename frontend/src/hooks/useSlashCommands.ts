import type * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LexicalEditor } from 'lexical';
import type { ChatAttachment } from '../types/chat';
import {
  applySlashCommandToEditor,
  SlashCommandItem,
  calculateSlashMenuLayout,
  computeViewportTopInset,
  extractSlashQuery,
  findHighlightedSlashCommandIndex,
  hasMatchingSlashCommand,
  SlashMenuLayout,
} from '../components/chat/input/slashCommands';

interface UseSlashCommandsOptions {
  inputValue: string;
  selectedAgentId: string;
  availableCommands: SlashCommandItem[];
  inputRootRef: React.RefObject<HTMLDivElement>;
  menuRef: React.RefObject<HTMLDivElement>;
  lexicalEditorRef: React.RefObject<LexicalEditor | null>;
  onInputChange: (value: string) => void;
  onAttachmentsChange: (attachments: ChatAttachment[]) => void;
}

export function useSlashCommands({
  inputValue,
  selectedAgentId,
  availableCommands,
  inputRootRef,
  menuRef,
  lexicalEditorRef,
  onInputChange,
  onAttachmentsChange,
}: UseSlashCommandsOptions) {
  const [layout, setLayout] = useState<SlashMenuLayout | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [dismissedSlashValue, setDismissedSlashValue] = useState<string | null>(null);
  const [viewportTopInset, setViewportTopInset] = useState(12);

  const slashQuery = useMemo(() => extractSlashQuery(inputValue), [inputValue]);
  const commands = useMemo(() => (slashQuery === null ? [] : availableCommands), [availableCommands, slashQuery]);
  const isOpen = slashQuery !== null
    && dismissedSlashValue !== inputValue
    && commands.length > 0
    && hasMatchingSlashCommand(availableCommands, slashQuery);

  const close = useCallback(() => {
    setDismissedSlashValue(inputValue);
    setLayout(null);
  }, [inputValue]);

  const applyCommand = useCallback((command: SlashCommandItem) => {
    const nextValue = applySlashCommandToEditor(
      lexicalEditorRef.current,
      command,
      onInputChange,
      onAttachmentsChange
    );
    setDismissedSlashValue(nextValue);
    setLayout(null);
  }, [lexicalEditorRef, onInputChange, onAttachmentsChange]);

  const updateLayout = useCallback(() => {
    if (!isOpen) {
      setLayout(null);
      return;
    }

    const rootElement = inputRootRef.current;
    if (!rootElement) {
      setLayout(null);
      return;
    }

    setLayout(calculateSlashMenuLayout(rootElement, commands.length, viewportTopInset));
  }, [commands.length, inputRootRef, isOpen, viewportTopInset]);

  useEffect(() => {
    if (slashQuery === null) {
      setDismissedSlashValue(null);
    } else if (dismissedSlashValue && dismissedSlashValue !== inputValue) {
      setDismissedSlashValue(null);
    }
  }, [dismissedSlashValue, inputValue, slashQuery]);

  useEffect(() => {
    setHighlightedIndex(findHighlightedSlashCommandIndex(commands, slashQuery));
  }, [commands, selectedAgentId, slashQuery]);

  useEffect(() => {
    if (highlightedIndex < commands.length) return;
    setHighlightedIndex(0);
  }, [commands.length, highlightedIndex]);

  useEffect(() => {
    if (!isOpen) return;
    const selectedRow = menuRef.current?.querySelector<HTMLElement>(`[data-command-index="${highlightedIndex}"]`);
    selectedRow?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex, isOpen, menuRef]);

  useEffect(() => {
    if (!isOpen) {
      setLayout(null);
      return;
    }

    const rootElement = inputRootRef.current;
    if (!rootElement) {
      setLayout(null);
      return;
    }

    const recalculate = () => {
      setViewportTopInset(computeViewportTopInset(rootElement));
      setLayout(calculateSlashMenuLayout(rootElement, commands.length, computeViewportTopInset(rootElement)));
    };

    recalculate();

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (inputRootRef.current?.contains(target)) return;
      close();
    };

    window.addEventListener('resize', recalculate);
    window.addEventListener('scroll', recalculate, true);
    window.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('resize', recalculate);
      window.removeEventListener('scroll', recalculate, true);
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [close, commands.length, inputRootRef, isOpen, menuRef, updateLayout]);

  const handleKeyDownCapture = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isOpen || commands.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((prev) => (prev + 1) % commands.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((prev) => (prev - 1 + commands.length) % commands.length);
      return;
    }

    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      applyCommand(commands[highlightedIndex] ?? commands[0]);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }, [applyCommand, close, commands, highlightedIndex, isOpen]);

  return {
    commands,
    isOpen,
    layout,
    highlightedIndex,
    setHighlightedIndex,
    applyCommand,
    handleKeyDownCapture,
  };
}
