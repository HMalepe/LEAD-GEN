// Durable job runner on the `jobs` table. Multi-instance safe
// (FOR UPDATE SKIP LOCKED), retries with exponential backoff.
//
// Job kinds:
//   installer_brief   -> WhatsApp the installer the booked lead's details
//   reminder_24h      -> remind the lead the day before; a "1"/"2" reply confirms or reschedules
//   reminder_2h       -> "installer is due today"
//   attendance_check  -> ask the lead "did the installer arrive?" (billing evidence)
//   outcome_request   -> ask the installer WON/LOST at +3, +7, +14 days
//   bill_appointment  -> debit prepaid credit 48h after attendance (dispute window)
//   capi_event        -> send QualifiedLead / Purchase to Meta's Conversions API

import type pg from 'pg';
import type { Capi } from '../meta.ts';
import { getPlaybook } from '../playbooks/index.ts';
import { reviveState } from './pgStore.ts';
import { isServiceWindow, nextServiceTime } from '../quietHours.ts';
import { formatSa } from '../saTime.ts';
import type { Sender } from '../whatsapp.ts';
import { Ops, sendSmart } from './ops.ts';

const MAX_ATTEMPTS = 5;

export interface JobRow {
  id: string;
  kind: string;
  run_at: Date;
  attempts: number;
  lead_id: string | null;
  appointment_id: string | null;
  client_id: string | null;
  payload: any;
}

export type JobResult = { status: 'done' | 'skipped'; note?: string } | { status: 'deferred'; runAt: Date; note?: string };

export interface JobDeps {
  pool: pg.Pool;
  ops: Ops;
  sender: Sender;
  capi?: Capi;
  log?: (msg: string) => void;
}

const time = (d: Date) => formatSa(d).split(', ').pop()!;

export class JobRunner {
  deps: JobDeps;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(deps: JobDeps) {
    this.deps = deps;
  }

  start(intervalMs = 15_000, now = () => new Date()): void {
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.tick(now())
        .catch((e) => console.error('[jobs]', e))
        .finally(() => (this.running = false));
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Claim and run every job due at `now`. Returns how many ran. */
  async tick(now: Date, batch = 50): Promise<number> {
    const claimed = await this.deps.pool.query<JobRow>(
      `update jobs set status = 'running', attempts = attempts + 1, updated_at = $1
        where id in (select id from jobs where status = 'queued' and run_at <= $1
                      order by run_at limit $2 for update skip locked)
        returning *`,
      [now, batch],
    );
    for (const job of claimed.rows) {
      try {
        const r = await this.handle(job, now);
        if (r.status === 'deferred') {
          await this.deps.pool.query(`update jobs set status = 'queued', attempts = attempts - 1, run_at = $2, result = $3 where id = $1`, [
            job.id,
            r.runAt,
            r.note ?? 'deferred',
          ]);
        } else {
          await this.deps.pool.query('update jobs set status = $2, result = $3, updated_at = $4 where id = $1', [
            job.id,
            r.status,
            r.note ?? null,
            now,
          ]);
        }
      } catch (e) {
        const msg = (e as Error).message?.slice(0, 500) ?? String(e);
        const failed = job.attempts >= MAX_ATTEMPTS;
        await this.deps.pool.query('update jobs set status = $2, run_at = $3, result = $4, updated_at = $5 where id = $1', [
          job.id,
          failed ? 'failed' : 'queued',
          new Date(now.getTime() + 2 ** job.attempts * 60_000),
          msg,
          now,
        ]);
        (this.deps.log ?? console.error)(`[jobs] ${job.kind} ${job.id} attempt ${job.attempts} failed: ${msg}`);
      }
    }
    return claimed.rowCount ?? 0;
  }

  async handle(job: JobRow, now: Date): Promise<JobResult> {
    switch (job.kind) {
      case 'installer_brief':
        return this.installerBrief(job, now);
      case 'reminder_24h':
      case 'reminder_2h':
      case 'attendance_check':
        return this.leadMessage(job, now);
      case 'outcome_request':
        return this.outcomeRequest(job, now);
      case 'bill_appointment':
        return this.deps.ops.billAppointment(job.appointment_id!, now);
      case 'capi_event':
        return this.capiEvent(job, now);
      default:
        return { status: 'skipped', note: `unknown kind ${job.kind}` };
    }
  }

  /** Appointment + lead + client in one row. */
  private async context(appointmentId: string) {
    const r = await this.deps.pool.query(
      `select a.id, a.ref, a.status, a.starts_at, a.ends_at, a.client_id,
              l.id as lead_id, l.full_name, l.phone_e164, l.status as lead_status, l.erased_at, l.conversation, l.ctwa_clid,
              c.trading_name, c.legal_name, c.contact_phone, c.last_inbound_at as client_last_inbound,
              (select max(m.created_at) from messages m where m.lead_id = l.id and m.direction = 'inbound') as lead_last_inbound,
              (select granted from current_consent cc where cc.lead_id = l.id and cc.purpose = 'share_with_installer') as share_ok,
              (select won from outcomes o where o.appointment_id = a.id) as won
         from appointments a join leads l on l.id = a.lead_id join clients c on c.id = a.client_id
        where a.id = $1`,
      [appointmentId],
    );
    return r.rows[0] ?? null;
  }

  private async installerBrief(job: JobRow, now: Date): Promise<JobResult> {
    const x = await this.context(job.appointment_id!);
    if (!x) return { status: 'skipped', note: 'appointment gone' };
    if (x.erased_at || x.share_ok !== true) return { status: 'skipped', note: 'no consent to share with installer' };
    if (!['scheduled', 'confirmed'].includes(x.status)) return { status: 'skipped', note: `status ${x.status}` };
    const state = reviveState(x.conversation);
    const summary = getPlaybook(state.playbook).brief(state.answers).join('; ');
    await sendSmart(this.deps.sender, x.contact_phone, x.client_last_inbound, now, 'installer_new_booking', [
      x.ref,
      formatSa(new Date(x.starts_at)),
      x.full_name ?? 'Customer',
      x.phone_e164,
      summary,
    ]);
    return { status: 'done' };
  }

  private async leadMessage(job: JobRow, now: Date): Promise<JobResult> {
    const x = await this.context(job.appointment_id!);
    if (!x) return { status: 'skipped', note: 'appointment gone' };
    if (x.erased_at || x.lead_status === 'opted_out') return { status: 'skipped', note: 'lead opted out' };
    if (!['scheduled', 'confirmed'].includes(x.status)) return { status: 'skipped', note: `status ${x.status}` };

    const start = new Date(x.starts_at);
    if (!isServiceWindow(now)) {
      const next = nextServiceTime(now);
      // Reminders are useless after the visit has (nearly) started; attendance checks can wait two days.
      const deadline =
        job.kind === 'attendance_check' ? new Date(start.getTime() + 2 * 86_400_000) : new Date(start.getTime() - 30 * 60_000);
      if (next < deadline) return { status: 'deferred', runAt: next, note: 'outside service window' };
      return { status: 'skipped', note: 'outside service window, too late' };
    }

    const installer = x.trading_name ?? x.legal_name;
    const state = reviveState(x.conversation);
    const area = String(state.answers.suburb ?? state.answers.postalCode ?? '');
    const last = x.lead_last_inbound ? new Date(x.lead_last_inbound) : null;
    if (job.kind === 'reminder_24h') {
      await sendSmart(this.deps.sender, x.phone_e164, last, now, 'reminder_24h', [installer, formatSa(start), area]);
      await this.setPending(x.lead_id, 'confirm');
    } else if (job.kind === 'reminder_2h') {
      await sendSmart(this.deps.sender, x.phone_e164, last, now, 'reminder_2h', [installer, time(start)]);
    } else {
      await sendSmart(this.deps.sender, x.phone_e164, last, now, 'attendance_check', [installer]);
      await this.setPending(x.lead_id, 'attendance');
    }
    return { status: 'done' };
  }

  private async setPending(leadId: string, pending: 'confirm' | 'attendance'): Promise<void> {
    await this.deps.pool.query(`update leads set conversation = jsonb_set(conversation, '{pending}', to_jsonb($2::text)) where id = $1`, [
      leadId,
      pending,
    ]);
  }

  private async outcomeRequest(job: JobRow, now: Date): Promise<JobResult> {
    const x = await this.context(job.appointment_id!);
    if (!x) return { status: 'skipped', note: 'appointment gone' };
    if (x.won !== null) return { status: 'skipped', note: 'outcome already reported' };
    if (x.status !== 'attended') return { status: 'skipped', note: `status ${x.status}` };
    const state = reviveState(x.conversation);
    const area = String(state.answers.suburb ?? state.answers.postalCode ?? '');
    await sendSmart(this.deps.sender, x.contact_phone, x.client_last_inbound, now, 'installer_outcome_request', [
      x.ref,
      area,
      formatSa(new Date(x.starts_at)),
    ]);
    return { status: 'done', note: `request ${job.payload?.n ?? '?'}` };
  }

  private async capiEvent(job: JobRow, now: Date): Promise<JobResult> {
    if (!this.deps.capi) return { status: 'skipped', note: 'Conversions API not configured' };
    const r = await this.deps.pool.query('select ctwa_clid from leads where id = $1', [job.lead_id]);
    const clid = r.rows[0]?.ctwa_clid;
    if (!clid) return { status: 'skipped', note: 'lead not from a Click-to-WhatsApp ad' };
    const name = String(job.payload?.event ?? 'QualifiedLead');
    await this.deps.capi.send({
      eventName: name,
      eventId: `${job.appointment_id ?? job.lead_id}:${name}`,
      eventTime: now,
      ctwaClid: clid,
      value: job.payload?.value ?? null,
    });
    return { status: 'done', note: name };
  }
}
