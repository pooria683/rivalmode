/**
 * Date helpers. Everything in RivalMode is UTC: workflows run on runners with
 * whatever clock they get, and a scoreboard that flips days at random times is
 * a scoreboard nobody trusts.
 */

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** `2026-11-16T23:04:00Z` -> `2026-11-16` */
export function dayKey(input) {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Midnight UTC of the day containing `input`. */
export function startOfDay(input) {
  const d = new Date(input);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function startOfWeek(input) {
  const d = startOfDay(input);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(d.getTime() - dow * DAY);
}

/** ISO-8601 week number, used for the weekly recap id. */
export function isoWeek(input) {
  const d = startOfDay(input);
  // Move to the Thursday of the current ISO week; its year is the ISO year.
  const thursday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY + 3 * DAY);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const firstThursday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY + 3 * DAY);
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * DAY));
  return { year, week };
}

export function isoWeekLabel(input) {
  const { year, week } = isoWeek(input);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Inclusive list of day keys from `from` to `to`, newest last. */
export function dayKeysBetween(from, to) {
  const out = [];
  let cursor = startOfDay(from);
  const end = startOfDay(to);
  while (cursor.getTime() <= end.getTime() && out.length < 800) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + DAY);
  }
  return out;
}

/** Compact age label: `now`, `4m`, `3h`, `2d`, `5w`. */
export function shortAge(input, now = Date.now()) {
  const t = new Date(input).getTime();
  if (Number.isNaN(t)) return '?';
  const diff = Math.max(0, now - t);
  if (diff < MINUTE) return 'now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`;
  if (diff < 365 * DAY) return `${Math.floor(diff / (7 * DAY))}w`;
  return `${Math.floor(diff / (365 * DAY))}y`;
}

/**
 * The "now" used for relative labels in rendered output.
 * Pinned in tests (and available via RIVALMODE_NOW) so snapshots are stable;
 * in production it is simply the current time.
 */
export function nowMs() {
  const pinned = process.env.RIVALMODE_NOW;
  if (pinned) {
    const parsed = Number(pinned) || Date.parse(pinned);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return Date.now();
}

/** `2026-03-04T10:11:12Z` -> `Mar 04` (or `Mar 04, 2025` when not this year). */
export function shortDate(input, now = Date.now()) {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '?';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const base = `${months[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, '0')}`;
  return d.getUTCFullYear() === new Date(now).getUTCFullYear() ? base : `${base}, ${d.getUTCFullYear()}`;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
