import type {KeyboardEvent} from 'react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {$getRoot, $getSelection, $isRangeSelection, LexicalEditor,} from 'lexical';
import {Bookmark, Paperclip, SquareTerminal,} from 'lucide-react';

import {AudioRecordingStatePayload, DropdownOption,} from '../../../types/chat';
import {PromptLibraryItem} from '../../../types/promptLibrary';
import {ACPBridge} from '../../../utils/bridge';
import {openFile} from '../../../utils/openFile';
import {useSlashCommands} from '../../../hooks/useSlashCommands';
import {applySlashCommandToEditor, buildAgentSlashItems, buildPromptLibrarySlashItems,} from './slashCommands';
import {useFileMentions} from '../../../hooks/useFileMentions';
import {$createImageNode, ImageNode} from './ImageNode';
import {CodeReferenceNode} from './CodeReferenceNode';
import {ChatInputProps, emptyTranscriptionFeature} from './chatInputState';

export function useChatInputController({
  conversationId,
  inputValue,
  composerLoadRevision = 0,
  onInputChange,
  isSending,
  selectedAgentId,
  selectedModelId,
  status,
  modeOptions,
  selectedModeId,
  availableCommands,
  attachments,
  onAttachmentsChange,
  customHeight = 180,
  autoFocus = false,
}: ChatInputProps) {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const inputRootRef = useRef<HTMLDivElement>(null);
  const controlsRowRef = useRef<HTMLDivElement>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const lexicalEditorRef = useRef<LexicalEditor | null>(null);
  const transcriptionRequestCounterRef = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [promptLibraryItems, setPromptLibraryItems] = useState<PromptLibraryItem[]>([]);
  const [transcriptionFeature, setTranscriptionFeature] = useState(emptyTranscriptionFeature);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const [composerRevision, setComposerRevision] = useState(0);
  const registeredNodeClassesRef = useRef({
    imageNode: ImageNode,
    codeReferenceNode: CodeReferenceNode,
  });

  useEffect(() => {
    const cleanup = ACPBridge.onPromptLibrary((e) => setPromptLibraryItems(e.detail.items));
    ACPBridge.loadPromptLibrary();
    return cleanup;
  }, []);

  useEffect(() => {
    const previous = registeredNodeClassesRef.current;
    if (previous.imageNode !== ImageNode || previous.codeReferenceNode !== CodeReferenceNode) {
      registeredNodeClassesRef.current = {
        imageNode: ImageNode,
        codeReferenceNode: CodeReferenceNode,
      };
      lexicalEditorRef.current = null;
      setComposerRevision((value) => value + 1);
    }
  }, [ImageNode, CodeReferenceNode]);

  useEffect(() => {
    const cleanup = ACPBridge.onAudioTranscriptionFeature((e) => setTranscriptionFeature(e.detail.state));
    ACPBridge.loadAudioTranscriptionFeature();
    return cleanup;
  }, []);

  useEffect(() => {
    return ACPBridge.onAudioRecordingState((e) => {
      const payload: AudioRecordingStatePayload = e.detail.payload;
      setIsRecording(payload.recording);
      if (payload.error) {
        console.error('[ChatInput] Audio recording error:', payload.error);
      }
    });
  }, []);

  useEffect(() => {
    const handleDragHighlight = (e: Event) => {
      const active = (e as CustomEvent<{ active: boolean }>).detail?.active;
      setIsDragOver(active);
    };
    window.addEventListener('drag-highlight', handleDragHighlight as EventListener);
    return () => window.removeEventListener('drag-highlight', handleDragHighlight as EventListener);
  }, []);

  useEffect(() => {
    const updateWidths = () => {
      setContainerWidth(inputRootRef.current?.clientWidth ?? 0);
    };

    updateWidths();
    const raf = requestAnimationFrame(updateWidths);
    window.addEventListener('resize', updateWidths);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', updateWidths);
    };
  }, [selectedAgentId, selectedModelId, selectedModeId, modeOptions.length, status, isSending]);

  const handleOpenFile = useCallback((filePath: string, line?: number) => {
    openFile(filePath, line);
  }, []);

  const [sendMode, setSendMode] = useState<'enter' | 'ctrl-enter'>(() => {
    return (localStorage.getItem('chat-send-mode') as 'enter' | 'ctrl-enter') || 'enter';
  });

  const initialConfig = useMemo(() => ({
    namespace: `ChatInput-${conversationId}`,
    nodes: [ImageNode, CodeReferenceNode],
    theme: {
      paragraph: 'm-0',
      text: { base: 'text-foreground' },
    },
    onError: (error: Error) => console.error(error),
  }), [conversationId, composerRevision]);

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
          label: prompt.name,
          description: prompt.description,
        })),
      });
    }

    return options;
  }, [agentSlashItems, promptLibrarySlashItems]);

  const handleImagePaste = useCallback((file: File, editor: LexicalEditor) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = (event.target?.result as string).split(',')[1];
      const id = Math.random().toString(36).substring(2, 9);
      const newAtt = { id, name: file.name || 'pasted-image.png', data: base64, mimeType: file.type, isInline: true };
      onAttachmentsChange([...attachments, newAtt]);

      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          const imageNode = $createImageNode(id);
          selection.insertNodes([imageNode]);
        }
      });
    };
    reader.readAsDataURL(file);
  }, [attachments, onAttachmentsChange]);

  useEffect(() => {
    if (!autoFocus) return;
    const focusEditor = () => {
      const editable = editorContainerRef.current?.querySelector('[contenteditable="true"]') as HTMLElement | null;
      if (editable) {
        editable.focus();
      }
    };
    const raf = requestAnimationFrame(focusEditor);
    return () => cancelAnimationFrame(raf);
  }, [autoFocus, composerLoadRevision, conversationId]);

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

  const insertTranscript = useCallback((text: string) => {
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
      onInputChange
    );
  }, [lexicalEditorRef, onInputChange]);

  const handleVoiceInput = useCallback(async () => {
    if (isTranscribing) return;

    if (isRecording) {
      setIsTranscribing(true);
      try {
        transcriptionRequestCounterRef.current += 1;
        const requestId = `audio-recording-${conversationId}-${transcriptionRequestCounterRef.current}-${Date.now()}`;
        const result = await ACPBridge.stopAudioRecording(requestId);
        insertTranscript(result.text || '');
      } catch (error) {
        console.error('[ChatInput] Voice transcription failed:', error);
      } finally {
        setIsRecording(false);
        setIsTranscribing(false);
      }
      return;
    }

    try {
      ACPBridge.startAudioRecording();
      setIsRecording(true);
    } catch (error) {
      console.error('[ChatInput] Unable to start audio capture:', error);
      setIsRecording(false);
    }
  }, [conversationId, insertTranscript, isRecording, isTranscribing]);

  const showVoiceButton = transcriptionFeature.installed;
  const collapsedAgentDropdown = containerWidth > 0 && containerWidth < 400;
  const showAuxIndicators = containerWidth === 0 || containerWidth >= 320;

  return {
    editorContainerRef,
    inputRootRef,
    controlsRowRef,
    slashMenuRef,
    fileMenuRef,
    composerRevision,
    initialConfig,
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
    collapsedAgentDropdown,
    showAuxIndicators,
    showVoiceButton,
    isTranscribing,
    isRecording,
    agentSlashItems,
    promptLibrarySlashItems,
    handleOpenFile,
    handleImagePaste,
    combinedHandleKeyDownCapture,
    handleInsertSlashItem,
    handleVoiceInput,
    setLexicalEditor: (editor: LexicalEditor) => {
      lexicalEditorRef.current = editor;
    },
  };
}
