export function formatResetAt(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;

  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);

    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    const hour = parts.find((part) => part.type === 'hour')?.value;
    const minute = parts.find((part) => part.type === 'minute')?.value;

    if (!month || !day || !hour || !minute) return null;

    return `${month} ${day}, ${Number(hour)}:${minute}`;
  } catch {
    return null;
  }
}
