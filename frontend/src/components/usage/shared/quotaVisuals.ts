export type UsageSeverity = 'neutral' | 'ok' | 'warning' | 'critical';

export function clampPercent(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

export function getUsageSeverity(value: number | null | undefined): UsageSeverity {
  const percent = clampPercent(value);
  if (percent === null) return 'neutral';
  if (percent >= 90) return 'critical';
  if (percent >= 75) return 'warning';
  return 'ok';
}

export function getUsageFillClass(value: number | null | undefined): string {
  switch (getUsageSeverity(value)) {
    case 'critical':
      return 'bg-error';
    case 'warning':
      return 'bg-warning';
    case 'ok':
      return 'bg-foreground-secondary';
    default:
      return 'bg-foreground-secondary';
  }
}

export function getUsageBorderClass(value: number | null | undefined): string {
  switch (getUsageSeverity(value)) {
    case 'critical':
      return 'border-error';
    case 'warning':
      return 'border-warning';
    case 'ok':
      return 'border-foreground-secondary';
    default:
      return 'border-foreground-secondary/35';
  }
}

export function formatUsagePercent(value: number | null | undefined, digits = 0): string {
  const percent = clampPercent(value);
  if (percent === null) return 'N/A';
  return digits > 0
    ? `${parseFloat(percent.toFixed(digits))}% used`
    : `${Math.round(percent)}% used`;
}
