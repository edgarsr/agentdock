import DOMPurify from 'dompurify';
import type { Config, UponSanitizeAttributeHook, UponSanitizeAttributeHookEvent } from 'dompurify';

// A slash before any colon identifies a path, allowing local file links with line suffixes.
const SAFE_URI_PATTERN = /^(?:(?:https?|file):|[A-Za-z]:[\\/]|[^:]*\/|[^:]*$)/i;

function sanitizeWithCodeClasses(html: string, config: Config): string {
  const hook: UponSanitizeAttributeHook = (_node: Element, data: UponSanitizeAttributeHookEvent) => {
    if (data.attrName !== 'class') return;
    const safeClassName = data.attrValue
      .split(/\s+/)
      .filter((token) => token === 'hljs' || token.startsWith('hljs-') || token.startsWith('language-'))
      .join(' ');

    if (safeClassName) {
      data.attrValue = safeClassName;
    } else {
      data.keepAttr = false;
    }
  };

  DOMPurify.addHook('uponSanitizeAttribute', hook);
  try {
    return String(DOMPurify.sanitize(html, config));
  } finally {
    DOMPurify.removeHook('uponSanitizeAttribute', hook);
  }
}

export function sanitizeMarkdownHtml(html: string): string {
  return sanitizeWithCodeClasses(html, {
    ALLOWED_TAGS: [
      'a', 'blockquote', 'br', 'code', 'del', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5',
      'h6', 'hr', 'img', 'kbd', 'li', 'ol', 'p', 'pre', 's', 'span', 'strong', 'table',
      'tbody', 'td', 'th', 'thead', 'tr', 'ul'
    ],
    ALLOWED_ATTR: [
      'alt', 'aria-label', 'class', 'colspan', 'height', 'href', 'loading', 'rel',
      'rowspan', 'src', 'target', 'title', 'width'
    ],
    ALLOWED_URI_REGEXP: SAFE_URI_PATTERN,
  });
}

export function sanitizeCodeHtml(html: string): string {
  return sanitizeWithCodeClasses(html, {
    ALLOWED_TAGS: ['span'],
    ALLOWED_ATTR: ['class'],
  });
}

export function sanitizeSvg(svg: string): string {
  return String(DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ALLOWED_ATTR: [
      'aria-hidden', 'clip-path', 'clip-rule', 'cx', 'cy', 'd', 'fill', 'fill-rule',
      'height', 'id', 'points', 'r', 'role', 'rx', 'ry', 'stroke', 'stroke-linecap',
      'stroke-linejoin', 'stroke-width', 'transform', 'viewBox', 'width', 'x', 'x1',
      'x2', 'xmlns', 'y', 'y1', 'y2'
    ],
  }));
}
