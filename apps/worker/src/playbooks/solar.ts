// Residential solar / backup power. The original launch thesis, kept as a
// second playbook (Eskom ended load-shedding in 2025–26, so it is now secondary).

import { BRAND, PRIVACY_URL, TERRITORY } from '../config.ts';
import {
  inTerritory,
  parseChoice,
  parsePostalCode,
  parseRand,
  parseYesNo,
  PAYMENT_KEYWORDS,
  TIMELINE_KEYWORDS,
} from '../parse.ts';
import type { Answers, Playbook } from './types.ts';

export function scoreSolar(a: Answers): number {
  if (a.homeowner !== true) return 0;
  if (typeof a.postalCode !== 'string' || !inTerritory(a.postalCode)) return 0;
  const bill = Number(a.monthlyBill ?? 0);
  const billPts = bill >= 4000 ? 30 : bill >= 2000 ? 20 : 5;
  const timelinePts = ({ 1: 35, 2: 25, 3: 10, 4: 0 } as Record<number, number>)[Number(a.timeline ?? 4)] ?? 0;
  const paymentPts = ({ 1: 25, 2: 20, 3: 10 } as Record<number, number>)[Number(a.payment ?? 3)] ?? 0;
  const completion = a.timeline && a.payment ? 10 : 0;
  return Math.min(100, billPts + timelinePts + paymentPts + completion);
}

export const solar: Playbook = {
  id: 'solar',
  vertical: 'solar',
  areaLabel: TERRITORY.name,
  intro:
    `Hi! This is the ${BRAND} automated assistant 🤖. You enquired about solar / backup power.\n\n` +
    `I'll ask 5 quick questions and, if it's a fit, book a free site visit with ONE vetted installer in your area. ` +
    `Your details are shared only with that installer.\n\n` +
    `Reply YES to continue. Reply STOP at any time to opt out, or DELETE to erase your details. Privacy: ${PRIVACY_URL}`,
  questions: [
    {
      key: 'homeowner',
      prompt: '1/5 · Do you own the property where the system would be installed? (yes / no)',
      reprompt: 'Just a yes or no please: do you own the property?',
      interpret: { kind: 'yesno' },
      parse: parseYesNo,
      check: (v) =>
        v === false
          ? {
              outcome: 'disqualify',
              reason: 'not_homeowner',
              message:
                "Thanks for letting me know. Installers need the owner's go-ahead, so if the owner is interested they're welcome to message us directly. 🙏",
            }
          : null,
    },
    {
      key: 'postalCode',
      prompt: '2/5 · What is the 4-digit postal code of the property?',
      reprompt: 'Please send the 4-digit postal code, e.g. 0081.',
      interpret: { kind: 'place', allowed: [] },
      parse: parsePostalCode,
      check: (v) =>
        !inTerritory(String(v))
          ? {
              outcome: 'disqualify',
              reason: 'out_of_territory',
              message: `Thanks! We currently only cover ${TERRITORY.name}, so we can't book a visit for ${v} yet. Sorry about that.`,
            }
          : null,
    },
    {
      key: 'monthlyBill',
      prompt: '3/5 · Roughly how much is your monthly electricity bill? (e.g. R2500)',
      reprompt: 'Please send an approximate amount in rand, e.g. R3000.',
      interpret: { kind: 'amount' },
      parse: parseRand,
    },
    {
      key: 'timeline',
      prompt:
        '4/5 · When would you like it installed?\n1) Within a month\n2) In 1–3 months\n3) In 3–6 months\n4) Just researching for now',
      reprompt: 'Please reply with 1, 2, 3 or 4.',
      interpret: { kind: 'choice', options: ['Within a month', 'In 1–3 months', 'In 3–6 months', 'Just researching'] },
      parse: (t) => parseChoice(t, 4, TIMELINE_KEYWORDS),
    },
    {
      key: 'payment',
      prompt: '5/5 · How are you planning to pay?\n1) Cash / upfront\n2) Finance or monthly instalments\n3) Not sure yet',
      reprompt: 'Please reply with 1, 2 or 3.',
      interpret: { kind: 'choice', options: ['Cash / upfront', 'Finance or monthly instalments', 'Not sure yet'] },
      parse: (t) => parseChoice(t, 3, PAYMENT_KEYWORDS),
    },
  ],
  threshold: 60,
  score: scoreSolar,
  location: (a) => ({ postalCode: typeof a.postalCode === 'string' ? a.postalCode : undefined }),
  slots: {
    days: [1, 2, 3, 4, 5],
    times: ['09:00', '12:00', '15:00'],
    minLeadMinutes: 24 * 60,
    durationMinutes: 90,
    count: 3,
    spreadDays: true,
  },
  lowScoreMessage:
    "Thanks, that's really helpful! Our installers are currently booking homeowners who are ready within the next few months. " +
    "When you're closer to deciding, just message us here and we'll pick it up straight away. ☀️",
  brief: (a) => [
    `Homeowner: ${a.homeowner ? 'yes' : 'no'}`,
    `Postal code: ${a.postalCode ?? '?'}`,
    `Monthly bill: R${a.monthlyBill ?? '?'}`,
    `Timeline option: ${a.timeline ?? '?'}`,
    `Payment option: ${a.payment ?? '?'}`,
  ],
};
