// Pilot-pack operations on Postgres: routing, appointment lifecycle, the
// installer's WhatsApp commands, prepaid billing, Paystack top-ups and ad pausing.

import type pg from 'pg';
import { BILLING_DELAY_HOURS, OUTCOME_OVERDUE_DAYS, OUTCOME_REQUEST_DAYS } from '../config.ts';
import type { AdsController } from '../meta.ts';
import type { Payments } from '../paystack.ts';
import type { AppointmentUpdate } from '../store.ts';
import type { Sender } from '../whatsapp.ts';
import { insideServiceWindow } from '../whatsapp.ts';
import { renderTemplate, TEMPLATES } from '../templates.ts';
import type { TemplateKey } from '../templates.ts';

export type Queryable = Pick<pg.Pool, 'query'> | pg.PoolClient;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const rand = (n: number) => `R${Math.round(n).toLocaleString('en-ZA').replace(/ /g, ' ')}`;

// ---------- Jobs ----------

export async function enqueue(
  q: Queryable,
  kind: string,
  runAt: Date,
  refs: { leadId?: string; appointmentId?: string; clientId?: string } = {},
  payload: Record<string, unknown> = {},
): Promise<void> {
  await q.query(
    `insert into jobs (kind, run_at, lead_id, appointment_id, client_id, payload) values ($1, $2, $3, $4, $5, $6)`,
    [kind, runAt, refs.leadId ?? null, refs.appointmentId ?? null, refs.clientId ?? null, JSON.stringify(payload)],
  );
}

/** Transactional outbox: called in the same transaction that inserts the appointment. */
export async function scheduleBookingJobs(
  q: Queryable,
  a: { id: string; leadId: string; clientId: string; startsAt: Date; endsAt: Date },
  now: Date,
): Promise<void> {
  const refs = { leadId: a.leadId, appointmentId: a.id, clientId: a.clientId };
  await enqueue(q, 'installer_brief', now, refs);
  const r24 = new Date(a.startsAt.getTime() - 24 * HOUR);
  if (r24.getTime() > now.getTime() + HOUR) await enqueue(q, 'reminder_24h', r24, refs);
  const r2 = new Date(a.startsAt.getTime() - 2 * HOUR);
  if (r2 > now) await enqueue(q, 'reminder_2h', r2, refs);
  await enqueue(q, 'attendance_check', new Date(a.endsAt.getTime() + HOUR), refs);
  await enqueue(q, 'capi_event', now, refs, { event: 'QualifiedLead' });
}

// ---------- Routing ----------

export interface RouteQuery {
  vertical: string;
  suburb?: string;
  postalCode?: string;
  now: Date;
  requirePrepaid: boolean;
}

/**
 * The installer who holds this vertical + area, is active, is not overdue on
 * outcome reporting, and (if prepaid is required) has credit for one more visit
 * after reserving every booked-but-unbilled visit.
 */
export async function resolveClientSql(q: Queryable, r: RouteQuery): Promise<string | null> {
  if (!r.suburb && !r.postalCode) return null;
  const res = await q.query(
    `select c.id
       from territories t
       join clients c on c.id = t.client_id
       left join client_balance b on b.client_id = c.id
      where c.active and t.vertical = $1
        and (($2::text is not null and $2 = any(t.suburbs)) or ($3::text is not null and $3 = any(t.postal_codes)))
        and not exists (
              select 1 from appointments a
               where a.client_id = c.id and a.status = 'attended'
                 and a.attended_at < $4::timestamptz - make_interval(days => $5::int)
                 and not exists (select 1 from outcomes o where o.appointment_id = a.id))
        and (not $6::boolean or coalesce(b.balance, 0) - c.price_per_appt * (
              select count(*) from appointments a2
               where a2.client_id = c.id and a2.billed_at is null
                 and a2.status in ('scheduled','confirmed','attended')) >= c.price_per_appt)
      order by coalesce(b.balance, 0) desc
      limit 1`,
    [r.vertical, r.suburb ?? null, r.postalCode ?? null, r.now, OUTCOME_OVERDUE_DAYS, r.requirePrepaid],
  );
  return res.rowCount ? res.rows[0].id : null;
}

// ---------- Appointment lifecycle ----------

const TRANSITIONS: Record<string, string[]> = {
  confirmed: ['scheduled'],
  attended: ['scheduled', 'confirmed', 'no_show'], // an installer's WON/LOST overrides a lead's "no"
  no_show: ['scheduled', 'confirmed'],
  cancelled: ['scheduled', 'confirmed'],
};

/** Apply a status change and its follow-up jobs. Returns the new status, or null if the transition is not allowed. */
export async function applyAppointmentStatus(q: Queryable, u: AppointmentUpdate, now: Date): Promise<string | null> {
  const cur = await q.query('select id, status, client_id, lead_id from appointments where id = $1 for update', [u.id]);
  if (!cur.rowCount) return null;
  const a = cur.rows[0];
  if (!TRANSITIONS[u.status]?.includes(a.status)) return null;
  await q.query(
    `update appointments set status = $2::text::appt_status, updated_at = $3,
       attended_at = case when $2::text = 'attended' then $3 else attended_at end,
       attended_confirmed_by = case when $2::text in ('attended','no_show') then $4 else attended_confirmed_by end,
       dispute_reason = coalesce($5, dispute_reason)
     where id = $1`,
    [u.id, u.status, now, u.by, u.reason ?? null],
  );
  if (u.status === 'attended') {
    const refs = { leadId: a.lead_id, appointmentId: a.id, clientId: a.client_id };
    await enqueue(q, 'bill_appointment', new Date(now.getTime() + BILLING_DELAY_HOURS * HOUR), refs);
    for (const [i, d] of OUTCOME_REQUEST_DAYS.entries()) {
      await enqueue(q, 'outcome_request', new Date(now.getTime() + d * DAY), refs, { n: i + 1 });
    }
  }
  return u.status;
}

// ---------- Messaging helper ----------

/** Free text inside WhatsApp's 24h window, otherwise the approved template. */
export async function sendSmart(
  sender: Sender,
  to: string,
  lastInboundAt: Date | null,
  now: Date,
  key: TemplateKey,
  params: string[],
): Promise<void> {
  if (insideServiceWindow(lastInboundAt, now)) await sender.sendText(to, renderTemplate(key, params));
  else await sender.sendTemplate(to, TEMPLATES[key].name, params);
}

// ---------- Installer commands ----------

export type InstallerCommand =
  | { cmd: 'won'; ref: string; amount?: number }
  | { cmd: 'lost'; ref: string; reason?: string }
  | { cmd: 'noshow'; ref: string }
  | { cmd: 'topup'; amount?: number }
  | { cmd: 'balance' }
  | { cmd: 'help' };

export function parseInstallerCommand(text: string): InstallerCommand {
  const t = text.trim().replace(/\s+/g, ' ');
  const ref = '([A-Za-z0-9]{5})';
  let m = t.match(new RegExp(`^won\\s+${ref}(?:\\s+r?\\s*([\\d][\\d,\\s.]*))?`, 'i'));
  if (m) {
    const amount = m[2] ? Number(m[2].replace(/[,\s]/g, '')) : undefined;
    return { cmd: 'won', ref: m[1].toUpperCase(), amount: Number.isFinite(amount) && amount! > 0 ? amount : undefined };
  }
  if ((m = t.match(new RegExp(`^lost\\s+${ref}(?:\\s+(.*))?$`, 'i')))) {
    return { cmd: 'lost', ref: m[1].toUpperCase(), reason: m[2]?.slice(0, 200) };
  }
  if ((m = t.match(new RegExp(`^no\\s?-?show\\s+${ref}`, 'i')))) return { cmd: 'noshow', ref: m[1].toUpperCase() };
  if ((m = t.match(/^top\s?-?up(?:\s+r?\s*([\d][\d,\s]*))?/i))) {
    const amount = m[1] ? Number(m[1].replace(/[,\s]/g, '')) : undefined;
    return { cmd: 'topup', amount: Number.isFinite(amount) && amount! > 0 ? amount : undefined };
  }
  if (/^(balance|bal|credit)\b/i.test(t)) return { cmd: 'balance' };
  return { cmd: 'help' };
}

export const INSTALLER_HELP =
  'Commands:\n' +
  '• WON <ref> <amount>: e.g. WON 7KQ2M 16500\n' +
  '• LOST <ref> <reason>: e.g. LOST 7KQ2M price\n' +
  '• NOSHOW <ref>: nobody was there\n' +
  '• BALANCE: your prepaid credit\n' +
  '• TOPUP <amount>: get a payment link';

export interface ClientRow {
  id: string;
  legal_name: string;
  trading_name: string | null;
  contact_phone: string;
  contact_email: string | null;
  price_per_appt: string;
  expected_weekly_appts: number;
  meta_adset_ids: string[];
  ads_paused: boolean;
  last_inbound_at: Date | null;
}

export interface OpsDeps {
  sender: Sender;
  payments?: Payments;
  ads?: AdsController;
  log?: (msg: string) => void;
}

export class Ops {
  pool: pg.Pool;
  deps: OpsDeps;

  constructor(pool: pg.Pool, deps: OpsDeps) {
    this.pool = pool;
    this.deps = deps;
  }

  private log(msg: string) {
    (this.deps.log ?? console.log)(`[ops] ${msg}`);
  }

  async clientByPhone(phone: string): Promise<ClientRow | null> {
    const r = await this.pool.query('select * from clients where contact_phone = $1 and active', [phone]);
    return r.rowCount ? r.rows[0] : null;
  }

  async client(id: string): Promise<ClientRow> {
    return (await this.pool.query('select * from clients where id = $1', [id])).rows[0];
  }

  /** Balance and how many more visits it covers after reserving booked-but-unbilled ones. */
  async credit(clientId: string): Promise<{ balance: number; reserved: number; available: number; visits: number; price: number }> {
    const r = await this.pool.query(
      `select coalesce(b.balance, 0)::float as balance, c.price_per_appt::float as price,
              (select count(*)::int from appointments a where a.client_id = c.id and a.billed_at is null
                 and a.status in ('scheduled','confirmed','attended')) as open
         from clients c left join client_balance b on b.client_id = c.id where c.id = $1`,
      [clientId],
    );
    const { balance, price, open } = r.rows[0];
    const reserved = open * price;
    const available = balance - reserved;
    return { balance, reserved, available, price, visits: Math.max(0, Math.floor(available / price)) };
  }

  async handleInstallerMessage(client: ClientRow, text: string, now: Date): Promise<string[]> {
    await this.pool.query('update clients set last_inbound_at = $2 where id = $1', [client.id, now]);
    const c = parseInstallerCommand(text);

    if (c.cmd === 'help') return [INSTALLER_HELP];

    if (c.cmd === 'balance') {
      const k = await this.credit(client.id);
      return [
        `Balance: ${rand(k.balance)} (${rand(k.reserved)} reserved for booked visits).\n` +
          `Covers ${k.visits} more visit${k.visits === 1 ? '' : 's'} at ${rand(k.price)} each. Reply TOPUP to add credit.`,
      ];
    }

    if (c.cmd === 'topup') {
      const price = Number(client.price_per_appt);
      const amount = Math.max(price, c.amount ?? price * 10);
      if (!this.deps.payments || !client.contact_email) {
        this.log(`topup requested by ${client.id} for ${amount}: no payment provider or email on file`);
        return [`Thanks! Our team will send you payment details for ${rand(amount)} shortly.`];
      }
      const reference = `topup_${client.id.slice(0, 8)}_${now.getTime()}`;
      const url = await this.deps.payments.createTopupLink({ clientId: client.id, email: client.contact_email, amountZar: amount, reference });
      return [`Here's your secure link to top up ${rand(amount)}:\n${url}\nYour credit updates automatically once paid.`];
    }

    // WON / LOST / NOSHOW: all reference one of this client's appointments.
    const found = await this.pool.query(
      `select a.*, l.ctwa_clid from appointments a join leads l on l.id = a.lead_id where a.client_id = $1 and a.ref = $2`,
      [client.id, c.ref],
    );
    if (!found.rowCount) return [`I couldn't find a booking with reference ${c.ref}. Check the code in the booking message.`];
    const a = found.rows[0];

    if (c.cmd === 'noshow') {
      return this.tx(async (q) => {
        if (a.status === 'no_show') return [`Already recorded: ${c.ref} was a no-show. You won't be billed.`];
        if (a.status === 'disputed') return [`${c.ref} is already under review by our team. You won't be billed while it's open.`];
        if (a.status === 'cancelled') return [`${c.ref} was cancelled, so there's nothing to bill.`];
        if (a.status === 'attended' || a.billed_at) {
          await q.query(`update appointments set status = 'disputed', dispute_reason = $2, updated_at = $3 where id = $1`, [
            a.id,
            a.billed_at ? 'installer_noshow_after_billing' : 'installer_noshow_vs_lead_attended',
            now,
          ]);
          return [`Noted. The customer confirmed attendance for ${c.ref}, so our team will review it and come back to you. You won't be billed while it's under review.`];
        }
        await applyAppointmentStatus(q, { id: a.id, status: 'no_show', by: 'client' }, now);
        return [`Recorded ${c.ref} as a no-show. You won't be billed for it.`];
      });
    }

    const won = c.cmd === 'won';
    return this.tx(async (q) => {
      await q.query(
        `insert into outcomes (appointment_id, won, contract_value, lost_reason, reported_at) values ($1, $2, $3, $4, $5)
         on conflict (appointment_id) do update set won = excluded.won, contract_value = excluded.contract_value,
           lost_reason = excluded.lost_reason, reported_at = excluded.reported_at`,
        [a.id, won, won ? (c.amount ?? null) : null, won ? null : (c.reason ?? null), now],
      );
      if (a.status !== 'attended' && a.status !== 'disputed') {
        await applyAppointmentStatus(q, { id: a.id, status: 'attended', by: 'client' }, now);
      }
      if (won) {
        await enqueue(q, 'capi_event', now, { leadId: a.lead_id, appointmentId: a.id, clientId: client.id }, { event: 'Purchase', value: c.amount ?? null });
      }
      return [
        won
          ? `🎉 Recorded: WON ${c.ref}${c.amount ? ` for ${rand(c.amount)}` : ''}. Thanks! This helps us send you more customers like this one.`
          : `Recorded: LOST ${c.ref}${c.reason ? ` (${c.reason})` : ''}. Thanks, this helps us improve lead quality.`,
      ];
    });
  }

  // ---------- Billing ----------

  /** Debit one attended, undisputed visit. Idempotent. */
  async billAppointment(appointmentId: string, now: Date): Promise<{ status: 'done' | 'skipped'; note: string; clientId?: string }> {
    const res = await this.tx(async (q) => {
      const r = await q.query(
        `select a.id, a.status, a.billed_at, a.client_id, a.ref, c.price_per_appt from appointments a
           join clients c on c.id = a.client_id where a.id = $1 for update of a`,
        [appointmentId],
      );
      if (!r.rowCount) return { status: 'skipped' as const, note: 'appointment not found' };
      const a = r.rows[0];
      if (a.billed_at) return { status: 'skipped' as const, note: 'already billed' };
      if (a.status !== 'attended') return { status: 'skipped' as const, note: `status ${a.status}` };
      await q.query(
        `insert into credit_ledger (client_id, amount_zar, kind, appointment_id, note, created_at)
         values ($1, $2, 'appointment', $3, $4, $5) on conflict do nothing`,
        [a.client_id, -Number(a.price_per_appt), a.id, `visit ${a.ref}`, now],
      );
      await q.query('update appointments set billed_at = $2, updated_at = $2 where id = $1', [a.id, now]);
      return { status: 'done' as const, note: `billed ${rand(Number(a.price_per_appt))}`, clientId: a.client_id as string };
    });
    if (res.status === 'done' && res.clientId) await this.checkCredit(res.clientId, now);
    return res;
  }

  /** Pause ads + notify below one week of expected visits; resume when topped up. */
  async checkCredit(clientId: string, now: Date): Promise<'paused' | 'resumed' | 'unchanged'> {
    const c = await this.client(clientId);
    const k = await this.credit(clientId);
    const threshold = c.expected_weekly_appts * k.price;
    if (k.available < threshold && !c.ads_paused) {
      await this.deps.ads?.pause(c.meta_adset_ids);
      await this.pool.query('update clients set ads_paused = true where id = $1', [clientId]);
      await sendSmart(this.deps.sender, c.contact_phone, c.last_inbound_at, now, 'installer_low_balance', [
        rand(k.available),
        String(k.visits),
        rand(threshold),
      ]);
      this.log(`client ${clientId} below threshold (${k.available} < ${threshold}): ads paused`);
      return 'paused';
    }
    if (k.available >= threshold && c.ads_paused) {
      await this.deps.ads?.resume(c.meta_adset_ids);
      await this.pool.query('update clients set ads_paused = false where id = $1', [clientId]);
      await sendSmart(this.deps.sender, c.contact_phone, c.last_inbound_at, now, 'installer_ads_resumed', [rand(k.available), String(k.visits)]);
      this.log(`client ${clientId} topped up: ads resumed`);
      return 'resumed';
    }
    return 'unchanged';
  }

  /** Paystack `charge.success` (signature already verified). Idempotent on the payment reference. */
  async handlePaystackEvent(evt: any, now: Date): Promise<'credited' | 'duplicate' | 'ignored'> {
    if (evt?.event !== 'charge.success') return 'ignored';
    const d = evt.data ?? {};
    let meta = d.metadata;
    if (typeof meta === 'string') {
      try {
        meta = JSON.parse(meta);
      } catch {
        meta = {};
      }
    }
    const clientId = meta?.client_id;
    if (d.status !== 'success' || d.currency !== 'ZAR' || !clientId || !d.reference) return 'ignored';
    const amount = Number(d.amount) / 100; // Paystack amounts are in cents
    if (!(amount > 0)) return 'ignored';
    const ins = await this.pool.query(
      `insert into credit_ledger (client_id, amount_zar, kind, provider_ref, note, created_at)
       values ($1, $2, 'topup', $3, 'Paystack', $4) on conflict do nothing returning id`,
      [clientId, amount, String(d.reference), now],
    );
    if (!ins.rowCount) return 'duplicate';
    const c = await this.client(clientId);
    const k = await this.credit(clientId);
    await sendSmart(this.deps.sender, c.contact_phone, c.last_inbound_at, now, 'installer_topup_received', [
      rand(amount),
      rand(k.available),
      String(k.visits),
    ]);
    await this.checkCredit(clientId, now);
    return 'credited';
  }

  async tx<T>(fn: (q: pg.PoolClient) => Promise<T>): Promise<T> {
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

