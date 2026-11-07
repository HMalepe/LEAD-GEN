// Postgres implementation of Store, on db/migrations/*.
// Every save is one transaction: messages + consents + new appointments (with
// their reminder/brief jobs, i.e. a transactional outbox) + status changes + lead row.

import type pg from 'pg';
import { initialState } from '../agent.ts';
import type { ConversationState, Stage } from '../agent.ts';
import { getPlaybook } from '../playbooks/index.ts';
import { hashPhone, newRef } from '../store.ts';
import type { LeadRecord, NewLeadOptions, Store } from '../store.ts';
import { applyAppointmentStatus, resolveClientSql, scheduleBookingJobs } from './ops.ts';

export interface PgStoreOptions {
  /** Fallback client when no territory row matches (e.g. a house account during the pilot). */
  defaultClientId?: string;
  /** Only route to installers with prepaid credit for another visit (default true). */
  requirePrepaid?: boolean;
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

/** JSON round-trip loses Date types; restore them, and upgrade pre-playbook states. */
export function reviveState(raw: any): ConversationState {
  if (!raw || typeof raw !== 'object' || !raw.stage) return initialState();
  const slot = (s: any) => (s ? { startsAt: new Date(s.startsAt), endsAt: new Date(s.endsAt) } : undefined);
  return {
    ...raw,
    playbook: raw.playbook ?? 'solar', // states saved before playbooks existed were solar
    qIndex: raw.qIndex ?? 0,
    answers: raw.answers ?? {},
    failedParses: raw.failedParses ?? 0,
    offeredSlots: Array.isArray(raw.offeredSlots) ? raw.offeredSlots.map(slot) : undefined,
    booked: slot(raw.booked),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PgStore implements Store {
  pool: pg.Pool;
  defaultClientId?: string;
  requirePrepaid: boolean;

  constructor(pool: pg.Pool, opts: PgStoreOptions = {}) {
    this.pool = pool;
    this.defaultClientId = opts.defaultClientId;
    this.requirePrepaid = opts.requirePrepaid ?? true;
  }

  /** Fail fast at startup: a qualified lead must always have somewhere to go. */
  async assertRoutable(): Promise<void> {
    if (this.defaultClientId) {
      if (!UUID.test(this.defaultClientId)) {
        throw new Error(`DEFAULT_CLIENT_ID must be a client UUID, got "${this.defaultClientId}"`);
      }
      const r = await this.pool.query('select 1 from clients where id = $1 and active', [this.defaultClientId]);
      if (!r.rowCount) throw new Error(`DEFAULT_CLIENT_ID ${this.defaultClientId} is not an active client`);
      return;
    }
    const r = await this.pool.query('select 1 from territories t join clients c on c.id = t.client_id where c.active limit 1');
    if (!r.rowCount) throw new Error('No active client territory and no DEFAULT_CLIENT_ID: qualified leads could never be booked');
  }

  async markProcessed(providerId: string): Promise<boolean> {
    const r = await this.pool.query(
      'insert into webhook_events (provider_id) values ($1) on conflict do nothing returning provider_id',
      [providerId],
    );
    return r.rowCount === 1;
  }

  async getOrCreateLead(phone: string, name: string | undefined, now: Date, opts: NewLeadOptions = {}): Promise<LeadRecord> {
    const found = await this.pool.query('select * from leads where phone_e164 = any($1) limit 1', [[phone, hashPhone(phone)]]);
    if (found.rowCount) return this.toRecord(found.rows[0]);
    const state = initialState(opts.playbook);
    const ref = opts.referral;
    const utm = ref
      ? { source_id: ref.sourceId, source_type: ref.sourceType, source_url: ref.sourceUrl, headline: ref.headline }
      : {};
    const ins = await this.pool.query(
      `insert into leads (source, vertical, full_name, phone_e164, created_at, updated_at, conversation, utm, ctwa_clid)
       values ($1, $2, $3, $4, $5, $5, $6, $7, $8)
       on conflict (phone_e164) do update set updated_at = leads.updated_at
       returning *`,
      [
        ref?.sourceType === 'ad' || ref?.ctwaClid ? 'click_to_whatsapp' : 'manual',
        getPlaybook(state.playbook).vertical,
        name ?? null,
        phone,
        now,
        JSON.stringify(state),
        JSON.stringify(JSON.parse(JSON.stringify(utm))), // drop undefined keys
        ref?.ctwaClid ?? null,
      ],
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
      clientId: row.assigned_client,
      consents: [],
      messages: [],
      appointments: [],
      appointmentUpdates: [],
      handoffs: row.handoffs ?? [],
      erasedAt: erased ? new Date(row.erased_at) : undefined,
    };
  }

  async resolveClient(lead: LeadRecord, now: Date): Promise<string | null> {
    const pb = getPlaybook(lead.state.playbook);
    const loc = pb.location(lead.state.answers);
    const id = await resolveClientSql(this.pool, { vertical: pb.vertical, ...loc, now, requirePrepaid: this.requirePrepaid });
    return id ?? this.defaultClientId ?? null;
  }

  async save(lead: LeadRecord, now: Date): Promise<void> {
    await this.tx((c) => this.saveIn(c, lead, now));
  }

  async erase(lead: LeadRecord, now: Date): Promise<void> {
    await this.tx(async (c) => {
      await this.saveIn(c, lead, now);
      const hashed = lead.phone ? hashPhone(lead.phone) : lead.key;
      lead.state.answers = {};
      await c.query(
        `update leads set phone_e164 = $2, full_name = null, email = null, postal_code = null,
           qualification = '{}'::jsonb, conversation = $3, utm = '{}'::jsonb, ctwa_clid = null, erased_at = $4, updated_at = $4
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

  private async saveIn(c: pg.PoolClient, lead: LeadRecord, now: Date): Promise<void> {
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
        `insert into messages (lead_id, channel, direction, body, provider_id, author, model, tokens_in, tokens_out, created_at)
         values ($1, 'whatsapp', $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
        [
          lead.id,
          m.direction,
          m.body,
          m.providerId ?? null,
          m.direction === 'inbound' ? 'lead' : 'agent',
          m.model ?? null,
          m.tokensIn ?? null,
          m.tokensOut ?? null,
          m.at,
        ],
      );
      m.id = r.rows[0].id;
    }

    // Status changes first (a reschedule cancels the old visit before the new one is inserted).
    for (const u of lead.appointmentUpdates.splice(0)) await applyAppointmentStatus(c, u, now);

    for (const a of lead.appointments.filter((x) => !x.id)) {
      const clientId = lead.clientId ?? (await this.resolveClient(lead, now));
      if (!clientId) {
        throw new Error(`No installer available for ${JSON.stringify(getPlaybook(lead.state.playbook).location(lead.state.answers))}`);
      }
      const ref = newRef();
      const r = await c.query(
        `insert into appointments (lead_id, client_id, starts_at, ends_at, ref) values ($1, $2, $3, $4, $5) returning id`,
        [lead.id, clientId, a.startsAt, a.endsAt, ref],
      );
      Object.assign(a, { id: r.rows[0].id, ref, clientId, status: 'scheduled' });
      lead.clientId = clientId;
      lead.state.appointmentId = a.id;
      await scheduleBookingJobs(c, { id: a.id!, leadId: lead.id!, clientId, startsAt: a.startsAt, endsAt: a.endsAt }, now);
    }

    const s = lead.state;
    const loc = getPlaybook(s.playbook).location(s.answers);
    await c.query(
      `update leads set status = $2, score = $3, qualification = $4, conversation = $5, postal_code = $6,
         first_response_seconds = coalesce(first_response_seconds, $7), handoffs = $8,
         assigned_client = coalesce($9, assigned_client), updated_at = $10
       where id = $1`,
      [
        lead.id,
        statusFor(s.stage),
        s.score ?? null,
        JSON.stringify(s.answers),
        JSON.stringify(s),
        loc.postalCode ?? null,
        lead.firstResponseSeconds ?? null,
        lead.handoffs,
        lead.clientId ?? null,
        now,
      ],
    );
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
