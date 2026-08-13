import { useEffect, useRef, useState } from 'react';

interface TabTitleInputProps {
  initialTitle: string;
  onCommit: (title: string) => void;
  onClose: () => void;
  /** Callers own the colors, so the tab and the menu can differ. */
  className?: string;
  /** Padding on the hidden sizer, to keep the row's intrinsic width unchanged while editing. */
  sizerClassName?: string;
}

/** Inline chat title editor, shared by the tab itself and the tab overflow menu. */
export function TabTitleInput({ initialTitle, onCommit, onClose, className, sizerClassName }: TabTitleInputProps) {
  const [value, setValue] = useState(initialTitle);
  const inputRef = useRef<HTMLInputElement>(null);
  const finishedRef = useRef(false);
  const finishRef = useRef<(commit: boolean) => void>();

  finishRef.current = (commit: boolean) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const title = value.trim();
    if (commit && title && title !== initialTitle) {
      onCommit(title);
    }
  };

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Fallback for exits that skip blur, e.g. the overflow menu unmounting the row.
  useEffect(() => () => finishRef.current?.(true), []);

  const finish = (commit: boolean) => {
    finishRef.current?.(commit);
    onClose();
  };

  return (
    // The invisible original title keeps the intrinsic width unchanged while editing.
    <span className="grid min-w-0 flex-1 items-center">
      <span aria-hidden="true" className={`invisible col-start-1 row-start-1 truncate text-ide-small ${sizerClassName || ''}`}>
        {initialTitle}
      </span>
      <input
        ref={inputRef}
        type="text"
        size={1}
        spellCheck={false}
        aria-label="Chat title"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => finish(true)}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key !== 'Enter' && event.key !== 'Escape') return;
          event.preventDefault();
          finish(event.key === 'Enter');
        }}
        className={`col-start-1 row-start-1 h-auto w-full min-w-0 border-none p-0 text-ide-small
          focus:border-none focus:shadow-none focus:outline-none ${className || ''}`}
      />
    </span>
  );
}
