// A playbook is everything vertical-specific: questions, parsing, area,
// scoring, slot rules and copy. The agent state machine is vertical-agnostic.

import type { SlotRules } from '../booking.ts';

export type AnswerValue = string | number | boolean;
export type Answers = Record<string, AnswerValue>;

/** What the LLM fallback may return for a question (output is always validated by `parse`). */
export type Interpretation =
  | { kind: 'choice'; options: string[] } // canonical answer: "1".."n"
  | { kind: 'yesno' } // canonical: "yes" | "no"
  | { kind: 'amount' } // canonical: "R<digits>"
  | { kind: 'place'; allowed: string[] }; // canonical: one allowed name, or "other"

/** Non-continue outcome of a question check. */
export interface Exit {
  outcome: 'disqualify' | 'handoff';
  reason: string;
  message: string;
}

export interface Question {
  key: string;
  prompt: string;
  reprompt: string;
  parse(text: string): AnswerValue | null;
  interpret: Interpretation;
  /** Return an Exit to stop the flow after this answer, or null to continue. */
  check?(value: AnswerValue, answers: Answers): Exit | null;
}

export interface Playbook {
  id: string;
  vertical: string; // leads.vertical / territories.vertical
  areaLabel: string;
  intro: string;
  questions: Question[];
  threshold: number;
  score(a: Answers): number;
  /** Which answer keys carry the location used for territory routing. */
  location(a: Answers): { suburb?: string; postalCode?: string };
  slots: SlotRules;
  lowScoreMessage: string;
  /** Human-readable summary lines for the installer brief. */
  brief(a: Answers): string[];
}
