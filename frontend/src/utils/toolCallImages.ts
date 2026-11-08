const IMAGE_PATH = /\.(png|jpe?g|gif|webp|bmp|svg)(?:$|[?#])/i;

// `stored` names an image the history keeps apart from the conversation, loaded when it is shown.
export type ToolCallImage = { src: string } | { path: string } | { stored: string; mimeType?: string };

export function toolCallImageKey(image: ToolCallImage): string {
  if ('src' in image) return image.src;
  return 'path' in image ? image.path : image.stored;
}

export function imageDataSrc(data: string, mimeType?: string): string {
  return data.startsWith('data:') ? data : `data:${mimeType || 'image/png'};base64,${data}`;
}

export function extractToolCallImages(json: Record<string, any>): ToolCallImage[] {
  const fromContent: ToolCallImage[] = [];
  if (Array.isArray(json.content)) {
    for (const item of json.content) {
      const inner = item?.type === 'content' ? item.content : item;
      if (inner?.type !== 'image') continue;
      if (typeof inner.data === 'string' && inner.data) {
        fromContent.push({ src: imageDataSrc(inner.data, inner.mimeType) });
      } else if (typeof inner.storedImage === 'string' && inner.storedImage) {
        fromContent.push({ stored: inner.storedImage, mimeType: inner.mimeType });
      }
    }
  }
  if (fromContent.length > 0) return fromContent;

  const output = asObject(json.rawOutput);
  if (!output) return [];

  for (const key of ['imagePath', 'savedPath', 'saved_path', 'path']) {
    const value = output[key];
    if (typeof value !== 'string' || !IMAGE_PATH.test(value)) continue;
    if (/^https?:\/\//i.test(value)) return [{ src: value }];
    return [{ path: toLocalPath(value) }];
  }

  const result = typeof output.result === 'string' ? output.result.trim() : '';
  if (result.startsWith('iVBORw')) return [{ src: `data:image/png;base64,${result}` }];
  if (result.startsWith('/9j/')) return [{ src: `data:image/jpeg;base64,${result}` }];
  return [];
}

export function toolCallPrompt(json: Record<string, any>): string {
  const input = asObject(json.rawInput) || {};
  const output = asObject(json.rawOutput) || {};
  for (const value of [input.prompt, input.Prompt, output.revisedPrompt, output.prompt]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function isInlineImageText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('data:image/')
    || trimmed.startsWith('iVBORw')
    || trimmed.startsWith('/9j/');
}

export function readLocalImage(path: string): Promise<string | null> {
  if (typeof window.__readLocalImage !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    const previous = window.__onLocalImageResult;
    let timer: number | undefined;
    const finish = (url: string | null) => {
      window.clearTimeout(timer);
      window.__onLocalImageResult = previous;
      resolve(url);
    };
    window.__onLocalImageResult = (result) => {
      if (result?.path === path) finish(result.dataUrl || null);
    };
    timer = window.setTimeout(() => finish(null), 15000);
    window.__readLocalImage?.(path);
  });
}

function toLocalPath(src: string): string {
  const trimmed = src.trim();
  if (!/^file:/i.test(trimmed)) return trimmed.replace(/\\/g, '/');
  try {
    const url = new URL(trimmed);
    return decodeURIComponent(url.pathname.replace(/^\/([A-Za-z]:\/)/, '$1'));
  } catch {
    return trimmed.replace(/^file:\/\//i, '').replace(/^\/([A-Za-z]:\/)/, '$1');
  }
}

function asObject(value: unknown): Record<string, any> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      return null;
    }
  }
  return null;
}
