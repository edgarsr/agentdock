import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, X } from 'lucide-react';
import { Tooltip } from './Tooltip';

interface ImageOverlayModalProps {
  src: string | null;
  onClose: () => void;
}

type ActionStatus = 'copied' | 'downloaded' | null;

const overlayButtonClassName = 'flex h-8 w-8 items-center justify-center rounded bg-secondary text-foreground ' +
  'transition-colors hover:bg-hover hover:text-foreground focus:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black';

export const ImageOverlayModal: React.FC<ImageOverlayModalProps> = ({ src, onClose }) => {
  const [status, setStatus] = useState<ActionStatus>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);

  const flashStatus = useCallback((next: Exclude<ActionStatus, null>) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    setStatus(next);
    timerRef.current = window.setTimeout(() => setStatus(null), 1800);
  }, []);

  useEffect(() => {
    if (!src) return;
    prevFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => containerRef.current?.focus(), 0);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      window.removeEventListener('keydown', onKeyDown);
      prevFocusRef.current?.focus();
    };
  }, [src, onClose]);

  const handleCopy = useCallback(async () => {
    if (!src || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return;
    try {
      const pngPromise = resolveImageBlob(src).then((blob) => (
        blob.type === 'image/png' ? blob : convertBlobToPng(blob)
      ));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngPromise })]);
      flashStatus('copied');
    } catch (err) {
      console.warn('[ImageOverlayModal] Copy failed:', err);
    }
  }, [src, flashStatus]);

  const handleDownload = useCallback(async () => {
    if (!src) return;
    try {
      const blob = await resolveImageBlob(src);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = getDownloadFilename(src);
      link.rel = 'noopener';
      link.click();
      URL.revokeObjectURL(url);
      flashStatus('downloaded');
    } catch (err) {
      console.warn('[ImageOverlayModal] Download failed:', err);
    }
  }, [src, flashStatus]);

  if (!src) return null;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      tabIndex={-1}
      className="absolute inset-0 z-[100] bg-black bg-opacity-50 flex items-center
        justify-center p-8 animate-in fade-in duration-200 cursor-zoom-out outline-none"
      onClick={onClose}
    >
      <div
        className="absolute right-4 top-4 z-10 flex items-center gap-1.5 px-2 py-2"
        onClick={(e) => e.stopPropagation()}
      >
        <Tooltip content="Copy" variant="minimal">
          <button type="button" aria-label="Copy" className={overlayButtonClassName} onClick={handleCopy}>
            {status === 'copied' ? <Check size={13} /> : <Copy size={16} />}
          </button>
        </Tooltip>
        <Tooltip content="Download" variant="minimal">
          <button type="button" aria-label="Download" className={overlayButtonClassName} onClick={handleDownload}>
            {status === 'downloaded' ? <Check size={14} /> : <Download size={16} />}
          </button>
        </Tooltip>
        <Tooltip content="Close" variant="minimal">
          <button type="button" aria-label="Close" className={overlayButtonClassName} onClick={onClose}>
            <X size={14} />
          </button>
        </Tooltip>
      </div>

      <img
        src={src}
        draggable={false}
        alt=""
        className="max-h-full max-w-full min-h-0 min-w-0 object-contain rounded-lg shadow-2xl
          animate-in zoom-in-95 duration-200"
      />
    </div>
  );
};

function getDownloadFilename(src: string): string {
  const name = src.split(/[\\/]/).pop()?.split('?')[0];
  return name && /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name) ? name : 'image.png';
}

async function resolveImageBlob(src: string): Promise<Blob> {
  if (src.startsWith('data:') || src.startsWith('blob:') || /^https?:/i.test(src)) {
    const res = await fetch(src);
    return res.blob();
  }

  const rawPath = toLocalPath(src);
  const dataUrl = await fetchLocalImageDataUrl(rawPath);
  if (!dataUrl) throw new Error('Failed to read local image file');

  const [header, base64] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(header)?.[1] || 'image/png';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function toLocalPath(src: string): string {
  const decoded = decodeURIQuietly(src);
  if (!/^file:/i.test(decoded)) return decoded;

  try {
    const url = new URL(decoded);
    return decodeURIComponent(url.pathname.replace(/^\/([A-Za-z]:\/)/, '$1'));
  } catch {
    return decoded;
  }
}

function decodeURIQuietly(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

async function convertBlobToPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas 2d context');
    ctx.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error('Failed to convert canvas to PNG blob'));
      }, 'image/png');
    });
  } finally {
    bitmap.close();
  }
}

function fetchLocalImageDataUrl(path: string): Promise<string | null> {
  if (typeof window.__readLocalImage !== 'function') return Promise.resolve(null);

  return new Promise((resolve) => {
    const prevHandler = window.__onLocalImageResult;
    let timer: number | undefined;

    const cleanup = (url: string | null) => {
      window.clearTimeout(timer);
      window.__onLocalImageResult = prevHandler;
      resolve(url);
    };

    window.__onLocalImageResult = (result) => {
      if (result?.path === path) cleanup(result.dataUrl || null);
    };
    timer = window.setTimeout(() => cleanup(null), 15000);
    window.__readLocalImage?.(path);
  });
}
