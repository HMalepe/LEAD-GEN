// South African time helpers. SAST is UTC+2 all year (no daylight saving),
// so a fixed offset is exact and avoids timezone-database surprises.

const OFFSET_MS = 2 * 60 * 60 * 1000;

export interface SaParts {
  year: number;
  month: number; // 1–12
  day: number;
  dow: number; // 0 = Sunday
  hour: number;
  minute: number;
}

export function saParts(d: Date): SaParts {
  const s = new Date(d.getTime() + OFFSET_MS);
  return {
    year: s.getUTCFullYear(),
    month: s.getUTCMonth() + 1,
    day: s.getUTCDate(),
    dow: s.getUTCDay(),
    hour: s.getUTCHours(),
    minute: s.getUTCMinutes(),
  };
}

/** Build a Date from SAST wall-clock components. */
export function saDate(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - OFFSET_MS);
}

export function isoDay(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Easter Sunday (Gregorian), anonymous Gregorian algorithm. */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

const FIXED_HOLIDAYS: Array<[number, number]> = [
  [1, 1], // New Year's Day
  [3, 21], // Human Rights Day
  [4, 27], // Freedom Day
  [5, 1], // Workers' Day
  [6, 16], // Youth Day
  [8, 9], // National Women's Day
  [9, 24], // Heritage Day
  [12, 16], // Day of Reconciliation
  [12, 25], // Christmas Day
  [12, 26], // Day of Goodwill
];

/**
 * Ad-hoc holidays declared by the President (e.g. election days).
 * Add them here as they are gazetted, in YYYY-MM-DD form.
 */
export const EXTRA_HOLIDAYS = new Set<string>(
  (process.env.EXTRA_HOLIDAYS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
);

/** SA public holidays for a year, incl. Sunday → Monday substitution (Public Holidays Act s2(1)). */
export function publicHolidays(year: number): Set<string> {
  const out = new Set<string>();
  const add = (month: number, day: number) => {
    const d = new Date(Date.UTC(year, month - 1, day));
    out.add(isoDay(year, month, day));
    if (d.getUTCDay() === 0) {
      const mon = new Date(d.getTime() + 24 * 60 * 60 * 1000);
      out.add(isoDay(mon.getUTCFullYear(), mon.getUTCMonth() + 1, mon.getUTCDate()));
    }
  };
  for (const [m, d] of FIXED_HOLIDAYS) add(m, d);

  const easter = easterSunday(year);
  const e = Date.UTC(year, easter.month - 1, easter.day);
  const goodFriday = new Date(e - 2 * 86_400_000);
  const familyDay = new Date(e + 1 * 86_400_000);
  for (const d of [goodFriday, familyDay]) {
    out.add(isoDay(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()));
  }
  for (const x of EXTRA_HOLIDAYS) if (x.startsWith(`${year}-`)) out.add(x);
  return out;
}

export function isPublicHoliday(d: Date): boolean {
  const p = saParts(d);
  return publicHolidays(p.year).has(isoDay(p.year, p.month, p.day));
}

const fmt = new Intl.DateTimeFormat('en-ZA', {
  timeZone: 'Africa/Johannesburg',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** e.g. "Tue, 10 Nov, 09:00" */
export function formatSa(d: Date): string {
  return fmt.format(d);
}
