import { isPublicHoliday, saDate, saParts } from './saTime.ts';

export interface Slot {
  startsAt: Date;
  endsAt: Date;
}

export interface Interval {
  start: Date;
  end: Date;
}

export interface SlotRules {
  /** Allowed weekdays, 0 = Sunday. */
  days: number[];
  /** Candidate start times, SAST "HH:MM". */
  times: string[];
  /** Earliest bookable start, minutes from now. */
  minLeadMinutes: number;
  durationMinutes: number;
  count: number;
  /** true: one slot per day, rotating times (considered purchases). false: earliest slots first (urgent niches). */
  spreadDays: boolean;
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/** Propose slots that respect working days, SA public holidays, lead time and the client's busy calendar. */
export function proposeSlots(now: Date, rules: SlotRules, busy: Interval[] = []): Slot[] {
  const earliest = new Date(now.getTime() + rules.minLeadMinutes * 60_000);
  const out: Slot[] = [];
  const start = saParts(now);
  for (let offset = 0; offset < 30 && out.length < rules.count; offset++) {
    const noon = saDate(start.year, start.month, start.day + offset, 12);
    const p = saParts(noon);
    if (!rules.days.includes(p.dow) || isPublicHoliday(noon)) continue;
    const order = rules.spreadDays
      ? rules.times.map((_, i) => rules.times[(out.length + i) % rules.times.length])
      : rules.times;
    for (const hhmm of order) {
      const [h, m] = hhmm.split(':').map(Number);
      const s = saDate(p.year, p.month, p.day, h, m);
      const slot: Slot = { startsAt: s, endsAt: new Date(s.getTime() + rules.durationMinutes * 60_000) };
      if (slot.startsAt < earliest) continue;
      if (busy.some((b) => overlaps(b, { start: slot.startsAt, end: slot.endsAt }))) continue;
      out.push(slot);
      if (rules.spreadDays || out.length >= rules.count) break;
    }
  }
  return out;
}
