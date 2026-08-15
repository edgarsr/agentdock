import { useCallback, useEffect, useRef, useState } from 'react';
import { LexicalEditor, $getSelection, $isRangeSelection, $isTextNode } from 'lexical';
import { calculateSlashMenuLayout, computeViewportTopInset, SlashMenuLayout } from '../components/chat/input/slashCommands';
import { ACPBridge } from '../utils/bridge';

// A search walks the filename index, so let a burst of keystrokes settle before running one.
const FILE_SEARCH_DEBOUNCE_MS = 150;

export interface FileMentionItem {
  path: string;
  name: string;
}

interface UseFileMentionsOptions {
  inputRootRef: React.RefObject<HTMLDivElement>;
  menuRef: React.RefObject<HTMLDivElement>;
  lexicalEditorRef: React.RefObject<LexicalEditor | null>;
}

export function useFileMentions({
  inputRootRef,
  menuRef,
  lexicalEditorRef,
}: UseFileMentionsOptions) {
  const [layout, setLayout] = useState<SlashMenuLayout | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [files, setFiles] = useState<FileMentionItem[]>([]);
  
  const [queryMatch, setQueryMatch] = useState<{ query: string, startOffset: number, endOffset: number, nodeKey: string } | null>(null);
  const searchTimeoutRef = useRef<number | undefined>(undefined);

  const searchFilesDebounced = useCallback((query: string) => {
    window.clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = window.setTimeout(() => ACPBridge.searchFiles(query), FILE_SEARCH_DEBOUNCE_MS);
  }, []);

  const clearMention = useCallback(() => {
    window.clearTimeout(searchTimeoutRef.current);
    setQueryMatch(null);
  }, []);

  useEffect(() => () => window.clearTimeout(searchTimeoutRef.current), []);

  useEffect(() => {
    return ACPBridge.onFilesResult((e) => {
      setFiles(e.detail.files);
    });
  }, []);

  useEffect(() => {
    if (!lexicalEditorRef.current) return;
    
    return lexicalEditorRef.current.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          clearMention();
          return;
        }

        const node = selection.anchor.getNode();
        if (!$isTextNode(node)) {
          clearMention();
          return;
        }

        const anchorOffset = selection.anchor.offset;
        const textContent = node.getTextContent();
        const textBeforeCursor = textContent.slice(0, anchorOffset);

        const match = textBeforeCursor.match(/(?:^|[\s(])@([^\s]*)$/);
        
        if (match) {
          const matchedString = match[1];
          const fullMatchWithSymbol = "@" + matchedString;
          const matchStart = textBeforeCursor.lastIndexOf(fullMatchWithSymbol);
          if (matchStart >= 0) {
            setQueryMatch({
               query: matchedString,
               startOffset: matchStart,
               endOffset: anchorOffset,
               nodeKey: node.getKey()
            });
            searchFilesDebounced(matchedString);
            return;
          }
        }

        clearMention();
      });
    });
  }, [clearMention, lexicalEditorRef, searchFilesDebounced]);

  const isOpen = queryMatch !== null && files.length > 0;

  const close = useCallback(() => {
    clearMention();
    setLayout(null);
  }, [clearMention]);

  const applyFile = useCallback((file: FileMentionItem) => {
    if (!lexicalEditorRef.current || !queryMatch) {
       close();
       return;
    }
    
    lexicalEditorRef.current.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
           const anchor = selection.anchor;
           const node = anchor.getNode();
           if ($isTextNode(node) && node.getKey() === queryMatch.nodeKey) {
               const textContent = node.getTextContent();
               const newText = textContent.slice(0, queryMatch.startOffset) + textContent.slice(queryMatch.endOffset);
               node.setTextContent(newText);
               node.select(queryMatch.startOffset, queryMatch.startOffset);
           }
        }
    });

    const event = new CustomEvent('external-code-reference', {
        detail: {
            path: file.path,
            fileName: file.name
        }
    });
    window.dispatchEvent(event);

    close();
  }, [lexicalEditorRef, queryMatch, close]);

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
      setLayout(calculateSlashMenuLayout(rootElement, files.length, computeViewportTopInset(rootElement)));
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
  }, [files.length, inputRootRef, isOpen, menuRef, close]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [queryMatch?.query]);

  useEffect(() => {
    if (highlightedIndex >= files.length) {
      setHighlightedIndex(0);
    }
  }, [files.length, highlightedIndex]);

  useEffect(() => {
    if (!isOpen) return;
    const selectedRow = menuRef.current?.querySelector<HTMLElement>(`[data-command-index="${highlightedIndex}"]`);
    selectedRow?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex, isOpen, menuRef]);

  const handleKeyDownCapture = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isOpen || files.length === 0) return false;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      setHighlightedIndex((prev) => (prev + 1) % files.length);
      return true;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      setHighlightedIndex((prev) => (prev - 1 + files.length) % files.length);
      return true;
    }

    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      applyFile(files[highlightedIndex] ?? files[0]);
      return true;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return true;
    }
    return false;
  }, [applyFile, close, files, highlightedIndex, isOpen]);

  return {
    files,
    isOpen,
    layout,
    highlightedIndex,
    setHighlightedIndex,
    applyFile,
    handleKeyDownCapture,
  };
}
