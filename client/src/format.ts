const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const dayMonth = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const fullDate = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const dateTime = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

/** Short date for lists: the time for today, day and month this year, the full date otherwise. */
export function formatShortDate(timestamp: number, now = new Date()): string {
  const date = new Date(timestamp);
  if (date.toDateString() === now.toDateString()) return time.format(date);
  if (date.getFullYear() === now.getFullYear()) return dayMonth.format(date);
  return fullDate.format(date);
}

export function formatDateTime(timestamp: number): string {
  return dateTime.format(new Date(timestamp));
}
