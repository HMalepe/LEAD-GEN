// Persistence boundary. MemoryStore runs local dev and fast tests; PgStore
// (db/pgStore.ts) implements the same interface on db/migrations/*.sql and adds
// the pilot-pack operations (jobs, billing, installer loop) in db/ops.ts.
//
// Append-only collections (consents, messages, appointments) hold the records
// created in this process; a record without `id` has not been persisted yet.

import { createHash, randomInt, randomUUID } from 'node:crypto';
import { initialState } from './agent.ts';
import type { ConsentPurpose, ConversationState } from './agent.ts';
import type { Slot } from './booking.ts';
import type { Referral } from './whatsapp.ts';

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
  /** LLM fallback usage for this inbound message, for cost audits. */
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
}

export interface AppointmentRecord extends Slot {
  id?: string;
  ref?: string;
  clientId?: string;
  status?: string;
}

export type AppointmentStatus = 'confirmed' | 'attended' | 'no_show' | 'cancelled';

export interface AppointmentUpdate {
  id: string;
  status: AppointmentStatus;
  by: 'lead' | 'client' | 'system';
  reason?: string;
}

export interface LeadRecord {
  id?: string;
  key: string; // phone (or sha256 of phone after erasure)
  phone: string | null;
  name: string | null;
  state: ConversationState;
  createdAt: Date;
  firstResponseSeconds?: number;
  referral?: Referral;
  /** Installer this lead routes to (resolved before slots are offered). */
  clientId?: string | null;
  consents: ConsentRecord[];
  messages: MessageRecord[];
  appointments: AppointmentRecord[];
  appointmentUpdates: AppointmentUpdate[];
  handoffs: string[];
  /** Set when the lead's score first crossed the threshold in this process (Conversions API). */
  qualifiedAt?: Date;
  erasedAt?: Date;
}

export interface NewLeadOptions {
  referral?: Referral;
  playbook?: string;
}

export interface Store {
  /** Returns true the first time a provider message id is seen (idempotency). */
  markProcessed(providerId: string): Promise<boolean>;
  getOrCreateLead(phone: string, name: string | undefined, now: Date, opts?: NewLeadOptions): Promise<LeadRecord>;
  /** Installer that can take this lead's booking right now, or null. */
  resolveClient(lead: LeadRecord, now: Date): Promise<string | null>;
  save(lead: LeadRecord, now: Date): Promise<void>;
  /** Persist the lead's latest state, then erase its PII (POPIA s24). */
  erase(lead: LeadRecord, now: Date): Promise<void>;
}

const REF_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0/O/1/I/L
export function newRef(): string {
  return Array.from({ length: 5 }, () => REF_ALPHABET[randomInt(REF_ALPHABET.length)]).join('');
}

export function emptyLead(phone: string, name: string | null, now: Date, opts: NewLeadOptions = {}): LeadRecord {
  return {
    key: phone,
    phone,
    name,
    state: initialState(opts.playbook),
    createdAt: now,
    referral: opts.referral,
    consents: [],
    messages: [],
    appointments: [],
    appointmentUpdates: [],
    handoffs: [],
  };
}

export class MemoryStore implements Store {
  leads = new Map<string, LeadRecord>();
  processed = new Set<string>();
  /** Client every lead routes to; null simulates "no installer available". */
  clientId: string | null;

  constructor(clientId: string | null = 'memory-client') {
    this.clientId = clientId;
  }

  async markProcessed(providerId: string): Promise<boolean> {
    if (this.processed.has(providerId)) return false;
    this.processed.add(providerId);
    return true;
  }

  async getOrCreateLead(phone: string, name: string | undefined, now: Date, opts?: NewLeadOptions): Promise<LeadRecord> {
    const existing = this.leads.get(phone) ?? this.leads.get(hashPhone(phone));
    if (existing) return existing;
    const lead = emptyLead(phone, name ?? null, now, opts);
    this.leads.set(phone, lead);
    return lead;
  }

  async resolveClient(): Promise<string | null> {
    return this.clientId;
  }

  async save(lead: LeadRecord): Promise<void> {
    for (const a of lead.appointments) {
      if (a.id) continue;
      a.id = randomUUID();
      a.ref = newRef();
      a.clientId = lead.clientId ?? undefined;
      a.status = 'scheduled';
      lead.state.appointmentId = a.id;
    }
    for (const u of lead.appointmentUpdates.splice(0)) {
      const a = lead.appointments.find((x) => x.id === u.id);
      if (a) a.status = u.status;
    }
    this.leads.set(lead.key, lead);
  }

  /** Drop PII and message bodies; keep a hashed key and the opt-out so we still never re-contact. */
  async erase(lead: LeadRecord, now: Date): Promise<void> {
    await this.save(lead);
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
