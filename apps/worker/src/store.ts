// Persistence boundary. MemoryStore runs local dev and fast tests; PgStore
// (db/pgStore.ts) implements the same interface on db/migrations/*.sql.
//
// Append-only collections (consents, messages, appointments) hold the records
// created in this process; a record without `id` has not been persisted yet.

import { createHash } from 'node:crypto';
import { initialState } from './agent.ts';
import type { ConsentPurpose, ConversationState } from './agent.ts';
import type { Slot } from './booking.ts';

export interface ConsentRecord {
  id?: string;
  purpose: ConsentPurpose;
  granted: boolean;
  channel: 'whatsapp';
  wording: string;
  evidence: Record<string, unknown>;
  recordedAt: Date;
}

export interface MessageRecord {
  id?: string;
  direction: 'inbound' | 'outbound';
  body: string;
  providerId?: string;
  at: Date;
}

export interface AppointmentRecord extends Slot {
  id?: string;
  clientId?: string;
}

export interface LeadRecord {
  id?: string;
  key: string; // phone (or sha256 of phone after erasure)
  phone: string | null;
  name: string | null;
  state: ConversationState;
  createdAt: Date;
  firstResponseSeconds?: number;
  consents: ConsentRecord[];
  messages: MessageRecord[];
  appointments: AppointmentRecord[];
  handoffs: string[];
  erasedAt?: Date;
}

export interface Store {
  /** Returns true the first time a provider message id is seen (idempotency). */
  markProcessed(providerId: string): Promise<boolean>;
  getOrCreateLead(phone: string, name: string | undefined, now: Date): Promise<LeadRecord>;
  save(lead: LeadRecord): Promise<void>;
  /** Persist the lead's latest state, then erase its PII (POPIA s24). */
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

  /** Drop PII and message bodies; keep a hashed key and the opt-out so we still never re-contact. */
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
