import { MIN_LEAD_TIME_HOURS, SLOT_MINUTES, SLOT_TIMES } from './config.ts';
import { isPublicHoliday, saDate, saParts } from './saTime.ts';

export interface Slot {
  startsAt: Date;
  endsAt: Date;
}

export interface Interval {
  start: Date;
  end: Date;
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/**
 * Propose `count` slots on different business days (Mon–Fri, non-holiday),
 * rotating through SLOT_TIMES for variety, at least MIN_LEAD_TIME_HOURS ahead,
 * skipping anything that overlaps the client's busy calendar.
 */
export function proposeSlots(now: Date, busy: Interval[] = [], count = 3): Slot[] {
  const earliest = new Date(now.getTime() + MIN_LEAD_TIME_HOURS * 3_600_000);
  const out: Slot[] = [];
  const start = saParts(now);
  for (let offset = 0; offset < 30 && out.length < count; offset++) {
    const dayStart = saDate(start.year, start.month, start.day + offset, 12);
    const p = saParts(dayStart);
    if (p.dow === 0 || p.dow === 6 || isPublicHoliday(dayStart)) continue;
    // Try the rotated preferred time first, then the others on the same day.
    for (let i = 0; i < SLOT_TIMES.length; i++) {
      const [h, m] = SLOT_TIMES[(out.length + i) % SLOT_TIMES.length].split(':').map(Number);
      const s = saDate(p.year, p.month, p.day, h, m);
      const slot: Slot = { startsAt: s, endsAt: new Date(s.getTime() + SLOT_MINUTES * 60_000) };
      if (slot.startsAt < earliest) continue;
      if (busy.some((b) => overlaps(b, { start: slot.startsAt, end: slot.endsAt }))) continue;
      out.push(slot);
      break;
    }
  }
  return out;
}
