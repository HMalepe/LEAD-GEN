import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeSlots } from '../src/booking.ts';
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

test('proposeSlots: business days, >=24h ahead, different days, avoids busy time', () => {
  const now = saDate(2026, 11, 13, 16, 0); // Friday 16:00
  const slots = proposeSlots(now);
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
  const again = proposeSlots(now, busy);
  assert.ok(!again.some((s) => s.startsAt.getTime() === first.startsAt.getTime()));
});
