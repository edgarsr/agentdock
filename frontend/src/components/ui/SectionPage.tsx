import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Button } from './Button';

interface SectionPageProps {
  toolbar?: ReactNode;
  /** Shows an Add button above the content, right-aligned. */
  onAdd?: () => void;
  /** Padding of the scrolling content. */
  padding?: string;
  children: ReactNode;
}

/**
 * Body of a section in the section popup, which owns the title. The toolbar stays fixed above the scrolling content.
 */
export function SectionPage({ toolbar, onAdd, padding = 'px-5 pb-8 pt-3', children }: SectionPageProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {toolbar}
      <div data-section-scroll tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto focus:outline-none">
        <div className={`flex flex-col ${padding}`}>
          {onAdd ? (
            <div className="flex justify-end pb-4">
              <Button onClick={onAdd} variant="primary" leftIcon={<Plus size={14} />} className="max-h-8">Add</Button>
            </div>
          ) : null}
          {children}
        </div>
      </div>
    </div>
  );
}
