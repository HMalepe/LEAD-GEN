// The qualification agent: a pure, vertical-agnostic state machine.
//   (state, inbound text, context) -> (new state, replies, events)
// Everything vertical-specific comes from a Playbook (src/playbooks/).
// Side effects (sending, storing, consent ledger, booking) are applied by the caller from `events`.

import { MAX_FAILED_PARSES } from './config.ts';
import type { Slot } from './booking.ts';
import { detectIntent, parseChoice, parseYesNo } from './parse.ts';
import { getPlaybook } from './playbooks/index.ts';
import type { Answers, Playbook, Question } from './playbooks/types.ts';
import { formatSa } from './saTime.ts';

export type Stage =
  | 'new'
  | 'consent'
  | 'qualifying'
  | 'booking'
  | 'booked'
  | 'disqualified'
  | 'opted_out'
  | 'handoff';

export interface ConversationState {
  playbook: string;
  stage: Stage;
  qIndex: number;
  answers: Answers;
  failedParses: number;
  score?: number;
  offeredSlots?: Slot[];
  booked?: Slot;
  /** Set by the store once the booking is persisted. */
  appointmentId?: string;
  /** Set by scheduled jobs: what a bare "1"/"2" reply means right now. */
  pending?: 'confirm' | 'attendance';
  disqualifyReason?: string;
}

export type ConsentPurpose = 'contact_about_enquiry' | 'share_with_installer' | 'marketing';

export type AgentEvent =
  | { type: 'consent'; purpose: ConsentPurpose; granted: boolean; wording: string }
  | { type: 'status'; stage: Stage; reason?: string }
  | { type: 'score'; score: number; qualified: boolean }
  | { type: 'booked'; slot: Slot }
  | { type: 'confirmed' }
  | { type: 'attendance'; attended: boolean }
  | { type: 'cancelled'; reason: string }
  | { type: 'handoff'; reason: string }
  | { type: 'erase' };

export interface AgentContext {
  now: Date;
  /** Slots for this lead's installer; [] means no installer can take the booking right now. */
  proposeSlots: (now: Date, playbook: Playbook) => Slot[];
}

export interface AgentResult {
  state: ConversationState;
  replies: string[];
  events: AgentEvent[];
}

export function initialState(playbook?: string): ConversationState {
  return { playbook: getPlaybook(playbook).id, stage: 'new', qIndex: 0, answers: {}, failedParses: 0 };
}

/** The question the lead is currently answering, if any (used by the LLM fallback). */
export function currentQuestion(state: ConversationState): Question | null {
  if (state.stage !== 'qualifying') return null;
  return getPlaybook(state.playbook).questions[state.qIndex] ?? null;
}

/** True if the deterministic rules can read `text` in the current state (no LLM needed). */
export function rulesCanRead(state: ConversationState, text: string): boolean {
  if (detectIntent(text)) return true;
  const q = currentQuestion(state);
  return q ? q.parse(text) !== null : true;
}

export function handleMessage(prev: ConversationState, text: string, ctx: AgentContext): AgentResult {
  const state: ConversationState = structuredClone(prev);
  const pb = getPlaybook(state.playbook);
  const replies: string[] = [];
  const events: AgentEvent[] = [];
  const done = (): AgentResult => ({ state, replies, events });
  const go = (stage: Stage, reason?: string) => {
    state.stage = stage;
    state.failedParses = 0;
    events.push({ type: 'status', stage, reason });
  };
  const handoff = (reason: string, message: string) => {
    go('handoff', reason);
    events.push({ type: 'handoff', reason });
    replies.push(message);
  };
  const fail = (reprompt: string) => {
    state.failedParses += 1;
    if (state.failedParses >= MAX_FAILED_PARSES) {
      handoff('parse_failures', "No problem. I'll ask a team member to help you right here shortly.");
    } else replies.push(reprompt);
  };

  const intent = detectIntent(text);

  // Opted-out leads get nothing back unless they explicitly START again (POPIA s69 / CPA s11).
  if (state.stage === 'opted_out') {
    if (intent === 'start') {
      go('consent');
      replies.push(pb.intro);
    }
    return done();
  }
  if (intent === 'stop') {
    for (const purpose of ['contact_about_enquiry', 'share_with_installer', 'marketing'] as const) {
      events.push({ type: 'consent', purpose, granted: false, wording: 'STOP keyword' });
    }
    if (state.appointmentId && state.stage === 'booked') events.push({ type: 'cancelled', reason: 'lead_opted_out' });
    go('opted_out', 'stop_keyword');
    replies.push("You've been opted out and won't hear from us again. Reply START if you change your mind.");
    return done();
  }
  if (intent === 'delete') {
    if (state.appointmentId && state.stage === 'booked') events.push({ type: 'cancelled', reason: 'lead_erased' });
    events.push({ type: 'erase' });
    go('opted_out', 'erasure_request');
    replies.push('Your details have been deleted from our system. Thank you.');
    return done();
  }
  // A human owns the conversation now; the bot stays silent.
  if (state.stage === 'handoff') return done();
  if (intent === 'human') {
    handoff('requested_human', "Of course. I've asked a team member to take over this chat. They'll reply here shortly.");
    return done();
  }

  switch (state.stage) {
    case 'new':
      go('consent');
      replies.push(pb.intro);
      return done();

    case 'consent': {
      const yes = parseYesNo(text);
      if (yes === true) {
        events.push({ type: 'consent', purpose: 'contact_about_enquiry', granted: true, wording: pb.intro });
        events.push({ type: 'consent', purpose: 'share_with_installer', granted: true, wording: pb.intro });
        go('qualifying');
        state.qIndex = 0;
        replies.push(pb.questions[0].prompt);
      } else if (yes === false) {
        events.push({ type: 'consent', purpose: 'contact_about_enquiry', granted: false, wording: pb.intro });
        go('opted_out', 'declined_consent');
        replies.push("No problem. We won't contact you again. Reply START any time if you change your mind.");
      } else fail("Sorry, I didn't catch that. Reply YES to continue or STOP to opt out.");
      return done();
    }

    case 'qualifying': {
      const q = pb.questions[state.qIndex];
      const value = q.parse(text);
      if (value === null) return (fail(q.reprompt), done());
      state.answers[q.key] = value;
      state.failedParses = 0;
      const exit = q.check?.(value, state.answers) ?? null;
      if (exit) {
        if (exit.outcome === 'handoff') handoff(exit.reason, exit.message);
        else {
          state.disqualifyReason = exit.reason;
          go('disqualified', exit.reason);
          replies.push(exit.message);
        }
        return done();
      }
      state.qIndex += 1;
      if (state.qIndex < pb.questions.length) {
        replies.push(pb.questions[state.qIndex].prompt);
        return done();
      }
      const score = pb.score(state.answers);
      state.score = score;
      const qualified = score >= pb.threshold;
      events.push({ type: 'score', score, qualified });
      if (!qualified) {
        state.disqualifyReason = 'low_score';
        go('disqualified', 'low_score');
        replies.push(pb.lowScoreMessage);
        return done();
      }
      return offerSlots(state, pb, replies, events, ctx, go, handoff, 'Great news, you qualify for a site visit! 🎉');
    }

    case 'booking': {
      const offered = state.offeredSlots ?? [];
      const none = offered.length + 1;
      const n = parseChoice(text, none, [[/\b(none|neither|other|different)\b/, none]]);
      if (n === null) return (fail('Please reply with the number of the slot that suits you.'), done());
      if (n === none) {
        handoff('no_suitable_slot', 'No problem. A team member will message you here to find a time that works.');
        return done();
      }
      const slot = offered[n - 1];
      state.booked = slot;
      state.offeredSlots = undefined;
      state.appointmentId = undefined; // the store sets the new id
      state.pending = undefined;
      go('booked');
      events.push({ type: 'booked', slot });
      replies.push(
        `✅ Booked: site visit on ${formatSa(slot.startsAt)}.\n` +
          `Your installer's details will follow, and I'll send a reminder before the visit.\n` +
          `Reply RESCHEDULE if you need a different time.`,
      );
      return done();
    }

    case 'booked': {
      const yn = parseChoice(text, 2, [
        [/^(yes|y|yebo|ja|yeah|confirm\w*|they came|arrived)\b/, 1],
        [/^(no|n|nope|didn'?t|did not|never came)\b/, 2],
      ]);
      if (intent === 'reschedule' || (state.pending === 'confirm' && yn === 2)) {
        events.push({ type: 'cancelled', reason: 'rescheduled' });
        state.pending = undefined;
        return offerSlots(state, pb, replies, events, ctx, go, handoff, 'No problem, let\'s find a new time.');
      }
      if (state.pending === 'confirm' && yn === 1) {
        state.pending = undefined;
        events.push({ type: 'confirmed' });
        replies.push('Thanks, your visit is confirmed. 👍');
        return done();
      }
      if (state.pending === 'attendance' && yn !== null) {
        state.pending = undefined;
        if (yn === 1) {
          events.push({ type: 'attendance', attended: true });
          replies.push("Great, thanks for confirming! Your installer will follow up with a quote. Reply here any time if you need us.");
          return done();
        }
        events.push({ type: 'attendance', attended: false });
        return offerSlots(state, pb, replies, events, ctx, go, handoff, "Sorry about that! Let's get you a new visit.");
      }
      replies.push(
        `Your visit is booked for ${formatSa(state.booked!.startsAt)}. Reply RESCHEDULE to change it, or ask for a person any time.`,
      );
      return done();
    }

    case 'disqualified':
      replies.push('Thanks for your message. A team member will take a look and reply if we can help.');
      events.push({ type: 'handoff', reason: 'disqualified_lead_replied' });
      return done();
  }
  return done();
}

function offerSlots(
  state: ConversationState,
  pb: Playbook,
  replies: string[],
  events: AgentEvent[],
  ctx: AgentContext,
  go: (s: Stage, r?: string) => void,
  handoff: (reason: string, message: string) => void,
  lead: string,
): AgentResult {
  const slots = ctx.proposeSlots(ctx.now, pb);
  if (slots.length === 0) {
    handoff('no_installer_available', `${lead} A team member will message you here shortly to book your visit.`);
    return { state, replies, events };
  }
  state.offeredSlots = slots;
  go('booking');
  const lines = slots.map((s, i) => `${i + 1}) ${formatSa(s.startsAt)}`);
  lines.push(`${slots.length + 1}) None of these work`);
  replies.push(`${lead} Which time suits you?\n${lines.join('\n')}`);
  return { state, replies, events };
}
