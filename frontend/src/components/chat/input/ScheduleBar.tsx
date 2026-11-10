import { useEffect, useRef, useState } from 'react';
import { Clock, Info, X } from 'lucide-react';
import { chatFocusClassName } from '../shared/focusStyles';
import { Tooltip } from '../shared/Tooltip';
import { parseScheduledTime, scheduledTimeParts } from './scheduledTime';

interface ScheduleBarProps {
  scheduledAt?: number;
  onScheduledAtChange: (time: number | undefined) => void;
  onClose: () => void;
}

const segments = [
  { label: 'Day', placeholder: 'DD', length: 2, width: 'w-[2.25ch]' },
  { label: 'Month', placeholder: 'MM', length: 2, width: 'w-[2.25ch]' },
  { label: 'Year', placeholder: 'YYYY', length: 4, width: 'w-[4.25ch]' },
  { label: 'Hour', placeholder: 'HH', length: 2, width: 'w-[2.25ch]' },
  { label: 'Minute', placeholder: 'mm', length: 2, width: 'w-[2.25ch]' },
] as const;

function validSegment(index: number, value: string): boolean {
  if (value.length === 0) return true;
  const number = Number(value);
  if (index === 2) return value.length < 4 || number >= new Date().getFullYear();
  const maximum = [31, 12, 0, 23, 59][index];
  return value.length < 2 || (number <= maximum && (index >= 3 || number > 0));
}

export function ScheduleBar({ scheduledAt, onScheduledAtChange, onClose }: ScheduleBarProps) {
  const [values, setValues] = useState<string[]>(() => scheduledAt === undefined
    ? ['', '', '', '', '']
    : scheduledTimeParts(scheduledAt));
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    inputs.current[3]?.focus();
    inputs.current[3]?.select();
  }, []);

  const update = (next: string[]) => {
    const time = parseScheduledTime(next);
    if (!next.every((part, index) => validSegment(index, part))
      || (next.every((part, index) => part.length === segments[index].length) && time === undefined)) return false;
    setValues(next);
    onScheduledAtChange(time);
    return true;
  };

  const updateSegment = (index: number, value: string) => update(values.map((part, i) => i === index ? value : part));

  const focusSegment = (index: number) => {
    const input = inputs.current[index];
    input?.focus();
    input?.select();
  };

  return (
    <div className="py-1">
      <div className="flex h-[calc(theme(spacing.9)+2px)] w-full min-w-0 items-center gap-2 rounded-[6px] border border-border bg-background-secondary px-3 text-ide-small text-foreground-secondary">
        <Clock size={14} className="shrink-0" aria-hidden="true" />
        <span className="shrink-0 whitespace-nowrap">Send at</span>
        <div
          role="group"
          aria-label="Scheduled date and time (DD.MM.YYYY HH:mm, local time)"
          className="flex h-7 shrink-0 items-center rounded-[6px] bg-background px-1.5 font-mono text-foreground
            focus-within:shadow-[0_0_0_1px_color-mix(in_srgb,var(--ide-Button-default-focusColor)_70%,transparent)]"
          onPaste={(event) => {
            const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})$/.exec(event.clipboardData.getData('text').trim());
            if (!match) return;
            event.preventDefault();
            const next = match.slice(1).map((part, index) => index === 2 ? part : part.padStart(2, '0'));
            update(next);
          }}
        >
          {segments.map((segment, index) => (
            <span key={segment.label} className="flex items-center">
              {index > 0 && (
                <span aria-hidden="true" className="text-foreground-secondary">{index === 3 ? '\u00a0' : index === 4 ? ':' : '.'}</span>
              )}
              <input
                name="schedule-segment"
                ref={(element) => { inputs.current[index] = element; }}
                type="text"
                inputMode="numeric"
                value={values[index]}
                maxLength={segment.length}
                placeholder={segment.placeholder}
                aria-label={segment.label}
                onFocus={(event) => event.currentTarget.select()}
                onBlur={(event) => {
                  if (index === 2 || event.currentTarget.value.length !== 1) return;
                  updateSegment(index, event.currentTarget.value.padStart(2, '0'));
                }}
                onChange={(event) => {
                  const value = event.target.value.replace(/\D/g, '').slice(0, segment.length);
                  if (!updateSegment(index, value)) return;
                  if (value.length === segment.length && index < segments.length - 1) focusSegment(index + 1);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Backspace' && !values[index] && index > 0) {
                    event.preventDefault();
                    focusSegment(index - 1);
                  } else if ((event.key === '.' || event.key === ':' || event.key === ' ') && index < segments.length - 1) {
                    event.preventDefault();
                    if (values[index].length === 1 && segment.length === 2) {
                      updateSegment(index, values[index].padStart(2, '0'));
                    }
                    focusSegment(index + 1);
                  } else if (event.key === 'ArrowLeft' && index > 0 && event.currentTarget.selectionStart === 0) {
                    event.preventDefault();
                    focusSegment(index - 1);
                  } else if (event.key === 'ArrowRight' && index < segments.length - 1
                    && event.currentTarget.selectionStart === values[index].length) {
                    event.preventDefault();
                    focusSegment(index + 1);
                  }
                }}
                className={`${segment.width} h-5 min-w-0 appearance-none rounded-none border-0 bg-transparent p-0 text-center tabular-nums text-foreground outline-none focus:bg-accent focus:text-accent-foreground focus:shadow-none`}
              />
            </span>
          ))}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Tooltip
            content={<>
              Scheduled prompts are sent once their time arrives and they reach the front of the queue. Queued prompts are kept only while this chat is open in the plugin.
              <br /><br />
              Each queued prompt uses the model and other configuration options selected when it was added to the queue.
            </>}
            contentClassName="!max-w-[min(320px,calc(100vw-16px))] !text-xs"
          >
            <span tabIndex={0} aria-label="About scheduled prompts" className={`block cursor-default p-1 ${chatFocusClassName}`}>
              <Info size={14} aria-hidden="true" />
            </span>
          </Tooltip>
          <button type="button" onClick={onClose} aria-label="Turn off schedule send"
            className={`p-1 text-foreground-secondary transition-colors hover:text-foreground ${chatFocusClassName}`}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
