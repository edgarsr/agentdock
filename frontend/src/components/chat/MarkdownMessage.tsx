import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy } from 'lucide-react';
import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from '../../utils/highlight';
import { openFile } from '../../utils/openFile';
import { sanitizeMarkdownHtml } from '../../utils/sanitizeHtml';
import { Tooltip } from './shared/Tooltip';
import '../../styles/markdown.css';

// Configure marked with highlight.js integration
marked.use(
  markedHighlight({
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(decodeHtmlEntitiesDeep(code), { language }).value;
    }
  })
);

marked.setOptions({
  breaks: true, // Support GFM line breaks
  gfm: true,
});

interface MarkdownMessageProps {
  content: string;
  enableCodeCopy?: boolean;
}

const codeBlockClassName = 'markdown-code-block';
const codeCopySlotClassName = 'absolute right-2 top-2 z-10 opacity-0 transition-opacity duration-200 ease-out delay-0 group-hover:opacity-100 group-hover:delay-300 group-focus-within:opacity-100 group-focus-within:delay-0';

/**
 * Minimalist Markdown rendering component for chat messages.
 * Adheres to IDE theme using Tailwind arbitrary variants and CSS variables.
 */
export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ content, enableCodeCopy = true }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const copiedResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copySlots, setCopySlots] = useState<HTMLElement[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const html = useMemo(() => {
    try {
      let processed = content;
      const codeBlockMatches = processed.match(/```/g);
      if (codeBlockMatches && codeBlockMatches.length % 2 !== 0) {
        processed += '\n```';
      }
      const parsed = marked.parse(processed);
      const sanitizedHtml = sanitizeMarkdownHtml(typeof parsed === 'string' ? parsed : '');
      return enableCodeCopy ? decorateCodeBlocks(sanitizedHtml) : sanitizedHtml;
    } catch (e) {
      console.error('[MarkdownMessage] Parse error:', e);
      const sanitizedHtml = sanitizeMarkdownHtml(content);
      return enableCodeCopy ? decorateCodeBlocks(sanitizedHtml) : sanitizedHtml;
    }
  }, [content, enableCodeCopy]);

  useEffect(() => {
    if (!enableCodeCopy) {
      setCopySlots([]);
      return;
    }

    const nextSlots = Array.from(
      containerRef.current?.querySelectorAll<HTMLElement>('[data-code-copy-slot]') ?? []
    );
    setCopySlots(nextSlots);
  }, [html, enableCodeCopy]);

  useEffect(() => {
    return () => {
      if (copiedResetTimerRef.current) {
        window.clearTimeout(copiedResetTimerRef.current);
      }
    };
  }, []);

  const handleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const anchor = target?.closest('a');
    if (!anchor) return;

    const rawHref = anchor.getAttribute('href')?.trim();
    if (!rawHref) return;

    event.preventDefault();
    event.stopPropagation();

    const href = decodeHtmlHref(rawHref);
    const localFileTarget = parseLocalFileTarget(href);
    if (localFileTarget) {
      openFile(localFileTarget.path, localFileTarget.line);
      return;
    }

    if (/^https?:\/\//i.test(href)) {
      window.__openUrl?.(href);
    }
  }, []);

  const handleCopyCodeBlock = useCallback(async (slot: HTMLElement, index: number) => {
    const code = slot.closest(`.${codeBlockClassName}`)?.querySelector('pre code')?.textContent;
    if (!code || !navigator.clipboard?.writeText) return;

    try {
      await navigator.clipboard.writeText(code);
      setCopiedIndex(index);
      if (copiedResetTimerRef.current) {
        window.clearTimeout(copiedResetTimerRef.current);
      }
      copiedResetTimerRef.current = window.setTimeout(() => {
        setCopiedIndex(null);
      }, 1400);
    } catch (error) {
      console.warn('[MarkdownMessage] Failed to copy code block:', error);
    }
  }, []);

  return (
    <>
      <div
        ref={containerRef}
        className="markdown-body"
        onClick={handleClick}
        dangerouslySetInnerHTML={{ __html: html as string }}
      />
      {enableCodeCopy && copySlots.map((slot, index) => createPortal(
        <Tooltip key={index} content={copiedIndex === index ? 'Copied' : 'Copy'} variant="minimal">
          <button
            type="button"
            aria-label={copiedIndex === index ? 'Copied code' : 'Copy code'}
            className="flex h-7 w-7 items-center justify-center rounded-[4px] border border-border bg-background
              text-foreground-secondary transition-colors hover:bg-hover hover:text-foreground focus:outline-none"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void handleCopyCodeBlock(slot, index);
            }}
          >
            {copiedIndex === index ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </Tooltip>,
        slot
      ))}
    </>
  );
};

function decorateCodeBlocks(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;

  Array.from(template.content.querySelectorAll('pre')).forEach((pre, index) => {
    if (!pre.querySelector('code') || pre.parentElement?.classList.contains(codeBlockClassName)) {
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = `${codeBlockClassName} group relative my-3`;

    const copySlot = document.createElement('span');
    copySlot.className = codeCopySlotClassName;
    copySlot.setAttribute('data-code-copy-slot', String(index));

    pre.parentNode?.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);
    wrapper.appendChild(copySlot);
  });

  const container = document.createElement('div');
  container.appendChild(template.content.cloneNode(true));
  return container.innerHTML;
}

function decodeHtmlHref(href: string): string {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = href;
  return textarea.value;
}

function decodeHtmlEntitiesDeep(value: string): string {
  const textarea = document.createElement('textarea');
  let current = value;

  for (let i = 0; i < 5; i++) {
    textarea.innerHTML = current;
    const decoded = textarea.value;
    if (decoded === current) break;
    current = decoded;
  }

  return current;
}

function parseLocalFileTarget(href: string): { path: string; line?: number } | null {
  const trimmed = href.trim();
  if (!trimmed) {
    return null;
  }

  const normalizedHref = normalizeLocalFileHref(trimmed);
  if (!normalizedHref) {
    return null;
  }

  const normalized = normalizedHref.replace(/\\/g, '/');
  const hashLineMatch = normalized.match(/^(.*?)(?:#L(\d+))$/i);
  const pathWithOptionalLine = hashLineMatch
    ? { path: hashLineMatch[1], line: Number(hashLineMatch[2]) - 1 }
    : { path: normalized, line: undefined };

  const colonLineMatch = pathWithOptionalLine.path.match(/^(.*\.[^./\\:]+):(\d+)$/);
  const rawPath = colonLineMatch ? colonLineMatch[1] : pathWithOptionalLine.path;
  const line = colonLineMatch
    ? Number(colonLineMatch[2]) - 1
    : pathWithOptionalLine.line;

  if (!isLikelyLocalFilePath(rawPath)) {
    return null;
  }

  return {
    path: rawPath,
    line: line !== undefined && Number.isFinite(line) && line >= 0 ? line : undefined,
  };
}

function isLikelyLocalFilePath(path: string): boolean {
  if (!path || path.startsWith('#')) return false;
  if (/^[A-Za-z]:\//.test(path)) return true;
  if (path.startsWith('./') || path.startsWith('../') || path.startsWith('/')) return true;
  if (path.includes('/')) return true;

  return /^(?!\.)[^\\/:*?"<>|\r\n]+\.[^\\/:*?"<>|\r\n]+$/.test(path);
}

function normalizeLocalFileHref(href: string): string | null {
  if (/^file:/i.test(href)) {
    try {
      const url = new URL(href);
      if (url.protocol !== 'file:') {
        return null;
      }
      return decodeURIComponent(url.pathname.replace(/^\/([A-Za-z]:\/)/, '$1'));
    } catch {
      return null;
    }
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^[A-Za-z]:[\\/]/.test(href)) {
    return null;
  }

  return href;
}

