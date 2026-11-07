// Postgres implementation of Store, on db/migrations/0001 + 0002.
// Every save is one transaction: lead row + new consents + new messages + new appointments.

import pg from 'pg';
import { initialState } from '../agent.ts';
import type { ConversationState, Stage } from '../agent.ts';
import { hashPhone } from '../store.ts';
import type { LeadRecord, Store } from '../store.ts';

export interface PgStoreOptions {
  vertical?: string; // leads.vertical / territories.vertical
  /** Fallback client when no territory row matches the postal code. */
  defaultClientId?: string;
}

/** Agent stage -> leads.status (the column dashboards and the funnel view read). */
export function statusFor(stage: Stage): string {
  switch (stage) {
    case 'new':
      return 'new';
    case 'booking':
      return 'qualified';
    case 'booked':
      return 'booked';
    case 'disqualified':
      return 'disqualified';
    case 'opted_out':
      return 'opted_out';
    case 'handoff':
      return 'handoff';
    default:
      return 'engaging';
  }
}

/** JSON round-trip loses Date types; restore them on the slot fields. */
export function reviveState(raw: any): ConversationState {
  if (!raw || typeof raw !== 'object' || !raw.stage) return initialState();
  const slot = (s: any) => (s ? { startsAt: new Date(s.startsAt), endsAt: new Date(s.endsAt) } : undefined);
  return {
    ...raw,
    answers: raw.answers ?? {},
    failedParses: raw.failedParses ?? 0,
    offeredSlots: Array.isArray(raw.offeredSlots) ? raw.offeredSlots.map(slot) : undefined,
    booked: slot(raw.booked),
  };
}

export class PgStore implements Store {
  pool: pg.Pool;
  vertical: string;
  defaultClientId?: string;

  constructor(pool: pg.Pool, opts: PgStoreOptions = {}) {
    this.pool = pool;
    this.vertical = opts.vertical ?? 'solar';
    this.defaultClientId = opts.defaultClientId;
  }

  /** Fail fast at startup: a qualified lead must always have an installer to be booked with. */
  async assertRoutable(): Promise<void> {
    if (this.defaultClientId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(this.defaultClientId)) {
        throw new Error(`DEFAULT_CLIENT_ID must be a client UUID, got "${this.defaultClientId}"`);
      }
      const r = await this.pool.query('select 1 from clients where id = $1 and active', [this.defaultClientId]);
      if (!r.rowCount) throw new Error(`DEFAULT_CLIENT_ID ${this.defaultClientId} is not an active client`);
      return;
    }
    const r = await this.pool.query(
      'select 1 from territories t join clients c on c.id = t.client_id where t.vertical = $1 and c.active limit 1',
      [this.vertical],
    );
    if (!r.rowCount) throw new Error(`No active client territory for vertical '${this.vertical}' and no DEFAULT_CLIENT_ID`);
  }

  async markProcessed(providerId: string): Promise<boolean> {
    const r = await this.pool.query(
      'insert into webhook_events (provider_id) values ($1) on conflict do nothing returning provider_id',
      [providerId],
    );
    return r.rowCount === 1;
  }

  async getOrCreateLead(phone: string, name: string | undefined, now: Date): Promise<LeadRecord> {
    const found = await this.pool.query('select * from leads where phone_e164 = any($1) limit 1', [[phone, hashPhone(phone)]]);
    if (found.rowCount) return this.toRecord(found.rows[0]);
    const ins = await this.pool.query(
      `insert into leads (source, vertical, full_name, phone_e164, created_at, updated_at, conversation)
       values ('click_to_whatsapp', $1, $2, $3, $4, $4, $5)
       on conflict (phone_e164) do update set updated_at = leads.updated_at
       returning *`,
      [this.vertical, name ?? null, phone, now, JSON.stringify(initialState())],
    );
    return this.toRecord(ins.rows[0]);
  }

  private toRecord(row: any): LeadRecord {
    const erased = row.erased_at != null;
    return {
      id: row.id,
      key: row.phone_e164,
      phone: erased ? null : row.phone_e164,
      name: row.full_name,
      state: reviveState(row.conversation),
      createdAt: new Date(row.created_at),
      firstResponseSeconds: row.first_response_seconds ?? undefined,
      consents: [],
      messages: [],
      appointments: [],
      handoffs: row.handoffs ?? [],
      erasedAt: erased ? new Date(row.erased_at) : undefined,
    };
  }

  async save(lead: LeadRecord): Promise<void> {
    await this.tx((c) => this.saveIn(c, lead));
  }

  async erase(lead: LeadRecord, now: Date): Promise<void> {
    await this.tx(async (c) => {
      await this.saveIn(c, lead);
      const hashed = lead.phone ? hashPhone(lead.phone) : lead.key;
      lead.state.answers = {};
      await c.query(
        `update leads set phone_e164 = $2, full_name = null, email = null, postal_code = null,
           qualification = '{}'::jsonb, conversation = $3, utm = '{}'::jsonb, erased_at = $4, updated_at = $4
         where id = $1`,
        [lead.id, hashed, JSON.stringify(lead.state), now],
      );
      // Message bodies are PII; consent rows stay as evidence of the opt-out (they hold no PII).
      await c.query('update messages set body = null where lead_id = $1', [lead.id]);
      lead.key = hashed;
      lead.phone = null;
      lead.name = null;
      lead.messages = [];
      lead.erasedAt = now;
    });
  }

  private async saveIn(c: pg.PoolClient, lead: LeadRecord): Promise<void> {
    const s = lead.state;
    let clientId: string | null = null;
    if (lead.appointments.some((a) => !a.id)) clientId = await this.resolveClient(c, s.answers.postalCode);

    await c.query(
      `update leads set status = $2, score = $3, qualification = $4, conversation = $5, postal_code = $6,
         first_response_seconds = coalesce(first_response_seconds, $7), handoffs = $8,
         assigned_client = coalesce($9, assigned_client), updated_at = now()
       where id = $1`,
      [
        lead.id,
        statusFor(s.stage),
        s.score ?? null,
        JSON.stringify(s.answers),
        JSON.stringify(s),
        s.answers.postalCode ?? null,
        lead.firstResponseSeconds ?? null,
        lead.handoffs,
        clientId,
      ],
    );

    for (const k of lead.consents.filter((x) => !x.id)) {
      const r = await c.query(
        `insert into consents (lead_id, purpose, granted, channel, wording, evidence, recorded_at)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [lead.id, k.purpose, k.granted, k.channel, k.wording, JSON.stringify(k.evidence), k.recordedAt],
      );
      k.id = r.rows[0].id;
    }

    for (const m of lead.messages.filter((x) => !x.id)) {
      const r = await c.query(
        `insert into messages (lead_id, channel, direction, body, provider_id, author, created_at)
         values ($1, 'whatsapp', $2, $3, $4, $5, $6) returning id`,
        [lead.id, m.direction, m.body, m.providerId ?? null, m.direction === 'inbound' ? 'lead' : 'agent', m.at],
      );
      m.id = r.rows[0].id;
    }

    for (const a of lead.appointments.filter((x) => !x.id)) {
      if (!clientId) {
        throw new Error(
          `No client for postal code ${s.answers.postalCode ?? '?'}: add a territories row or set DEFAULT_CLIENT_ID`,
        );
      }
      const r = await c.query(
        `insert into appointments (lead_id, client_id, starts_at, ends_at) values ($1, $2, $3, $4) returning id`,
        [lead.id, clientId, a.startsAt, a.endsAt],
      );
      a.id = r.rows[0].id;
      a.clientId = clientId;
    }
  }

  /** Territory routing: the client holding this vertical + postal code, else the default client. */
  private async resolveClient(c: pg.PoolClient, postalCode: string | undefined): Promise<string | null> {
    if (postalCode) {
      const r = await c.query(
        `select t.client_id from territories t join clients cl on cl.id = t.client_id
         where t.vertical = $1 and $2 = any(t.postal_codes) and cl.active limit 1`,
        [this.vertical, postalCode],
      );
      if (r.rowCount) return r.rows[0].client_id;
    }
    return this.defaultClientId ?? null;
  }

  private async tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const out = await fn(c);
      await c.query('commit');
      return out;
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }
}
