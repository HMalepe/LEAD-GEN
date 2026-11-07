import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeSlots } from '../src/booking.ts';
import { water } from '../src/playbooks/water.ts';
import { solar } from '../src/playbooks/solar.ts';
import { isContactAllowed, nextAllowedTime } from '../src/quietHours.ts';
import { easterSunday, publicHolidays, saDate, saParts } from '../src/saTime.ts';

test('Easter dates', () => {
  assert.deepEqual(easterSunday(2026), { month: 4, day: 5 });
  assert.deepEqual(easterSunday(2027), { month: 3, day: 28 });
});

test('SA public holidays incl. Good Friday, Family Day and Sunday substitution', () => {
  const h2026 = publicHolidays(2026);
  assert.ok(h2026.has('2026-04-03'), 'Good Friday 2026');
  assert.ok(h2026.has('2026-04-06'), 'Family Day 2026');
  assert.ok(h2026.has('2026-08-09') && h2026.has('2026-08-10'), "Women's Day on Sunday -> Monday off");
  const h2027 = publicHolidays(2027);
  assert.ok(h2027.has('2027-03-26') && h2027.has('2027-03-29'));
});

test('CPA contact windows', () => {
  assert.equal(isContactAllowed(saDate(2026, 11, 10, 7, 59)), false, 'Tue 07:59');
  assert.equal(isContactAllowed(saDate(2026, 11, 10, 8, 0)), true, 'Tue 08:00');
  assert.equal(isContactAllowed(saDate(2026, 11, 10, 19, 59)), true, 'Tue 19:59');
  assert.equal(isContactAllowed(saDate(2026, 11, 10, 20, 0)), false, 'Tue 20:00');
  assert.equal(isContactAllowed(saDate(2026, 11, 14, 8, 59)), false, 'Sat 08:59');
  assert.equal(isContactAllowed(saDate(2026, 11, 14, 12, 59)), true, 'Sat 12:59');
  assert.equal(isContactAllowed(saDate(2026, 11, 14, 13, 0)), false, 'Sat 13:00');
  assert.equal(isContactAllowed(saDate(2026, 11, 15, 11, 0)), false, 'Sunday');
  assert.equal(isContactAllowed(saDate(2026, 12, 16, 11, 0)), false, 'Day of Reconciliation');
});

test('nextAllowedTime skips the weekend and holidays', () => {
  const sat = saDate(2026, 11, 14, 14, 0);
  assert.equal(nextAllowedTime(sat).getTime(), saDate(2026, 11, 16, 8, 0).getTime(), 'Sat 14:00 -> Mon 08:00');
  const xmasEve = saDate(2026, 12, 24, 21, 0); // Thu night; 25 + 26 are holidays, 26 is a Saturday, 27 Sunday
  assert.equal(nextAllowedTime(xmasEve).getTime(), saDate(2026, 12, 28, 8, 0).getTime());
});

test('proposeSlots (solar rules): business days, >=24h ahead, different days, avoids busy time', () => {
  const now = saDate(2026, 11, 13, 16, 0); // Friday 16:00
  const slots = proposeSlots(now, solar.slots);
  assert.equal(slots.length, 3);
  const days = new Set(slots.map((s) => saParts(s.startsAt).day));
  assert.equal(days.size, 3);
  for (const s of slots) {
    const p = saParts(s.startsAt);
    assert.ok(p.dow >= 1 && p.dow <= 5, 'weekday');
    assert.ok(s.startsAt.getTime() - now.getTime() >= 24 * 3600e3);
  }
  const first = slots[0];
  const busy = [{ start: first.startsAt, end: first.endsAt }];
  const again = proposeSlots(now, solar.slots, busy);
  assert.ok(!again.some((s) => s.startsAt.getTime() === first.startsAt.getTime()));
});

test('proposeSlots (water rules): urgent, earliest-first, Saturdays allowed, no Sundays/holidays', () => {
  // Friday 15:30 -> nothing left today (16:00 is < 2h away) -> Saturday 08:00, 10:00, 12:00
  const sat = proposeSlots(saDate(2026, 11, 13, 15, 30), water.slots);
  assert.deepEqual(
    sat.map((s) => s.startsAt.getTime()),
    [saDate(2026, 11, 14, 8, 0), saDate(2026, 11, 14, 10, 0), saDate(2026, 11, 14, 12, 0)].map((d) => d.getTime()),
  );
  // Saturday evening -> skips Sunday -> Monday morning
  const mon = proposeSlots(saDate(2026, 11, 14, 19, 0), water.slots);
  assert.equal(mon[0].startsAt.getTime(), saDate(2026, 11, 16, 8, 0).getTime());
  // 15 Dec 2026 evening -> 16 Dec is a public holiday -> 17 Dec
  const rec = proposeSlots(saDate(2026, 12, 15, 19, 0), water.slots);
  assert.equal(rec[0].startsAt.getTime(), saDate(2026, 12, 17, 8, 0).getTime());
});
