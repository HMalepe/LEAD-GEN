// CPA s12 + Consumer Protection Regulations (reg. 4): no direct-marketing contact
// on Sundays or public holidays; Saturdays only 09:00–13:00; other days only
// 08:00–20:00. We apply it to every *proactive* outbound message (reminders,
// nurture). Replies inside a conversation the consumer started are not gated.

import { isPublicHoliday, saParts } from './saTime.ts';

export function isContactAllowed(d: Date): boolean {
  if (isPublicHoliday(d)) return false;
  const p = saParts(d);
  const mins = p.hour * 60 + p.minute;
  if (p.dow === 0) return false; // Sunday
  if (p.dow === 6) return mins >= 9 * 60 && mins < 13 * 60; // Saturday
  return mins >= 8 * 60 && mins < 20 * 60;
}

const STEP_MS = 15 * 60 * 1000;

/** Earliest moment at or after `d` when proactive contact is allowed (15-minute grid). */
export function nextAllowedTime(d: Date): Date {
  if (isContactAllowed(d)) return d;
  let t = Math.ceil(d.getTime() / STEP_MS) * STEP_MS;
  const limit = d.getTime() + 14 * 86_400_000;
  while (t < limit) {
    const c = new Date(t);
    if (isContactAllowed(c)) return c;
    t += STEP_MS;
  }
  throw new Error('No allowed contact time within 14 days — check holiday config');
}

// ---------- Service messages (reminders, attendance checks, installer briefs) ----------
// Not direct marketing, so CPA s12 hours don't strictly apply, but we still keep
// to a courtesy window so nobody gets a reminder at 05:30.

import { SERVICE_WINDOW } from './config.ts';

export function isServiceWindow(d: Date): boolean {
  const h = saParts(d).hour;
  return h >= SERVICE_WINDOW.startHour && h < SERVICE_WINDOW.endHour;
}

/** Earliest moment at or after `d` inside the service window. */
export function nextServiceTime(d: Date): Date {
  if (isServiceWindow(d)) return d;
  let t = Math.ceil(d.getTime() / STEP_MS) * STEP_MS;
  while (!isServiceWindow(new Date(t))) t += STEP_MS;
  return new Date(t);
}
