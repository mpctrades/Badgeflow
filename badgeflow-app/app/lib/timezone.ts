// Campaign schedules are entered and shown in the shop's timezone (Shopify's
// `shop.ianaTimezone`), never the server's or the merchant's browser's, so a
// campaign starts when the merchant expects wherever the app is opened.
// Shared by the server (parsing) and the browser (display), with no library.

// Wall-clock parts of an instant in a timezone.
function partsIn(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

// Milliseconds the timezone is ahead of UTC at a given instant.
function offsetAt(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

// "2026-09-26" + "09:30" in `timeZone` → the UTC instant. Returns null for
// malformed input. Handles DST by re-checking the offset at the result.
export function zonedToUtc(date: string, time: string, timeZone: string): Date | null {
  const d = DATE_RE.exec(date);
  const t = TIME_RE.exec(time);
  if (!d || !t) return null;
  const [year, month, day, hour, minute] = [+d[1]!, +d[2]!, +d[3]!, +t[1]!, +t[2]!];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wall - offsetAt(new Date(wall), timeZone);
  guess = wall - offsetAt(new Date(guess), timeZone);
  const result = new Date(guess);
  // Reject dates that roll over, e.g. Feb 31.
  const check = partsIn(result, timeZone);
  if (check.year !== year || check.month !== month || check.day !== day) return null;
  return result;
}

// The instant as { date: "YYYY-MM-DD", time: "HH:mm" } in `timeZone`.
export function utcToZoned(instant: Date, timeZone: string): { date: string; time: string } {
  const p = partsIn(instant, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

// "Sat 26 Sep, 09:30" in the shop's timezone — identical on server and
// browser, so it never causes a hydration mismatch.
export function formatInZone(instant: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(instant));
}

export function formatDateInZone(instant: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone }).format(new Date(instant));
}

// Half-hour slots for the schedule's time selects, plus 23:59 so a campaign
// can run to the very end of its last day.
export const TIME_OPTIONS: string[] = [
  ...Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`),
  "23:59",
];
