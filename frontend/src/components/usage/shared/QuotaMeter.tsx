import { clampPercent, getUsageBorderClass, getUsageFillClass } from './quotaVisuals';

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

interface QuotaMeterProps {
  percent?: number | null;
  size?: number;
  strokeWidth?: number;
  className?: string;
  width?: number | string;
  height?: number | string;
}

export function QuotaMeter({
  percent,
  size = 16,
  strokeWidth = 1,
  className,
  width,
  height,
}: QuotaMeterProps) {
  const normalizedPercent = clampPercent(percent) ?? 0;
  const progressClass = getUsageFillClass(normalizedPercent);
  const borderClass = getUsageBorderClass(normalizedPercent);
  const resolvedWidth = width ?? Math.max(5, Math.round(size * 0.4));
  const resolvedHeight = height ?? Math.round(size * 1.3);

  return (
    <span
      className={cx('relative inline-flex shrink-0 overflow-hidden rounded-full', className)}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      aria-hidden="true"
    >
      <span
        className={cx('absolute inset-x-0 bottom-0 rounded-full transition-[height,background-color] duration-200 ease-out', progressClass)}
        style={{ height: `${normalizedPercent}%` }}
      />
      <span
        className={cx('absolute inset-0 rounded-full border', borderClass)}
        style={{ borderWidth: strokeWidth }}
      />
    </span>
  );
}
