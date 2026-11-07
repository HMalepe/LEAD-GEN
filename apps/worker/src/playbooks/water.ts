// Backup water systems (tanks, pumps, boosters, refills) for Sandton, Bryanston,
// Randburg and surrounds. Launch vertical, see docs/06-niche-research-review.md.

import { BRAND, PRIVACY_URL } from '../config.ts';
import { parseChoice } from '../parse.ts';
import type { Answers, Playbook, Question } from './types.ts';

/** Canonical suburb -> aliases (lowercase). Extend as territories are sold. */
export const SUBURBS: Record<string, string[]> = {
  Sandton: ['sandton', 'sandton central', 'sandton cbd'],
  Sandown: ['sandown'],
  Bryanston: ['bryanston', 'bryanston east', 'bryanston west', 'bryanston ext 3'],
  Morningside: ['morningside', 'morningside manor'],
  Illovo: ['illovo'],
  Rivonia: ['rivonia'],
  Sandhurst: ['sandhurst'],
  'Hyde Park': ['hyde park', 'hydepark'],
  Wendywood: ['wendywood'],
  Randburg: ['randburg', 'randburg central'],
  Ferndale: ['ferndale'],
  Blairgowrie: ['blairgowrie'],
  Northriding: ['northriding', 'north riding'],
  Olivedale: ['olivedale'],
  Bromhof: ['bromhof'],
  Fontainebleau: ['fontainebleau'],
  Robindale: ['robindale'],
  Bordeaux: ['bordeaux'],
};

const ALIAS_INDEX: Array<[string, string]> = Object.entries(SUBURBS).flatMap(([canon, aliases]) =>
  [canon.toLowerCase(), ...aliases].map((a) => [a, canon] as [string, string]),
);

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** Canonical suburb name, 'other' when the person says they're outside, else null. */
export function matchSuburb(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ');
  if (!t) return null;
  if (/^(other|none|outside|elsewhere|not listed)\b/.test(t)) return 'other';
  // Longest alias first so "bryanston east" wins over "bryanston".
  for (const [alias, canon] of [...ALIAS_INDEX].sort((x, y) => y[0].length - x[0].length)) {
    if (new RegExp(`\\b${alias}\\b`).test(t)) return canon;
  }
  // Typo tolerance on each word / word pair (e.g. "bryanstn", "fern dale").
  const words = t.split(' ');
  const grams = [...words, ...words.slice(1).map((w, i) => `${words[i]} ${w}`), ...words.slice(1).map((w, i) => `${words[i]}${w}`)];
  for (const g of grams) {
    if (g.length < 5) continue;
    for (const [alias, canon] of ALIAS_INDEX) if (editDistance(g, alias) <= (alias.length >= 8 ? 2 : 1)) return canon;
  }
  return null;
}

const PROPERTY = ['A house I own', 'A townhouse or complex (body corporate)', 'A business or estate', "I'm renting"];
const NEED = [
  'No or low water now, want a backup system',
  'Planning a backup system',
  'Existing tank or pump needs repair',
  'Just a water refill or delivery',
];
const TIMELINE = ['Today / ASAP', 'This week', 'This month', 'Just researching'];
const BUDGET = ['Under R10,000', 'R10,000 – R20,000', 'Over R20,000 (bigger or multiple tanks)', 'Not sure yet'];

const list = (opts: string[]) => opts.map((o, i) => `${i + 1}) ${o}`).join('\n');

const questions: Question[] = [
  {
    key: 'property',
    prompt: `1/5 · What type of property is it?\n${list(PROPERTY)}`,
    reprompt: 'Please reply with 1, 2, 3 or 4.',
    interpret: { kind: 'choice', options: PROPERTY },
    parse: (t) =>
      parseChoice(t, 4, [
        [/\b(rent\w*|tenant|lease\w*)\b/, 4],
        [/\b(townhouse|complex|body corporate|sectional|cluster|flat|apartment)\b/, 2],
        [/\b(business|office|estate|shop|factory|school|church)\b/, 3],
        [/\b(house|home|own|owner)\b/, 1],
      ]),
    check: (v) =>
      v === 4
        ? {
            outcome: 'disqualify',
            reason: 'renter',
            message:
              "Thanks for letting me know. A backup system needs the owner's go-ahead, so please forward this chat to your landlord or managing agent. We'd be happy to help them. 🙏",
          }
        : null,
  },
  {
    key: 'suburb',
    prompt: '2/5 · Which suburb is the property in? (e.g. Bryanston, Ferndale, Morningside)',
    reprompt:
      "I couldn't match that to a suburb we cover (Sandton, Bryanston, Randburg and surrounds). Please type the suburb name, or reply OTHER if you're outside these areas.",
    interpret: { kind: 'place', allowed: Object.keys(SUBURBS) },
    parse: (t) => matchSuburb(t),
    check: (v) =>
      v === 'other'
        ? {
            outcome: 'disqualify',
            reason: 'out_of_area',
            message:
              "Thanks! We currently only cover Sandton, Bryanston, Randburg and surrounding suburbs, so we can't book a visit there yet. Sorry about that.",
          }
        : null,
  },
  {
    key: 'need',
    prompt: `3/5 · What do you need?\n${list(NEED)}`,
    reprompt: 'Please reply with 1, 2, 3 or 4.',
    interpret: { kind: 'choice', options: NEED },
    parse: (t) =>
      parseChoice(t, 4, [
        [/\b(refill|deliver\w*|bladder|bowser|truck)\b/, 4],
        [/\b(repair|broken|fix|leak\w*|not working|pump (is )?(dead|faulty))\b/, 3],
        [/\b(no water|dry|low pressure|outage|cut|urgent)\b/, 1],
        [/\b(plan\w*|quote|future|install)\b/, 2],
      ]),
    check: (v) =>
      v === 4
        ? {
            outcome: 'handoff',
            reason: 'refill_request',
            message:
              "Got it, a refill or delivery. I'm passing you to our team now to arrange a supplier for your area. They'll reply here shortly. 💧",
          }
        : null,
  },
  {
    key: 'timeline',
    prompt: `4/5 · When do you need it done?\n${list(TIMELINE)}`,
    reprompt: 'Please reply with 1, 2, 3 or 4.',
    interpret: { kind: 'choice', options: TIMELINE },
    parse: (t) =>
      parseChoice(t, 4, [
        [/\b(not now|not yet|research\w*|just looking|browsing|curious|getting prices)\b/, 4],
        [/\b(today|asap|now|urgent|immediately|right away|tomorrow)\b/, 1],
        [/\b(this week|few days|weekend)\b/, 2],
        [/\b(this month|few weeks|next month)\b/, 3],
      ]),
  },
  {
    key: 'budget',
    prompt: `5/5 · Complete tank-and-pump systems typically cost about R15,000–R20,000 installed. What budget are you working with?\n${list(BUDGET)}`,
    reprompt: 'Please reply with 1, 2, 3 or 4.',
    interpret: { kind: 'choice', options: BUDGET },
    parse: (t) =>
      parseChoice(t, 4, [
        [/\b(not sure|unsure|don'?t know|no idea|depends)\b/, 4],
        [/\b(under|less than|below|cheap\w*)\b/, 1],
        [/\b(over|more than|above|big\w*|multiple)\b/, 3],
      ]),
  },
];

const POINTS = {
  property: { 1: 25, 2: 25, 3: 25 } as Record<number, number>,
  need: { 1: 30, 2: 20, 3: 15 } as Record<number, number>,
  timeline: { 1: 30, 2: 25, 3: 15, 4: 0 } as Record<number, number>,
  budget: { 1: 5, 2: 20, 3: 25, 4: 10 } as Record<number, number>,
};

export function scoreWater(a: Answers): number {
  if (!a.suburb || a.suburb === 'other') return 0;
  const n = (k: keyof typeof POINTS) => POINTS[k][Number(a[k])] ?? 0;
  let s = n('property') + n('need') + n('timeline') + n('budget');
  // A sub-R10k budget can't buy a complete system: allow repairs, cap new installs below threshold.
  if (Number(a.budget) === 1 && (a.need === 1 || a.need === 2)) s = Math.min(s, 40);
  return Math.min(100, s);
}

export const water: Playbook = {
  id: 'water',
  vertical: 'water_backup',
  areaLabel: 'Sandton, Bryanston, Randburg and surrounds',
  intro:
    `Hi! This is the ${BRAND} automated assistant 🤖. You asked about backup water (tanks, pumps or refills).\n\n` +
    `I'll ask 5 quick questions and, if it's a fit, book a site visit with ONE vetted installer for your suburb. ` +
    `Your details are shared only with that installer.\n\n` +
    `Reply YES to continue. Reply STOP at any time to opt out, or DELETE to erase your details. Privacy: ${PRIVACY_URL}`,
  questions,
  threshold: 60,
  score: scoreWater,
  location: (a) => ({ suburb: typeof a.suburb === 'string' ? a.suburb : undefined }),
  // Urgent niche: same-day slots, Saturdays included, earliest-first.
  slots: {
    days: [1, 2, 3, 4, 5, 6],
    times: ['08:00', '10:00', '12:00', '14:00', '16:00'],
    minLeadMinutes: 120,
    durationMinutes: 60,
    count: 3,
    spreadDays: false,
  },
  lowScoreMessage:
    "Thanks, that's really helpful! Our installers are currently booking households ready to go ahead soon. " +
    "When you're closer to deciding, or if your water situation changes, just message us here and we'll pick it up straight away. 💧",
  brief: (a: Answers) => {
    const lines = [
      `Property: ${PROPERTY[Number(a.property) - 1] ?? '?'}`,
      `Suburb: ${a.suburb ?? '?'}`,
      `Need: ${NEED[Number(a.need) - 1] ?? '?'}`,
      `Timeline: ${TIMELINE[Number(a.timeline) - 1] ?? '?'}`,
      `Budget: ${BUDGET[Number(a.budget) - 1] ?? '?'}`,
    ];
    if (a.property === 2) lines.push('Note: body corporate — may need trustee approval');
    return lines;
  },
};
