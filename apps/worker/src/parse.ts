// Deterministic answer parsers (scoring v0). Free-text understanding via an LLM
// is the next layer; these rules run first because they are free, instant and testable.

import { TERRITORY } from './config.ts';
import type { Territory } from './config.ts';

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

const UNSURE = /\b(not sure|unsure|don'?t know|dunno|maybe)\b/;

export function parseYesNo(text: string): boolean | null {
  const t = norm(text);
  if (UNSURE.test(t)) return null;
  if (/^(no|n|nope|nah|nee|not really)\b/.test(t)) return false;
  if (/\b(rent|rented|renting|tenant|landlord owns)\b/.test(t)) return false;
  if (/^(yes|y|yeah|yep|yup|ja|yebo|sure|ok|okay|correct|definitely|absolutely)\b/.test(t)) return true;
  if (/\b(i own|we own|own it|owner|my house|our house|my home|our home)\b/.test(t)) return true;
  return null;
}

export function parsePostalCode(text: string): string | null {
  const m = norm(text).match(/\b(\d{4})\b/);
  return m ? m[1] : null;
}

export function inTerritory(code: string, territory: Territory = TERRITORY): boolean {
  const n = Number(code);
  return territory.postalRanges.some(([lo, hi]) => n >= lo && n <= hi);
}

/** Parses "R2,500", "2500", "2.5k", "R3k", "about 3 000 a month". Returns rand or null. */
export function parseRand(text: string): number | null {
  let t = norm(text).replace(/(\d)[\s,](?=\d{3}\b)/g, '$1');
  const m = t.match(/(\d+(?:\.\d+)?)\s*(k|thousand)?\b/);
  if (!m) return null;
  const value = Number(m[1]) * (m[2] ? 1000 : 1);
  if (!Number.isFinite(value) || value < 100 || value > 500_000) return null;
  return Math.round(value);
}

/** Numbered choice ("2", "2)", "option 2") or keyword match. */
export function parseChoice(text: string, max: number, keywords: Array<[RegExp, number]> = []): number | null {
  const t = norm(text);
  const m = t.match(/^(?:option\s*)?([1-9])\b/);
  if (m) {
    const n = Number(m[1]);
    return n >= 1 && n <= max ? n : null;
  }
  for (const [re, n] of keywords) if (re.test(t)) return n;
  return null;
}

export const TIMELINE_KEYWORDS: Array<[RegExp, number]> = [
  [/\b(not now|not yet|research\w*|just looking|browsing|curious|getting prices)\b/, 4],
  [/\b(next year|6 months|six months|later)\b/, 3],
  [/\b(asap|now|urgent|this month|immediately|right away)\b/, 1],
  [/\b(few months|couple of months|2 months|3 months|soon)\b/, 2],
];

export const PAYMENT_KEYWORDS: Array<[RegExp, number]> = [
  [UNSURE, 3],
  [/\b(financ\w*|loan|bond|instal\w*|monthly|rent to own)\b/, 2],
  [/\b(cash|pay upfront|savings|eft)\b/, 1],
];

export type Intent = 'stop' | 'delete' | 'human' | 'start' | 'reschedule' | null;

/** Global intents that override whatever question we're on. */
export function detectIntent(text: string): Intent {
  const t = norm(text);
  if (/^(stop|unsubscribe|opt ?out|cancel all|remove me)\b/.test(t)) return 'stop';
  if (/^(delete|delete my (data|details|info))\b/.test(t)) return 'delete';
  if (/^start\b/.test(t)) return 'start';
  if (/^reschedule\b/.test(t)) return 'reschedule';
  if (/\b(human|real person|speak to (someone|a person)|agent|manager|complain\w*|lawyer|attorney|scam|fraud)\b/.test(t)) {
    return 'human';
  }
  return null;
}
