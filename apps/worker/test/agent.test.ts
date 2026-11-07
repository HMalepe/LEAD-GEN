import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleMessage, initialState, scoreLead } from '../src/agent.ts';
import type { AgentContext, ConversationState } from '../src/agent.ts';
import { proposeSlots } from '../src/booking.ts';
import { saDate } from '../src/saTime.ts';

const NOW = saDate(2026, 11, 9, 10, 0); // Monday 9 Nov 2026, 10:00 SAST
const ctx: AgentContext = { now: NOW, proposeSlots: (d) => proposeSlots(d) };

function run(texts: string[], start: ConversationState = initialState()) {
  let state = start;
  const replies: string[] = [];
  const events: any[] = [];
  for (const t of texts) {
    const r = handleMessage(state, t, ctx);
    state = r.state;
    replies.push(...r.replies);
    events.push(...r.events);
  }
  return { state, replies, events };
}

test('happy path: qualifies, books, records consent', () => {
  const r = run(['Hi, saw your ad', 'yes', 'Yes I own it', '0081', 'about R3 500', '2', 'finance', '1']);
  assert.equal(r.state.stage, 'booked');
  assert.deepEqual(r.state.answers, { homeowner: true, postalCode: '0081', monthlyBill: 3500, timeline: 2, payment: 2 });
  assert.equal(r.state.score, 75);
  const consents = r.events.filter((e) => e.type === 'consent');
  assert.deepEqual(
    consents.map((c) => [c.purpose, c.granted]),
    [
      ['contact_about_enquiry', true],
      ['share_with_installer', true],
    ],
  );
  assert.ok(consents[0].wording.includes('STOP'), 'consent wording must include opt-out');
  const booked = r.events.find((e) => e.type === 'booked');
  assert.ok(booked.slot.startsAt.getTime() >= NOW.getTime() + 24 * 3600e3);
  assert.match(r.replies.at(-1)!, /Booked/);
});

test('first reply identifies the bot as automated and offers opt-out', () => {
  const r = run(['hello']);
  assert.match(r.replies[0], /automated assistant/);
  assert.match(r.replies[0], /STOP/);
  assert.match(r.replies[0], /DELETE/);
});

test('renter is disqualified politely', () => {
  const r = run(['hi', 'yes', 'no, I rent']);
  assert.equal(r.state.stage, 'disqualified');
  assert.equal(r.state.disqualifyReason, 'not_homeowner');
});

test('out-of-territory postal code is disqualified', () => {
  const r = run(['hi', 'yes', 'yes', '8001']); // Cape Town
  assert.equal(r.state.stage, 'disqualified');
  assert.equal(r.state.disqualifyReason, 'out_of_territory');
});

test('low score (just researching, small bill) is not booked', () => {
  const r = run(['hi', 'yes', 'yes', '2196', 'R1200', '4', '3']);
  assert.equal(r.state.stage, 'disqualified');
  assert.equal(r.state.disqualifyReason, 'low_score');
  assert.ok(!r.events.some((e) => e.type === 'booked'));
});

test('STOP mid-flow opts out of every purpose and silences the bot', () => {
  const r = run(['hi', 'yes', 'STOP']);
  assert.equal(r.state.stage, 'opted_out');
  const withdrawn = r.events.filter((e) => e.type === 'consent' && !e.granted).map((e) => e.purpose);
  assert.deepEqual(withdrawn.sort(), ['contact_about_enquiry', 'marketing', 'share_with_installer']);
  const after = handleMessage(r.state, 'hello?', ctx);
  assert.deepEqual(after.replies, [], 'no messages to an opted-out lead');
  const restart = handleMessage(r.state, 'START', ctx);
  assert.equal(restart.state.stage, 'consent');
});

test('DELETE emits an erase event', () => {
  const r = run(['hi', 'yes', 'yes', 'DELETE']);
  assert.ok(r.events.some((e) => e.type === 'erase'));
  assert.equal(r.state.stage, 'opted_out');
});

test('three unparseable answers hand over to a human, then the bot goes quiet', () => {
  const r = run(['hi', 'yes', 'yes', 'somewhere nice', 'near the mall', 'by the school']);
  assert.equal(r.state.stage, 'handoff');
  assert.ok(r.events.some((e) => e.type === 'handoff' && e.reason === 'parse_failures'));
  assert.deepEqual(handleMessage(r.state, '0081', ctx).replies, []);
});

test('asking for a human hands over immediately', () => {
  const r = run(['hi', 'yes', 'I want to speak to a real person']);
  assert.equal(r.state.stage, 'handoff');
});

test('"none of these" slot choice hands over to a human', () => {
  const r = run(['hi', 'yes', 'yes', '0081', 'R5000', '1', 'cash', '4']);
  assert.equal(r.state.stage, 'handoff');
  assert.ok(r.events.some((e) => e.type === 'handoff' && e.reason === 'no_suitable_slot'));
});

test('booked lead can reschedule', () => {
  const r = run(['hi', 'yes', 'yes', '0081', 'R5000', '1', 'cash', '2', 'reschedule']);
  assert.equal(r.state.stage, 'booking');
  assert.equal(r.state.offeredSlots?.length, 3);
});

test('handleMessage does not mutate the previous state', () => {
  const s = initialState();
  const snapshot = structuredClone(s);
  handleMessage(s, 'hi', ctx);
  assert.deepEqual(s, snapshot);
});

test('scoreLead rules', () => {
  assert.equal(scoreLead({ homeowner: false, postalCode: '0081', monthlyBill: 5000, timeline: 1, payment: 1 }), 0);
  assert.equal(scoreLead({ homeowner: true, postalCode: '8001', monthlyBill: 5000, timeline: 1, payment: 1 }), 0);
  assert.equal(scoreLead({ homeowner: true, postalCode: '0081', monthlyBill: 5000, timeline: 1, payment: 1 }), 100);
  assert.equal(scoreLead({ homeowner: true, postalCode: '0081', monthlyBill: 1500, timeline: 4, payment: 3 }), 25);
});
