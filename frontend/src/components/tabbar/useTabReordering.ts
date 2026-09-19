import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

type DropPosition = 'before' | 'after';

export function useTabReordering(
  axis: 'horizontal' | 'vertical',
  onReorder: (draggedId: string, targetId: string, position: DropPosition) => void,
) {
  const listRef = useRef<HTMLDivElement>(null);
  const suppressClickTabIdRef = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: DropPosition } | null>(null);

  const findDropTarget = (sourceId: string, clientX: number, clientY: number) => {
    const elements = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-reorder-tab-id]') ?? []);
    for (const element of elements) {
      const id = element.dataset.reorderTabId;
      if (!id || id === sourceId) continue;

      const rect = element.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) continue;

      const pointerPosition = axis === 'horizontal' ? clientX : clientY;
      const midpoint = axis === 'horizontal'
        ? rect.left + rect.width / 2
        : rect.top + rect.height / 2;
      return { id, position: pointerPosition < midpoint ? 'before' as const : 'after' as const };
    }
    return null;
  };

  const startReordering = (id: string, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;

    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    let latestDropTarget: { id: string; position: DropPosition } | null = null;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const distance = Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY);
      if (distance < 4) return;

      moved = true;
      latestDropTarget = findDropTarget(id, moveEvent.clientX, moveEvent.clientY);
      setDropTarget(latestDropTarget);
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      setDropTarget(null);

      if (!moved) return;

      suppressClickTabIdRef.current = id;
      window.setTimeout(() => {
        if (suppressClickTabIdRef.current === id) suppressClickTabIdRef.current = null;
      }, 0);

      if (latestDropTarget) {
        onReorder(id, latestDropTarget.id, latestDropTarget.position);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  return {
    listRef,
    dropTarget,
    startReordering,
    shouldSuppressClick: (id: string) => suppressClickTabIdRef.current === id,
  };
}
