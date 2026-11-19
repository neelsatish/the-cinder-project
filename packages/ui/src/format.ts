/**
 * Dates as people in British schools write them: "5 Nov 2026", "5 Nov 2026, 17:00".
 * Every app formats through these so no screen falls back to the US order.
 */
const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const dayShort = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

function parse(value: string | number | Date | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: string | number | Date | null | undefined, fallback = "") {
  const date = parse(value);
  return date ? day.format(date) : fallback;
}

export function formatDateTime(value: string | number | Date | null | undefined, fallback = "") {
  const date = parse(value);
  return date ? `${day.format(date)}, ${time.format(date)}` : fallback;
}

/** "Today, 17:00", "Tomorrow, 09:00", "18 Nov, 17:00" (year only when it differs). */
export function formatWhen(value: string | number | Date | null | undefined, fallback = "", now = new Date()) {
  const date = parse(value);
  if (!date) return fallback;
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(date) - startOf(now)) / 86_400_000);
  const clock = time.format(date);
  if (days === 0) return `Today, ${clock}`;
  if (days === 1) return `Tomorrow, ${clock}`;
  if (days === -1) return `Yesterday, ${clock}`;
  const label = date.getFullYear() === now.getFullYear() ? dayShort.format(date) : day.format(date);
  return `${label}, ${clock}`;
}
