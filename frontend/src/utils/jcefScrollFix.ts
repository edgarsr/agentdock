/**
 * JCEF (JetBrains Embedded Chromium) smooth scroll fix.
 * Fine-tuned for aggressive acceleration and responsive mouse wheel steps.
 */

const SMOOTHING_FACTOR = 0.5;

let targetElement: HTMLElement | null = null;
let targetTop = 0;
let currentTop = 0;
let targetLeft = 0;
let currentLeft = 0;
let isMoving = false;
let lastInternalScrollTop = -1;
let lastInternalScrollLeft = -1;

function animate() {
  if (!targetElement) {
    isMoving = false;
    return;
  }

  const diffTop = targetTop - currentTop;
  const diffLeft = targetLeft - currentLeft;

  if (Math.abs(diffTop) < 0.2 && Math.abs(diffLeft) < 0.2) {
    targetElement.scrollTop = targetTop;
    targetElement.scrollLeft = targetLeft;
    currentTop = targetTop;
    currentLeft = targetLeft;
    isMoving = false;
    return;
  }

  currentTop += diffTop * SMOOTHING_FACTOR;
  currentLeft += diffLeft * SMOOTHING_FACTOR;

  lastInternalScrollTop = Math.round(currentTop);
  lastInternalScrollLeft = Math.round(currentLeft);

  targetElement.scrollTop = lastInternalScrollTop;
  targetElement.scrollLeft = lastInternalScrollLeft;

  requestAnimationFrame(animate);
}

function getProgressiveDelta(delta: number): number {
  const absDelta = Math.abs(delta);
  
  let multiplier = 1.5;

  if (absDelta > 30) {
    multiplier = 1.5 + (absDelta - 30) * 0.75
  }

  // Increased cap for maximum speed
  const finalMultiplier = Math.min(multiplier, 6.0);
  
  return delta * finalMultiplier;
}

export function installJcefScrollFix() {
  if (typeof window === 'undefined') return;

  window.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      if (e.defaultPrevented) return;

      let element = e.target as HTMLElement | null;
      while (element && element !== document.documentElement) {
        const style = window.getComputedStyle(element);
        const canScrollY = element.scrollHeight > element.clientHeight && 
                           (style.overflowY === 'auto' || style.overflowY === 'scroll');
        const canScrollX = element.scrollWidth > element.clientWidth && 
                           (style.overflowX === 'auto' || style.overflowX === 'scroll');

        if (canScrollY || canScrollX) {
          e.preventDefault();

          if (targetElement !== element) {
            targetElement = element;
            currentTop = element.scrollTop;
            targetTop = currentTop;
            currentLeft = element.scrollLeft;
            targetLeft = currentLeft;
          }

          if (Math.abs(element.scrollTop - lastInternalScrollTop) > 1) {
            currentTop = element.scrollTop;
            targetTop = currentTop;
          }
          if (Math.abs(element.scrollLeft - lastInternalScrollLeft) > 1) {
            currentLeft = element.scrollLeft;
            targetLeft = currentLeft;
          }

          if (canScrollY && Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
            const maxScroll = element.scrollHeight - element.clientHeight;
            const acceleratedDelta = getProgressiveDelta(e.deltaY);
            targetTop = Math.max(0, Math.min(maxScroll, targetTop + acceleratedDelta));
          } else if (canScrollX) {
            const maxScroll = element.scrollWidth - element.clientWidth;
            const acceleratedDelta = getProgressiveDelta(e.deltaX);
            targetLeft = Math.max(0, Math.min(maxScroll, targetLeft + acceleratedDelta));
          }

          if (!isMoving) {
            isMoving = true;
            requestAnimationFrame(animate);
          }
          return;
        }
        element = element.parentElement;
      }
    },
    { passive: false, capture: true }
  );

  window.addEventListener('scroll', (e) => {
    const element = e.target as HTMLElement;
    if (element === targetElement) {
      if (Math.abs(element.scrollTop - lastInternalScrollTop) > 1) {
        currentTop = element.scrollTop;
        targetTop = currentTop;
      }
      if (Math.abs(element.scrollLeft - lastInternalScrollLeft) > 1) {
        currentLeft = element.scrollLeft;
        targetLeft = currentLeft;
      }
    }
  }, { capture: true, passive: true });
}
