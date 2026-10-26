import type React from 'react';
import { useCallback, useState } from 'react';

/**
 * The images from other hosts that the user chose to show, and the click handler of the buttons
 * that `sanitizeMarkdownHtml` puts in their place. Kept in state, as the HTML is made again for
 * every streamed part of a reply.
 */
export function useShownImages(): [ReadonlySet<string>, (event: React.MouseEvent<HTMLElement>) => void] {
  const [shownImages, setShownImages] = useState<ReadonlySet<string>>(() => new Set());

  const handleShowImage = useCallback((event: React.MouseEvent<HTMLElement>) => {
    const src = (event.target as HTMLElement | null)?.closest('[data-remote-image-src]')?.getAttribute('data-remote-image-src');
    if (!src) return;
    // An image in a link shows itself in place of opening the link.
    event.preventDefault();
    event.stopPropagation();
    setShownImages((shown) => new Set(shown).add(src));
  }, []);

  return [shownImages, handleShowImage];
}
