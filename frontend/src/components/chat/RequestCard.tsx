import { ReactNode, useId, useRef } from 'react';
import { Info, X } from 'lucide-react';
import { Checkbox } from '../ui/Checkbox';
import { Radio } from '../ui/Radio';
import { Tooltip } from './shared/Tooltip';

const focusClassName = 'focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--ide-Button-default-focusColor)] focus-visible:outline-offset-2';

/** Shared presentation for ACP questions and permission requests. */
export function RequestCard({ heading, icon, children, actions, onDismiss }: {
  heading?: string | null;
  icon: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  /** Without it the request offers no dismiss button. */
  onDismiss?: () => void;
}) {
  return (
    <section aria-label={heading || 'Agent request'} className="my-1 w-full min-w-0 max-w-full rounded-ide border border-border bg-input p-2 text-ide-small">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-warning" aria-hidden="true">{icon}</span>
        <span className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{heading}</span>
        {onDismiss && <Tooltip content="Dismiss request" variant="minimal" className="ml-auto shrink-0">
          <button type="button" onClick={onDismiss} aria-label="Dismiss request"
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-foreground-secondary hover:text-foreground ${focusClassName}`}>
            <X size={14} aria-hidden="true" />
          </button>
        </Tooltip>}
      </div>
      {children && <div className="mt-1 min-w-0 max-h-[40dvh] space-y-2 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere]">{children}</div>}
      {actions && <div className="mt-2 flex min-w-0 flex-wrap items-end justify-end gap-1.5 [&_button]:touch:min-h-10">{actions}</div>}
    </section>
  );
}

export function RequestHint({ content, label }: { content: ReactNode; label: string }) {
  return <Tooltip className="shrink-0" content={<div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{content}</div>}
    contentClassName="!max-w-[min(320px,calc(100vw-16px))] !text-xs">
    <span tabIndex={0} aria-label={label} className={`flex h-5 w-4 mr-1 cursor-default items-center justify-center rounded text-foreground-secondary ${focusClassName}`}>
      <Info size={14} aria-hidden="true" />
    </span>
  </Tooltip>;
}

/**
 * An option that answers at once, styled like an unselected [RequestChoice]. A button rather than a radio,
 * since arrow keys in a radio group select the next option, which would answer the request.
 */
export function RequestAction({ label, onSelect }: { label: string; onSelect: () => void }) {
  return <button type="button" onClick={onSelect}
    className={`flex w-full min-w-0 items-center gap-1.5 rounded py-1 pl-1 text-left leading-5 hover:bg-hover touch:min-h-10 ${focusClassName}`}>
    <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full border border-radio-border bg-background" />
    <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{label}</span>
  </button>;
}

/**
 * Help follows the text; an overflowing label yields space to the icon. [onSelect] learns whether a pointer made
 * the choice: arrow keys also select radios, so only a click or tap may answer a question at once.
 */
export function RequestChoice({ label, description, name, checked, multiple = false, onSelect }: {
  label: string;
  description?: ReactNode;
  name: string;
  checked: boolean;
  multiple?: boolean;
  onSelect: (byPointer: boolean) => void;
}) {
  const id = useId();
  const pointerRef = useRef(false);
  const select = () => {
    onSelect(pointerRef.current);
    pointerRef.current = false;
  };
  return <div className="flex min-w-0 items-center gap-1.5 rounded hover:bg-hover"
    onPointerDown={() => { pointerRef.current = true; }} onKeyDown={() => { pointerRef.current = false; }}>
    <label htmlFor={id} className="flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 py-1 pl-1 leading-5 touch:min-h-10">
      {multiple ? <Checkbox id={id} checked={checked} onCheckedChange={select} className="!top-0" />
        : <Radio id={id} name={name} checked={checked} onCheckedChange={select}
          onClick={checked ? select : undefined} />}
      <span className={description ? 'min-w-0 truncate' : 'min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]'}>{label}</span>
    </label>
    {description && <RequestHint content={description} label={`${label} details`} />}
  </div>;
}
