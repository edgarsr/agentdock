import { useEffect, useState } from 'react';

export const MIN_SIDEBAR_WIDTH = 150;
export const MIN_CONTENT_WIDTH = 500;
export const SIDEBAR_BREAKPOINT = MIN_SIDEBAR_WIDTH + MIN_CONTENT_WIDTH;

export function clampSidebarWidth(preferredWidth: number, viewportWidth: number) {
  const maximumWidth = Math.max(MIN_SIDEBAR_WIDTH, viewportWidth - MIN_CONTENT_WIDTH);
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(preferredWidth, maximumWidth));
}

function readIslandsTheme() {
  return getComputedStyle(document.documentElement)
    .getPropertyValue('--ide-theme-is-islands').trim() === '1';
}

export function useAppLayout() {
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [isIslandsTheme, setIsIslandsTheme] = useState(readIslandsTheme);

  useEffect(() => {
    const updateWidth = () => setViewportWidth(window.innerWidth);
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  useEffect(() => {
    const updateTheme = () => {
      const isIslands = readIslandsTheme();
      document.documentElement.classList.toggle('ide-theme-islands', isIslands);
      setIsIslandsTheme(isIslands);
    };
    updateTheme();
    const themeStyle = document.getElementById('ide-theme-style');
    if (!themeStyle) return;
    const observer = new MutationObserver(updateTheme);
    observer.observe(themeStyle, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return {
    isWide: viewportWidth >= SIDEBAR_BREAKPOINT,
    isIslandsTheme,
    viewportWidth,
  };
}
