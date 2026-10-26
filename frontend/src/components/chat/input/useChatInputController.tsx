import type {KeyboardEvent} from 'react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {$getRoot, $getSelection, $isRangeSelection, LexicalEditor,} from 'lexical';
import {Bookmark, Paperclip, SquareTerminal,} from 'lucide-react';

import {DropdownOption,} from '../../../types/chat';
import {PromptLibraryItem} from '../../../types/promptLibrary';
import {ACPBridge} from '../../../utils/bridge';
import {openFile} from '../../../utils/openFile';
import {useSlashCommands} from '../../../hooks/useSlashCommands';
import {applySlashCommandToEditor, buildAgentSlashItems, buildPromptLibrarySlashItems,} from './slashCommands';
import {useFileMentions} from '../../../hooks/useFileMentions';
import {isShortcut, useKeyDown} from '../../../hooks/useShortcuts';
import {ImageNode} from './ImageNode';
import {ReferenceNode} from './ReferenceNode';
import {ChatInputProps} from './chatInputState';

export function useChatInputController({
  conversationId,
  inputValue,
  composerLoadRevision = 0,
  onInputChange,
  selectedAgentId,
  availableCommands,
  onAttachmentsChange,
  customHeight = 180,
  autoFocus = false,
  isActive = false,
}: ChatInputProps) {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const inputRootRef = useRef<HTMLDivElement>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const lexicalEditorRef = useRef<LexicalEditor | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [promptLibraryItems, setPromptLibraryItems] = useState<PromptLibraryItem[]>([]);
  const [composerRevision, setComposerRevision] = useState(0);
  const registeredNodeClassesRef = useRef({
    imageNode: ImageNode,
    referenceNode: ReferenceNode,
  });

  useEffect(() => {
    const cleanup = ACPBridge.onPromptLibrary((e) => setPromptLibraryItems(e.detail.items));
    ACPBridge.loadPromptLibrary();
    return cleanup;
  }, []);

  useEffect(() => {
    const previous = registeredNodeClassesRef.current;
    if (previous.imageNode !== ImageNode || previous.referenceNode !== ReferenceNode) {
      registeredNodeClassesRef.current = {
        imageNode: ImageNode,
        referenceNode: ReferenceNode,
      };
      lexicalEditorRef.current = null;
      setComposerRevision((value) => value + 1);
    }
  }, [ImageNode, ReferenceNode]);

  useEffect(() => {
    const handleDragHighlight = (e: Event) => {
      const active = (e as CustomEvent<{ active: boolean }>).detail?.active;
      setIsDragOver(active);
    };
    window.addEventListener('drag-highlight', handleDragHighlight as EventListener);
    return () => window.removeEventListener('drag-highlight', handleDragHighlight as EventListener);
  }, []);

  const handleOpenFile = useCallback((filePath: string, line?: number) => {
    openFile(filePath, line);
  }, []);

  const [sendMode, setSendModeState] = useState<'enter' | 'ctrl-enter'>(
    () => ACPBridge.getGlobalSettingsSnapshot()?.settings?.sendMode === 'ctrl-enter' ? 'ctrl-enter' : 'enter'
  );
  useEffect(() => ACPBridge.onGlobalSettings((e) => {
    setSendModeState(e.detail?.payload?.settings?.sendMode === 'ctrl-enter' ? 'ctrl-enter' : 'enter');
  }), []);
  const setSendMode = useCallback((mode: 'enter' | 'ctrl-enter') => {
    setSendModeState(mode);
    ACPBridge.saveGlobalSettings({ sendMode: mode });
  }, []);

  const agentSlashItems = useMemo(
    () => buildAgentSlashItems(availableCommands),
    [availableCommands]
  );

  const promptLibrarySlashItems = useMemo(
    () => buildPromptLibrarySlashItems(promptLibraryItems),
    [promptLibraryItems]
  );

  const slashItems = useMemo(() => ([
    ...agentSlashItems,
    ...promptLibrarySlashItems,
  ]), [agentSlashItems, promptLibrarySlashItems]);

  const plusMenuOptions: DropdownOption[] = useMemo(() => {
    const options: DropdownOption[] = [
      { id: 'add-files', label: 'Attach file', icon: <Paperclip className="w-4 h-4" /> },
    ];

    if (agentSlashItems.length > 0) {
      options.push({
        id: 'commands',
        label: 'Insert command',
        icon: <SquareTerminal className="w-4 h-4" />,
        subOptions: agentSlashItems.map((command) => ({
          id: command.id,
          label: `${command.displayPrefix}${command.name}`,
          description: command.description,
        })),
      });
    }

    if (promptLibrarySlashItems.length > 0) {
      options.push({
        id: 'prompt-library',
        label: 'Insert prompt',
        icon: <Bookmark className="w-4 h-4" />,
        subOptions: promptLibrarySlashItems.map((prompt) => ({
          id: prompt.id,
          label: `${prompt.displayPrefix}${prompt.name}`,
          description: prompt.description,
        })),
      });
    }

    return options;
  }, [agentSlashItems, promptLibrarySlashItems]);

  const focusEditor = () => {
    editorContainerRef.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
  };

  useEffect(() => {
    if (!autoFocus) return;
    const raf = requestAnimationFrame(focusEditor);
    return () => cancelAnimationFrame(raf);
  }, [autoFocus, composerLoadRevision, conversationId]);

  useKeyDown((event) => {
    if (!isShortcut(event, 'focusInput')) return false;
    focusEditor();
    return true;
  }, isActive);

  const {
    commands: slashCommands,
    isOpen: isSlashMenuOpen,
    layout: slashMenuLayout,
    highlightedIndex,
    setHighlightedIndex,
    applyCommand,
    handleKeyDownCapture,
  } = useSlashCommands({
    inputValue,
    selectedAgentId,
    availableCommands: slashItems,
    inputRootRef,
    menuRef: slashMenuRef,
    lexicalEditorRef,
    onInputChange,
    onAttachmentsChange,
  });

  const {
    files: mentionedFiles,
    isOpen: isFileMenuOpen,
    layout: fileMenuLayout,
    highlightedIndex: fileHighlightedIndex,
    setHighlightedIndex: setFileHighlightedIndex,
    applyFile,
    handleKeyDownCapture: handleFileMentionsKeyDownCapture,
  } = useFileMentions({
    inputRootRef,
    menuRef: fileMenuRef,
    lexicalEditorRef,
  });

  const combinedHandleKeyDownCapture = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
     if (isFileMenuOpen) {
       handleFileMentionsKeyDownCapture(e);
       if (e.defaultPrevented) return;
     }
     if (isSlashMenuOpen) {
       handleKeyDownCapture(e);
       if (e.defaultPrevented) return;
     }
  }, [handleFileMentionsKeyDownCapture, handleKeyDownCapture, isFileMenuOpen, isSlashMenuOpen]);

  const insertText = useCallback((text: string) => {
    const normalizedText = text.trim();
    if (!normalizedText) return;

    const editor = lexicalEditorRef.current;
    if (!editor) {
      const fallback = inputValue.trim() ? `${inputValue.trimEnd()} ${normalizedText}` : normalizedText;
      onInputChange(fallback);
      return;
    }

    let nextText = normalizedText;
    editor.update(() => {
      const root = $getRoot();
      const existingText = root.getTextContent();
      const prefix = existingText.trim().length > 0 && !existingText.endsWith(' ') && !existingText.endsWith('\n') ? ' ' : '';
      root.selectEnd();
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        selection.insertText(`${prefix}${normalizedText}`);
      }
      nextText = root.getTextContent();
    });
    onInputChange(nextText);
  }, [inputValue, onInputChange]);

  const handleInsertSlashItem = useCallback((itemId: string, items: typeof slashItems) => {
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item) return;

    applySlashCommandToEditor(
      lexicalEditorRef.current,
      item,
      onInputChange,
      onAttachmentsChange
    );
  }, [lexicalEditorRef, onInputChange, onAttachmentsChange]);

  return {
    editorContainerRef,
    inputRootRef,
    slashMenuRef,
    fileMenuRef,
    composerRevision,
    sendMode,
    setSendMode,
    plusMenuOptions,
    isDragOver,
    isSlashMenuOpen,
    slashCommands,
    slashMenuLayout,
    highlightedIndex,
    setHighlightedIndex,
    applyCommand,
    isFileMenuOpen,
    mentionedFiles,
    fileMenuLayout,
    fileHighlightedIndex,
    setFileHighlightedIndex,
    applyFile,
    customHeight,
    insertText,
    agentSlashItems,
    promptLibrarySlashItems,
    handleOpenFile,
    combinedHandleKeyDownCapture,
    handleInsertSlashItem,
    setLexicalEditor: (editor: LexicalEditor) => {
      lexicalEditorRef.current = editor;
    },
  };
}
