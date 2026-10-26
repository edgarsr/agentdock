import { openFile } from './openFile';

let linkClicksInstalled = false;

/** Opens every clicked link in the IDE or the system browser, so no link replaces the plugin page. */
export function installLinkClickHandler() {
  if (typeof window === 'undefined' || linkClicksInstalled) return;
  linkClicksInstalled = true;

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const anchor = target?.closest('a');
    // The button of a held image shows it instead (MarkdownMessage), even in a link.
    if (!anchor || target?.closest('[data-remote-image-src]')) return;

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
  }, { capture: true });
}

function decodeHtmlHref(href: string): string {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = href;
  return textarea.value;
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
  const hashLineMatch = normalized.match(/^(.*?)#L(\d+)(?:-L\d+)?$/i);
  const pathWithOptionalLine = hashLineMatch
    ? { path: hashLineMatch[1], line: Number(hashLineMatch[2]) - 1 }
    : { path: normalized, line: undefined };

  const colonLineMatch = pathWithOptionalLine.path.match(/^(.*?):(\d+)(?::\d+|-\d+)?$/);
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
      const path = decodeURIComponent(url.pathname.replace(/^\/([A-Za-z]:\/)/, '$1'));
      const lineFragment = /^#L\d+(?:-L\d+)?$/i.test(url.hash) ? url.hash : '';
      return path + lineFragment;
    } catch {
      return null;
    }
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^[A-Za-z]:[\\/]/.test(href)) {
    return null;
  }

  return href;
}
