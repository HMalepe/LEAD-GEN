import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentQuestion, handleMessage, initialState, rulesCanRead } from '../src/agent.ts';
import type { AgentContext, ConversationState } from '../src/agent.ts';
import { proposeSlots } from '../src/booking.ts';
import { matchSuburb, scoreWater } from '../src/playbooks/water.ts';
import { scoreSolar } from '../src/playbooks/solar.ts';
import { saDate } from '../src/saTime.ts';

const NOW = saDate(2026, 11, 9, 10, 0); // Monday 9 Nov 2026, 10:00 SAST
const ctx: AgentContext = { now: NOW, proposeSlots: (d, pb) => proposeSlots(d, pb.slots) };
const noInstaller: AgentContext = { now: NOW, proposeSlots: () => [] };

function run(texts: string[], start: ConversationState = initialState('water'), c = ctx) {
  let state = start;
  const replies: string[] = [];
  const events: any[] = [];
  for (const t of texts) {
    const r = handleMessage(state, t, c);
    state = r.state;
    replies.push(...r.replies);
    events.push(...r.events);
  }
  return { state, replies, events };
}

const WATER_HAPPY = ['Hi, saw your ad', 'yes', '1', 'Bryanston', '1', 'today please', '2'];

// ---------- Water (launch playbook) ----------

test('water happy path: qualifies, offers same-day slots, books, records consent', () => {
  const r = run([...WATER_HAPPY, '1']);
  assert.equal(r.state.stage, 'booked');
  assert.deepEqual(r.state.answers, { property: 1, suburb: 'Bryanston', need: 1, timeline: 1, budget: 2 });
  assert.equal(r.state.score, 100);
  const consents = r.events.filter((e) => e.type === 'consent').map((c) => [c.purpose, c.granted]);
  assert.deepEqual(consents, [
    ['contact_about_enquiry', true],
    ['share_with_installer', true],
  ]);
  const booked = r.events.find((e) => e.type === 'booked');
  // Urgent niche: earliest slot is same day (>= 2h ahead), i.e. 12:00 on Monday.
  assert.equal(booked.slot.startsAt.getTime(), saDate(2026, 11, 9, 12, 0).getTime());
  assert.match(r.replies.at(-1)!, /Booked/);
});

test('first reply identifies the bot as automated and offers opt-out', () => {
  const r = run(['hello']);
  assert.match(r.replies[0], /automated assistant/);
  assert.match(r.replies[0], /STOP/);
  assert.match(r.replies[0], /DELETE/);
  assert.match(r.replies[0], /backup water/);
});

test('suburb matching: aliases, typos, outside area', () => {
  assert.equal(matchSuburb('Bryanston East'), 'Bryanston');
  assert.equal(matchSuburb('we are in north riding'), 'Northriding');
  assert.equal(matchSuburb('bryanstn'), 'Bryanston');
  assert.equal(matchSuburb('Fern dale'), 'Ferndale');
  assert.equal(matchSuburb('Morningside Manor, 2191'), 'Morningside');
  assert.equal(matchSuburb('other'), 'other');
  assert.equal(matchSuburb('Soweto'), null);
});

test('renter is disqualified and told to involve the landlord', () => {
  const r = run(['hi', 'yes', "I'm renting"]);
  assert.equal(r.state.stage, 'disqualified');
  assert.equal(r.state.disqualifyReason, 'renter');
  assert.match(r.replies.at(-1)!, /landlord/);
});

test('OTHER suburb is out of area', () => {
  const r = run(['hi', 'yes', '1', 'Soweto', 'other']);
  assert.equal(r.state.stage, 'disqualified');
  assert.equal(r.state.disqualifyReason, 'out_of_area');
});

test('refill request is handed to a human (separate product line)', () => {
  const r = run(['hi', 'yes', '1', 'Ferndale', 'just need a refill']);
  assert.equal(r.state.stage, 'handoff');
  assert.ok(r.events.some((e) => e.type === 'handoff' && e.reason === 'refill_request'));
});

test('water scoring: researching or sub-R10k new installs stay below threshold; repairs qualify', () => {
  assert.ok(scoreWater({ property: 1, suburb: 'Sandton', need: 2, timeline: 4, budget: 4 }) < 60);
  assert.ok(scoreWater({ property: 1, suburb: 'Sandton', need: 1, timeline: 1, budget: 1 }) < 60);
  assert.ok(scoreWater({ property: 1, suburb: 'Sandton', need: 3, timeline: 2, budget: 4 }) >= 60);
  assert.equal(scoreWater({ property: 1, suburb: 'other', need: 1, timeline: 1, budget: 3 }), 0);
});

test('no installer available: qualified lead is handed to a human, never offered dead slots', () => {
  const r = run(WATER_HAPPY, initialState('water'), noInstaller);
  assert.equal(r.state.stage, 'handoff');
  assert.ok(r.events.some((e) => e.type === 'handoff' && e.reason === 'no_installer_available'));
});

test('reminder reply "1" confirms, "2" reschedules (cancels the old visit)', () => {
  const booked = { ...run([...WATER_HAPPY, '1']).state, appointmentId: 'appt-1', pending: 'confirm' as const };
  const yes = handleMessage(booked, '1', ctx);
  assert.ok(yes.events.some((e) => e.type === 'confirmed'));
  assert.equal(yes.state.pending, undefined);
  const no = handleMessage(booked, '2', ctx);
  assert.ok(no.events.some((e) => e.type === 'cancelled'));
  assert.equal(no.state.stage, 'booking');
});

test('attendance check: yes -> attended; no -> no-show + new slots', () => {
  const booked = { ...run([...WATER_HAPPY, '1']).state, appointmentId: 'appt-1', pending: 'attendance' as const };
  const yes = handleMessage(booked, 'yes they came', ctx);
  assert.deepEqual(yes.events.find((e) => e.type === 'attendance'), { type: 'attendance', attended: true });
  const no = handleMessage(booked, '2', ctx);
  assert.deepEqual(no.events.find((e) => e.type === 'attendance'), { type: 'attendance', attended: false });
  assert.equal(no.state.stage, 'booking');
});

test('STOP mid-flow opts out of every purpose and silences the bot', () => {
  const r = run(['hi', 'yes', 'STOP']);
  assert.equal(r.state.stage, 'opted_out');
  const withdrawn = r.events.filter((e) => e.type === 'consent' && !e.granted).map((e) => e.purpose);
  assert.deepEqual(withdrawn.sort(), ['contact_about_enquiry', 'marketing', 'share_with_installer']);
  assert.deepEqual(handleMessage(r.state, 'hello?', ctx).replies, []);
  assert.equal(handleMessage(r.state, 'START', ctx).state.stage, 'consent');
});

test('STOP after booking cancels the visit', () => {
  const booked = { ...run([...WATER_HAPPY, '1']).state, appointmentId: 'appt-1' };
  const r = handleMessage(booked, 'STOP', ctx);
  assert.ok(r.events.some((e) => e.type === 'cancelled' && e.reason === 'lead_opted_out'));
});

test('DELETE emits an erase event', () => {
  const r = run(['hi', 'yes', '1', 'DELETE']);
  assert.ok(r.events.some((e) => e.type === 'erase'));
  assert.equal(r.state.stage, 'opted_out');
});

test('three unreadable answers hand over to a human, then the bot goes quiet', () => {
  const r = run(['hi', 'yes', 'hmm', 'what?', 'eish']);
  assert.equal(r.state.stage, 'handoff');
  assert.ok(r.events.some((e) => e.type === 'handoff' && e.reason === 'parse_failures'));
  assert.deepEqual(handleMessage(r.state, '1', ctx).replies, []);
});

test('rulesCanRead / currentQuestion drive the LLM fallback gate', () => {
  const s = run(['hi', 'yes']).state;
  assert.equal(currentQuestion(s)?.key, 'property');
  assert.equal(rulesCanRead(s, '2'), true);
  assert.equal(rulesCanRead(s, 'eish my bru, we stay by the complex'), true); // keyword "complex"
  assert.equal(rulesCanRead(s, 'the place with the big gate'), false);
  assert.equal(rulesCanRead(s, 'STOP'), true); // intents never go to the LLM
  assert.equal(currentQuestion(initialState('water')), null);
});

test('handleMessage does not mutate the previous state', () => {
  const s = initialState('water');
  const snapshot = structuredClone(s);
  handleMessage(s, 'hi', ctx);
  assert.deepEqual(s, snapshot);
});

// ---------- Solar (second playbook: proves the agent is vertical-agnostic) ----------

test('solar playbook still qualifies and books with next-day+ slots', () => {
  const r = run(['Hi', 'yes', 'Yes I own it', '0081', 'about R3 500', '2', 'finance', '1'], initialState('solar'));
  assert.equal(r.state.stage, 'booked');
  assert.equal(r.state.score, 75);
  const booked = r.events.find((e) => e.type === 'booked');
  assert.ok(booked.slot.startsAt.getTime() >= NOW.getTime() + 24 * 3600e3);
});

test('solar scoring rules', () => {
  assert.equal(scoreSolar({ homeowner: false, postalCode: '0081', monthlyBill: 5000, timeline: 1, payment: 1 }), 0);
  assert.equal(scoreSolar({ homeowner: true, postalCode: '8001', monthlyBill: 5000, timeline: 1, payment: 1 }), 0);
  assert.equal(scoreSolar({ homeowner: true, postalCode: '0081', monthlyBill: 5000, timeline: 1, payment: 1 }), 100);
});
