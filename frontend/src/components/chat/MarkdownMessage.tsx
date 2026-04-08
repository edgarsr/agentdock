import React, { useCallback, useMemo } from 'react';
import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from '../../utils/highlight';
import { openFile } from '../../utils/openFile';
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
}

/**
 * Minimalist Markdown rendering component for chat messages.
 * Adheres to IDE theme using Tailwind arbitrary variants and CSS variables.
 */
export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ content }) => {
  const html = useMemo(() => {
    try {
      let processed = content;
      const codeBlockMatches = processed.match(/```/g);
      if (codeBlockMatches && codeBlockMatches.length % 2 !== 0) {
        processed += '\n```';
      }
      return marked.parse(processed);
    } catch (e) {
      console.error('[MarkdownMessage] Parse error:', e);
      return content;
    }
  }, [content]);

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

  return (
    <div
      className="markdown-body"
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html as string }}
    />
  );
};

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

