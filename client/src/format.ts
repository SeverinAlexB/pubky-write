const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const dayMonth = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const fullDate = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

/** Short date for lists: the time for today, day and month this year, the full date otherwise. */
export function formatShortDate(timestamp: number, now = new Date()): string {
  const date = new Date(timestamp);
  if (date.toDateString() === now.toDateString()) return time.format(date);
  if (date.getFullYear() === now.getFullYear()) return dayMonth.format(date);
  return fullDate.format(date);
}

const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Comment times: "16:26 Today", "16:26 Yesterday", then "13 Oct" (with the year if it is not this year). */
export function formatCommentTime(timestamp: number, now = new Date()): string {
  const date = new Date(timestamp);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (date.toDateString() === now.toDateString()) return `${clock.format(date)} Today`;
  if (date.toDateString() === yesterday.toDateString()) return `${clock.format(date)} Yesterday`;
  return date.getFullYear() === now.getFullYear() ? dayMonth.format(date) : fullDate.format(date);
}

const dayMonthLong = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long" });
const dayMonthYearLong = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", year: "numeric" });

/** Day headings in version history: "Today", "Yesterday", "13 October" (with the year if it is not this year). */
export function formatDay(timestamp: number, now = new Date()): string {
  const date = new Date(timestamp);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (date.toDateString() === now.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return longDate(date, now);
}

/** A version in the history list: "13 October, 15:42". */
export function formatVersionTime(timestamp: number, now = new Date()): string {
  const date = new Date(timestamp);
  return `${longDate(date, now)}, ${clock.format(date)}`;
}

/** The selected version above the preview: "Today, 15:42", "Yesterday, 09:05" or "13 October, 15:36". */
export function formatVersionTitle(timestamp: number, now = new Date()): string {
  return `${formatDay(timestamp, now)}, ${clock.format(new Date(timestamp))}`;
}

function longDate(date: Date, now: Date): string {
  return (date.getFullYear() === now.getFullYear() ? dayMonthLong : dayMonthYearLong).format(date);
}
