// The qualification agent: a pure state machine.
//   (state, inbound text, context) -> (new state, replies, events)
// Pure = every conversation path is unit-testable without WhatsApp, a DB or an LLM.
// Side effects (sending, storing, consent ledger, booking) are applied by the caller from `events`.

import { BRAND, MAX_FAILED_PARSES, PRIVACY_URL, SCORE_THRESHOLD, TERRITORY } from './config.ts';
import type { Slot } from './booking.ts';
import {
  detectIntent,
  inTerritory,
  parseChoice,
  parsePostalCode,
  parseRand,
  parseYesNo,
  PAYMENT_KEYWORDS,
  TIMELINE_KEYWORDS,
} from './parse.ts';
import { formatSa } from './saTime.ts';

export type Stage =
  | 'new'
  | 'consent'
  | 'homeowner'
  | 'postal'
  | 'bill'
  | 'timeline'
  | 'payment'
  | 'booking'
  | 'booked'
  | 'disqualified'
  | 'opted_out'
  | 'handoff';

export interface Answers {
  homeowner?: boolean;
  postalCode?: string;
  monthlyBill?: number;
  timeline?: number; // 1 ≤1 month · 2 1–3 months · 3 3–6 months · 4 researching
  payment?: number; // 1 cash · 2 finance · 3 unsure
}

export interface ConversationState {
  stage: Stage;
  answers: Answers;
  failedParses: number;
  score?: number;
  offeredSlots?: Slot[];
  booked?: Slot;
  disqualifyReason?: string;
}

export type ConsentPurpose = 'contact_about_enquiry' | 'share_with_installer' | 'marketing';

export type AgentEvent =
  | { type: 'consent'; purpose: ConsentPurpose; granted: boolean; wording: string }
  | { type: 'status'; stage: Stage; reason?: string }
  | { type: 'score'; score: number }
  | { type: 'booked'; slot: Slot }
  | { type: 'handoff'; reason: string }
  | { type: 'erase' };

export interface AgentContext {
  now: Date;
  proposeSlots: (now: Date) => Slot[];
}

export interface AgentResult {
  state: ConversationState;
  replies: string[];
  events: AgentEvent[];
}

export function initialState(): ConversationState {
  return { stage: 'new', answers: {}, failedParses: 0 };
}

// ---------- Copy (kept together so compliance can review one block) ----------

export const INTRO =
  `Hi! This is the ${BRAND} automated assistant 🤖. You enquired about solar / backup power.\n\n` +
  `I'll ask 5 quick questions and, if it's a fit, book a free site visit with ONE vetted installer in your area. ` +
  `Your details are shared only with that installer.\n\n` +
  `Reply YES to continue. Reply STOP at any time to opt out, or DELETE to erase your details. Privacy: ${PRIVACY_URL}`;

export const Q = {
  homeowner: '1/5 · Do you own the property where the system would be installed? (yes / no)',
  postal: '2/5 · What is the 4-digit postal code of the property?',
  bill: '3/5 · Roughly how much is your monthly electricity bill? (e.g. R2500)',
  timeline:
    '4/5 · When would you like it installed?\n1) Within a month\n2) In 1–3 months\n3) In 3–6 months\n4) Just researching for now',
  payment: '5/5 · How are you planning to pay?\n1) Cash / upfront\n2) Finance or monthly instalments\n3) Not sure yet',
} as const;

const REPROMPT: Record<string, string> = {
  consent: 'Sorry, I didn\'t catch that. Reply YES to continue or STOP to opt out.',
  homeowner: 'Just a yes or no please: do you own the property?',
  postal: 'Please send the 4-digit postal code, e.g. 0081.',
  bill: 'Please send an approximate amount in rand, e.g. R3000.',
  timeline: 'Please reply with 1, 2, 3 or 4.',
  payment: 'Please reply with 1, 2 or 3.',
  booking: 'Please reply with the number of the slot that suits you.',
};

// ---------- Scoring v0 (rules; see docs/03-architecture.md §4) ----------

export function scoreLead(a: Answers): number {
  if (a.homeowner !== true) return 0;
  if (!a.postalCode || !inTerritory(a.postalCode)) return 0;
  const bill = a.monthlyBill ?? 0;
  const billPts = bill >= 4000 ? 30 : bill >= 2000 ? 20 : 5;
  const timelinePts = ({ 1: 35, 2: 25, 3: 10, 4: 0 } as Record<number, number>)[a.timeline ?? 4] ?? 0;
  const paymentPts = ({ 1: 25, 2: 20, 3: 10 } as Record<number, number>)[a.payment ?? 3] ?? 0;
  const completion = a.timeline && a.payment ? 10 : 0;
  return Math.min(100, billPts + timelinePts + paymentPts + completion);
}

// ---------- State machine ----------

export function handleMessage(prev: ConversationState, text: string, ctx: AgentContext): AgentResult {
  const state: ConversationState = structuredClone(prev);
  const replies: string[] = [];
  const events: AgentEvent[] = [];
  const go = (stage: Stage, reason?: string) => {
    state.stage = stage;
    state.failedParses = 0;
    events.push({ type: 'status', stage, reason });
  };
  const fail = (stage: string) => {
    state.failedParses += 1;
    if (state.failedParses >= MAX_FAILED_PARSES) {
      go('handoff', 'parse_failures');
      events.push({ type: 'handoff', reason: 'parse_failures' });
      replies.push("No problem. I'll ask a team member to help you right here shortly.");
    } else {
      replies.push(REPROMPT[stage]);
    }
  };
  const done = (): AgentResult => ({ state, replies, events });

  const intent = detectIntent(text);

  // Opted-out leads get nothing back unless they explicitly START again (POPIA s69 / CPA s11).
  if (state.stage === 'opted_out') {
    if (intent === 'start') {
      go('consent');
      replies.push(INTRO);
    }
    return done();
  }

  if (intent === 'stop') {
    for (const purpose of ['contact_about_enquiry', 'share_with_installer', 'marketing'] as const) {
      events.push({ type: 'consent', purpose, granted: false, wording: 'STOP keyword' });
    }
    go('opted_out', 'stop_keyword');
    replies.push("You've been opted out and won't hear from us again. Reply START if you change your mind.");
    return done();
  }
  if (intent === 'delete') {
    events.push({ type: 'erase' });
    go('opted_out', 'erasure_request');
    replies.push('Your details have been deleted from our system. Thank you.');
    return done();
  }

  // A human owns the conversation now; the bot stays silent.
  if (state.stage === 'handoff') return done();

  if (intent === 'human') {
    go('handoff', 'requested_human');
    events.push({ type: 'handoff', reason: 'requested_human' });
    replies.push("Of course. I've asked a team member to take over this chat. They'll reply here shortly.");
    return done();
  }

  switch (state.stage) {
    case 'new': {
      go('consent');
      replies.push(INTRO);
      return done();
    }

    case 'consent': {
      const yes = parseYesNo(text);
      if (yes === true) {
        events.push({ type: 'consent', purpose: 'contact_about_enquiry', granted: true, wording: INTRO });
        events.push({ type: 'consent', purpose: 'share_with_installer', granted: true, wording: INTRO });
        go('homeowner');
        replies.push(Q.homeowner);
      } else if (yes === false) {
        events.push({ type: 'consent', purpose: 'contact_about_enquiry', granted: false, wording: INTRO });
        go('opted_out', 'declined_consent');
        replies.push("No problem. We won't contact you again. Reply START any time if you change your mind.");
      } else fail('consent');
      return done();
    }

    case 'homeowner': {
      const v = parseYesNo(text);
      if (v === null) return (fail('homeowner'), done());
      state.answers.homeowner = v;
      if (!v) {
        state.disqualifyReason = 'not_homeowner';
        go('disqualified', 'not_homeowner');
        replies.push(
          "Thanks for letting me know. Installers need the owner's go-ahead, so if the owner is interested they're welcome to message us directly. 🙏",
        );
      } else {
        go('postal');
        replies.push(Q.postal);
      }
      return done();
    }

    case 'postal': {
      const code = parsePostalCode(text);
      if (!code) return (fail('postal'), done());
      state.answers.postalCode = code;
      if (!inTerritory(code)) {
        state.disqualifyReason = 'out_of_territory';
        go('disqualified', 'out_of_territory');
        replies.push(
          `Thanks! We currently only cover ${TERRITORY.name}, so we can't book a visit for ${code} yet. Sorry about that.`,
        );
      } else {
        go('bill');
        replies.push(Q.bill);
      }
      return done();
    }

    case 'bill': {
      const amount = parseRand(text);
      if (amount === null) return (fail('bill'), done());
      state.answers.monthlyBill = amount;
      go('timeline');
      replies.push(Q.timeline);
      return done();
    }

    case 'timeline': {
      const n = parseChoice(text, 4, TIMELINE_KEYWORDS);
      if (n === null) return (fail('timeline'), done());
      state.answers.timeline = n;
      go('payment');
      replies.push(Q.payment);
      return done();
    }

    case 'payment': {
      const n = parseChoice(text, 3, PAYMENT_KEYWORDS);
      if (n === null) return (fail('payment'), done());
      state.answers.payment = n;
      const score = scoreLead(state.answers);
      state.score = score;
      events.push({ type: 'score', score });
      if (score < SCORE_THRESHOLD) {
        state.disqualifyReason = 'low_score';
        go('disqualified', 'low_score');
        replies.push(
          "Thanks, that's really helpful! Our installers are currently booking homeowners who are ready within the next few months. " +
            "When you're closer to deciding, just message us here and we'll pick it up straight away. ☀️",
        );
        return done();
      }
      return offerSlots(state, replies, events, ctx, go);
    }

    case 'booking': {
      const offered = state.offeredSlots ?? [];
      const n = parseChoice(text, offered.length + 1, [[/\b(none|neither|other|different)\b/, offered.length + 1]]);
      if (n === null) return (fail('booking'), done());
      if (n === offered.length + 1) {
        go('handoff', 'no_suitable_slot');
        events.push({ type: 'handoff', reason: 'no_suitable_slot' });
        replies.push("No problem. A team member will message you here to find a time that works.");
        return done();
      }
      const slot = offered[n - 1];
      state.booked = slot;
      state.offeredSlots = undefined;
      go('booked');
      events.push({ type: 'booked', slot });
      replies.push(
        `✅ Booked: free site visit on ${formatSa(slot.startsAt)}.\n` +
          `The installer's name and photo will follow before the visit, and I'll send a reminder the day before.\n` +
          `Reply RESCHEDULE if you need a different time.`,
      );
      return done();
    }

    case 'booked': {
      if (intent === 'reschedule') return offerSlots(state, replies, events, ctx, go);
      replies.push(
        `Your visit is booked for ${formatSa(state.booked!.startsAt)}. Reply RESCHEDULE to change it, or ask for a person anytime.`,
      );
      return done();
    }

    case 'disqualified': {
      replies.push("Thanks for your message. A team member will take a look and reply if we can help.");
      events.push({ type: 'handoff', reason: 'disqualified_lead_replied' });
      return done();
    }
  }
  return done();
}

function offerSlots(
  state: ConversationState,
  replies: string[],
  events: AgentEvent[],
  ctx: AgentContext,
  go: (s: Stage, r?: string) => void,
): AgentResult {
  const slots = ctx.proposeSlots(ctx.now);
  if (slots.length === 0) {
    go('handoff', 'no_availability');
    events.push({ type: 'handoff', reason: 'no_availability' });
    replies.push("Great news, you qualify! A team member will message you here shortly to book your visit.");
    return { state, replies, events };
  }
  state.offeredSlots = slots;
  go('booking');
  const lines = slots.map((s, i) => `${i + 1}) ${formatSa(s.startsAt)}`);
  lines.push(`${slots.length + 1}) None of these work`);
  replies.push(`Great news, you qualify for a free site visit! 🎉 Which time suits you?\n${lines.join('\n')}`);
  return { state, replies, events };
}
