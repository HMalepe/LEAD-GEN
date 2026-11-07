// Persistence boundary. MemoryStore runs the MVP and the tests; a Postgres
// implementation of the same interface maps 1:1 onto db/schema.sql
// (leads, consents, messages, appointments).

import { createHash } from 'node:crypto';
import { initialState } from './agent.ts';
import type { ConsentPurpose, ConversationState } from './agent.ts';
import type { Slot } from './booking.ts';

export interface ConsentRecord {
  purpose: ConsentPurpose;
  granted: boolean;
  channel: 'whatsapp';
  wording: string;
  evidence: Record<string, unknown>;
  recordedAt: Date;
}

export interface MessageRecord {
  direction: 'inbound' | 'outbound';
  body: string;
  providerId?: string;
  at: Date;
}

export interface LeadRecord {
  key: string; // phone (or sha256 of phone after erasure)
  phone: string | null;
  name: string | null;
  state: ConversationState;
  createdAt: Date;
  firstResponseSeconds?: number;
  consents: ConsentRecord[];
  messages: MessageRecord[];
  appointments: Slot[];
  handoffs: string[];
  erasedAt?: Date;
}

export interface Store {
  /** Returns true the first time a provider message id is seen (idempotency). */
  markProcessed(providerId: string): Promise<boolean>;
  getOrCreateLead(phone: string, name: string | undefined, now: Date): Promise<LeadRecord>;
  save(lead: LeadRecord): Promise<void>;
  erase(lead: LeadRecord, now: Date): Promise<void>;
}

export class MemoryStore implements Store {
  leads = new Map<string, LeadRecord>();
  processed = new Set<string>();

  async markProcessed(providerId: string): Promise<boolean> {
    if (this.processed.has(providerId)) return false;
    this.processed.add(providerId);
    return true;
  }

  async getOrCreateLead(phone: string, name: string | undefined, now: Date): Promise<LeadRecord> {
    const existing = this.leads.get(phone) ?? this.leads.get(hashPhone(phone));
    if (existing) return existing;
    const lead: LeadRecord = {
      key: phone,
      phone,
      name: name ?? null,
      state: initialState(),
      createdAt: now,
      consents: [],
      messages: [],
      appointments: [],
      handoffs: [],
    };
    this.leads.set(phone, lead);
    return lead;
  }

  async save(lead: LeadRecord): Promise<void> {
    this.leads.set(lead.key, lead);
  }

  /**
   * POPIA s24 erasure: drop PII and message bodies, keep a hashed key and the
   * opt-out record so we can still honour "never contact again".
   */
  async erase(lead: LeadRecord, now: Date): Promise<void> {
    if (lead.phone) this.leads.delete(lead.phone);
    const key = lead.phone ? hashPhone(lead.phone) : lead.key;
    lead.key = key;
    lead.phone = null;
    lead.name = null;
    lead.state.answers = {};
    lead.messages = [];
    lead.erasedAt = now;
    this.leads.set(key, lead);
  }
}

export function hashPhone(phone: string): string {
  return 'sha256:' + createHash('sha256').update(phone).digest('hex');
}
