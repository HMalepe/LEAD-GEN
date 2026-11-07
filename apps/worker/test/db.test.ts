// Postgres integration tests: the full pilot lifecycle, steps 1–6.
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/leadgen_test npm test
// Skipped when TEST_DATABASE_URL is unset. The database name MUST end in "_test":
// the suite drops and recreates its public schema. All DB tests live in this one
// file because node:test runs files in parallel and they share the database.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { JobRunner } from '../src/db/jobs.ts';
import { migrate } from '../src/db/migrate.ts';
import { Ops, resolveClientSql } from '../src/db/ops.ts';
import { PgStore, reviveState, statusFor } from '../src/db/pgStore.ts';
import type { Interpreter } from '../src/llm.ts';
import { MemoryAdsController, MemoryCapi } from '../src/meta.ts';
import { MemoryPayments, signPaystack } from '../src/paystack.ts';
import { saDate } from '../src/saTime.ts';
import { createApp } from '../src/server.ts';
import { hashPhone } from '../src/store.ts';
import { MemorySender } from '../src/whatsapp.ts';
import type { InboundMessage, Referral } from '../src/whatsapp.ts';

const URL_ = process.env.TEST_DATABASE_URL;
const NOW = saDate(2026, 11, 9, 10, 0); // Monday 10:00 SAST
const H = 3_600_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);
const INSTALLER = '27820000000';
const PAYSTACK_SECRET = 'sk_test_secret';

test('statusFor maps every agent stage onto lead_status', () => {
  assert.equal(statusFor('new'), 'new');
  assert.equal(statusFor('qualifying'), 'engaging');
  assert.equal(statusFor('booking'), 'qualified');
  assert.equal(statusFor('booked'), 'booked');
  assert.equal(statusFor('opted_out'), 'opted_out');
  assert.equal(statusFor('handoff'), 'handoff');
});

test('reviveState restores Dates and upgrades pre-playbook states', () => {
  const s = { stage: 'booking', answers: {}, failedParses: 0, offeredSlots: [{ startsAt: NOW, endsAt: NOW }] };
  const back = reviveState(JSON.parse(JSON.stringify(s)));
  assert.ok(back.offeredSlots![0].startsAt instanceof Date);
  assert.equal(back.playbook, 'solar');
  assert.equal(reviveState({}).stage, 'new');
});

describe('Postgres: pilot lifecycle', { skip: !URL_ && 'TEST_DATABASE_URL not set' }, () => {
  let pool: pg.Pool;
  let clientId: string;
  let n = 0;
  const sender = new MemorySender();
  const payments = new MemoryPayments();
  const ads = new MemoryAdsController();
  const capi = new MemoryCapi();
  let ops: Ops;
  let jobs: JobRunner;
  let clock = NOW;

  const fakeLlm: Interpreter = {
    async interpret(_q, text) {
      return { canonical: /big gate/.test(text) ? '1' : null, model: 'fake-model', tokensIn: 50, tokensOut: 5 };
    },
  };

  const app = () =>
    createApp({
      store: new PgStore(pool), // a fresh store per call simulates a restart
      sender,
      appSecret: 'x',
      verifyToken: 'y',
      now: () => clock,
      ops,
      llm: fakeLlm,
      paystackSecret: PAYSTACK_SECRET,
      onError: (e) => {
        throw e;
      },
    });
  const msg = (from: string, text: string, referral?: Referral): InboundMessage => ({
    id: `wamid.db.${++n}`,
    from,
    timestamp: clock,
    type: 'text',
    text,
    profileName: 'Naledi',
    referral,
  });
  const chat = async (from: string, texts: string[], referral?: Referral) => {
    for (const [i, t] of texts.entries()) await app().processInbound(msg(from, t, i === 0 ? referral : undefined));
  };
  const lastTo = (to: string) => sender.sent.filter((m) => m.to === to).at(-1)!;
  const lead = async (phone: string) => (await pool.query('select * from leads where phone_e164 = $1', [phone])).rows[0];
  const appts = async (leadId: string) =>
    (await pool.query('select * from appointments where lead_id = $1 order by created_at', [leadId])).rows;
  const jobsFor = async (apptId: string) =>
    (await pool.query('select kind, status, result, run_at from jobs where appointment_id = $1 order by run_at, kind', [apptId])).rows;
  const topup = (cid: string, amount: number, ref: string) =>
    pool.query(`insert into credit_ledger (client_id, amount_zar, kind, provider_ref) values ($1, $2, 'topup', $3)`, [cid, amount, ref]);

  before(async () => {
    const dbName = new URL(URL_!).pathname.slice(1);
    assert.ok(dbName.endsWith('_test'), `refusing to reset non-test database "${dbName}"`);
    pool = new pg.Pool({ connectionString: URL_ });
    await pool.query('drop schema public cascade; create schema public;');
    const applied = await migrate(pool, undefined, () => {});
    assert.deepEqual(applied, ['0001_init.sql', '0002_worker_state.sql', '0003_handoff_queue.sql', '0004_pilot_pack.sql']);
    const c = await pool.query(
      `insert into clients (legal_name, trading_name, vertical, contact_name, contact_phone, contact_email, price_per_appt,
                            expected_weekly_appts, meta_adset_ids)
       values ('AquaSafe (Pty) Ltd', 'AquaSafe Plumbing', 'water_backup', 'Sipho', $1, 'sipho@aquasafe.example', 550, 2, '{as_1}')
       returning id`,
      [INSTALLER],
    );
    clientId = c.rows[0].id;
    await pool.query(
      `insert into territories (client_id, vertical, area_name, suburbs) values ($1, 'water_backup', 'Bryanston + Sandton', '{Bryanston,Sandton,Morningside}')`,
      [clientId],
    );
    await topup(clientId, 5000, 'seed-1');
    ops = new Ops(pool, { sender, payments, ads, log: () => {} });
    jobs = new JobRunner({ pool, ops, sender, capi, log: () => {} });
  });

  after(async () => {
    await pool?.end();
  });

  test('migrations are idempotent; startup routing check passes', async () => {
    assert.deepEqual(await migrate(pool, undefined, () => {}), []);
    await new PgStore(pool).assertRoutable();
    await assert.rejects(new PgStore(pool, { defaultClientId: 'abc' }).assertRoutable(), /must be a client UUID/);
  });

  // ---------- The golden path: ad -> qualified -> booked -> reminded -> attended -> won -> billed -> CAPI ----------

  const PHONE = '27831111111';
  let apptId: string;
  let ref: string;

  test('step 3: Click-to-WhatsApp lead is attributed to its ad; booking survives restarts', async () => {
    clock = NOW;
    // Fresh app instance per message = the worker restarting between every message.
    await chat(PHONE, ['Hi', 'yes', 'the place with the big gate', 'Bryanston', '1', 'today', '2', '3'], {
      sourceId: 'ad_777',
      sourceType: 'ad',
      headline: 'Dry taps in Bryanston?',
      ctwaClid: 'clid-abc',
    });
    const l = await lead(PHONE);
    assert.equal(l.status, 'booked');
    assert.equal(l.vertical, 'water_backup');
    assert.equal(l.source, 'click_to_whatsapp');
    assert.equal(l.utm.source_id, 'ad_777');
    assert.equal(l.ctwa_clid, 'clid-abc');
    assert.equal(l.assigned_client, clientId);
    assert.equal(l.score, 100);
    const [a] = await appts(l.id);
    assert.equal(a.client_id, clientId);
    assert.equal(a.starts_at.getTime(), saDate(2026, 11, 9, 16, 0).getTime(), 'third same-day slot');
    assert.match(a.ref, /^[2-9A-HJKMNP-Z]{5}$/);
    apptId = a.id;
    ref = a.ref;
    assert.equal(reviveState(l.conversation).appointmentId, apptId);
  });

  test('step 4: LLM fallback read "the place with the big gate" and its usage was logged', async () => {
    const r = await pool.query(`select model, tokens_in, tokens_out from messages where body like '%big gate%'`);
    assert.deepEqual(r.rows[0], { model: 'fake-model', tokens_in: 50, tokens_out: 5 });
  });

  test('step 1: booking created its jobs in the same transaction (outbox)', async () => {
    const kinds = (await jobsFor(apptId)).map((j) => j.kind);
    // 16:00 visit booked at 10:00: too close for a 24h reminder; 2h reminder at 14:00; attendance check 18:00.
    assert.deepEqual(kinds.sort(), ['attendance_check', 'capi_event', 'installer_brief', 'reminder_2h']);
  });

  test('step 2 + 6: installer brief goes out as a template; QualifiedLead goes to Meta', async () => {
    assert.equal(await jobs.tick(NOW), 2);
    const brief = lastTo(INSTALLER);
    assert.equal(brief.template, 'installer_new_booking', 'installer has not messaged in 24h -> template');
    assert.equal(brief.params![0], ref);
    assert.equal(brief.params![3], PHONE);
    assert.match(brief.params![4], /Suburb: Bryanston/);
    assert.equal(capi.events.length, 1);
    assert.deepEqual(
      { name: capi.events[0].eventName, clid: capi.events[0].ctwaClid, id: capi.events[0].eventId },
      { name: 'QualifiedLead', clid: 'clid-abc', id: `${apptId}:QualifiedLead` },
    );
  });

  test('step 1: 2h reminder is free text (lead messaged within 24h); attendance check sets the pending reply', async () => {
    assert.equal(await jobs.tick(at(4 * H)), 1); // 14:00
    assert.match(lastTo(PHONE).body, /AquaSafe Plumbing is due at your property at 16:00 today/);
    assert.equal(lastTo(PHONE).template, undefined);
    assert.equal(await jobs.tick(at(8 * H)), 1); // 18:00
    assert.match(lastTo(PHONE).body, /Did AquaSafe Plumbing arrive/);
    assert.equal(reviveState((await lead(PHONE)).conversation).pending, 'attendance');
  });

  test('step 1: lead confirms attendance -> attended, billing + outcome requests scheduled', async () => {
    clock = at(8 * H + 5 * 60_000);
    await chat(PHONE, ['yes']);
    const [a] = await appts((await lead(PHONE)).id);
    assert.equal(a.status, 'attended');
    assert.equal(a.attended_confirmed_by, 'lead');
    const kinds = (await jobsFor(apptId)).filter((j) => j.status === 'queued').map((j) => j.kind);
    assert.deepEqual(kinds, ['bill_appointment', 'outcome_request', 'outcome_request', 'outcome_request']);
  });

  test('step 2: installer replies WON with amount -> outcome recorded, Purchase queued', async () => {
    clock = at(20 * H);
    await app().processInbound(msg(INSTALLER, `WON ${ref.toLowerCase()} R17 500`));
    assert.match(lastTo(INSTALLER).body, /WON .* for R17 500/);
    const o = (await pool.query('select won, contract_value from outcomes where appointment_id = $1', [apptId])).rows[0];
    assert.deepEqual({ won: o.won, value: Number(o.contract_value) }, { won: true, value: 17500 });
  });

  test('step 5: visit billed after the 48h dispute window; balance + ledger correct', async () => {
    assert.ok((await jobs.tick(at(30 * H))) >= 1); // CAPI Purchase runs now
    assert.equal(capi.events.at(-1)!.eventName, 'Purchase');
    assert.equal(capi.events.at(-1)!.value, 17500);
    const before = await ops.credit(clientId);
    assert.equal(before.balance, 5000);
    await jobs.tick(at(57 * H)); // 18:05 + 48h
    const [a] = await appts((await lead(PHONE)).id);
    assert.ok(a.billed_at);
    assert.equal((await ops.credit(clientId)).balance, 4450);
    // Re-running billing is a no-op.
    assert.deepEqual(await ops.billAppointment(apptId, at(58 * H)), { status: 'skipped', note: 'already billed' });
    assert.equal((await ops.credit(clientId)).balance, 4450);
  });

  test('step 2: outcome requests are skipped once the installer has reported', async () => {
    await jobs.tick(at(15 * 24 * H));
    const reqs = (await jobsFor(apptId)).filter((j) => j.kind === 'outcome_request');
    assert.deepEqual(new Set(reqs.map((j) => j.status)), new Set(['skipped']));
  });

  test('step 3: ad_performance gives cost per attended visit and revenue per ad', async () => {
    await pool.query(`insert into ad_spend_daily (source_id, day, spend_zar) values ('ad_777', '2026-11-09', 900)`);
    const r = (await pool.query(`select * from ad_performance where source_id = 'ad_777'`)).rows[0];
    assert.equal(Number(r.leads), 1);
    assert.equal(Number(r.attended), 1);
    assert.equal(Number(r.won), 1);
    assert.equal(Number(r.won_value), 17500);
    assert.equal(Number(r.cost_per_attended), 900);
  });

  // ---------- Exceptions ----------

  test('reschedule cancels the old visit; its jobs skip; the new visit gets fresh jobs', async () => {
    clock = NOW;
    const phone = '27832222222';
    await chat(phone, ['Hi', 'yes', '1', 'Sandton', '3', 'this week', '4', '1']);
    const l = await lead(phone);
    const [first] = await appts(l.id);
    await chat(phone, ['RESCHEDULE', '2']);
    const [old, fresh] = await appts(l.id);
    assert.equal(old.id, first.id);
    assert.equal(old.status, 'cancelled');
    assert.equal(fresh.status, 'scheduled');
    await jobs.tick(at(H));
    const oldJobs = await jobsFor(old.id);
    assert.ok(oldJobs.filter((j) => j.kind !== 'capi_event').every((j) => j.status === 'skipped' || j.status === 'queued'));
    assert.equal(oldJobs.find((j) => j.kind === 'installer_brief')!.result, 'status cancelled');
    assert.equal((await jobsFor(fresh.id)).find((j) => j.kind === 'installer_brief')!.status, 'done');
  });

  test('lead says the installer never came -> no-show, never billed', async () => {
    clock = NOW;
    const phone = '27833333333';
    await chat(phone, ['Hi', 'yes', '1', 'Morningside', '1', '1', '3', '1']);
    const l = await lead(phone);
    const [a] = await appts(l.id);
    await pool.query(`update leads set conversation = jsonb_set(conversation, '{pending}', '"attendance"') where id = $1`, [l.id]);
    await chat(phone, ['no']);
    const [after] = await appts(l.id);
    assert.equal(after.status, 'no_show');
    assert.equal((await jobsFor(a.id)).filter((j) => j.kind === 'bill_appointment').length, 0);
    assert.match(lastTo(phone).body, /new visit/);
  });

  test('dispute: lead says attended, installer says NOSHOW -> disputed, billing skipped', async () => {
    clock = NOW;
    const phone = '27834444444';
    await chat(phone, ['Hi', 'yes', '1', 'Bryanston', '1', '1', '2', '1']);
    const l = await lead(phone);
    await pool.query(`update leads set conversation = jsonb_set(conversation, '{pending}', '"attendance"') where id = $1`, [l.id]);
    await chat(phone, ['yes']);
    const [a] = await appts(l.id);
    await app().processInbound(msg(INSTALLER, `NOSHOW ${a.ref}`));
    assert.match(lastTo(INSTALLER).body, /review/);
    assert.equal((await appts(l.id))[0].status, 'disputed');
    const res = await ops.billAppointment(a.id, at(60 * H));
    assert.deepEqual(res, { status: 'skipped', note: 'status disputed' });
  });

  test('reminder outside the 07:00–21:00 courtesy window is deferred, then sent', async () => {
    const [a] = await appts((await lead('27834444444')).id);
    await pool.query(`update appointments set status = 'scheduled' where id = $1`, [a.id]);
    await pool.query(
      `insert into jobs (kind, run_at, appointment_id, lead_id, client_id) select 'reminder_24h', $2, id, lead_id, client_id from appointments where id = $1`,
      [a.id, saDate(2026, 11, 9, 5, 0)],
    );
    await jobs.tick(saDate(2026, 11, 9, 5, 0));
    const j = (await pool.query(`select status, run_at from jobs where appointment_id = $1 and kind = 'reminder_24h'`, [a.id])).rows[0];
    assert.equal(j.status, 'queued');
    assert.equal(new Date(j.run_at).getTime(), saDate(2026, 11, 9, 7, 0).getTime());
    await jobs.tick(saDate(2026, 11, 9, 7, 0));
    assert.match(lastTo('27834444444').body, /Reply 1 to confirm or 2 to reschedule/);
  });

  // ---------- Step 5: prepaid credit, ad pausing, Paystack ----------

  test('installer BALANCE / TOPUP / HELP / unknown ref', async () => {
    clock = at(100 * H);
    await app().processInbound(msg(INSTALLER, 'balance'));
    assert.match(lastTo(INSTALLER).body, /^Balance: R4 450/);
    await app().processInbound(msg(INSTALLER, 'TOPUP 3000'));
    assert.match(lastTo(INSTALLER).body, /https:\/\/checkout\.example\/topup_/);
    assert.deepEqual(
      { amount: payments.links.at(-1)!.amountZar, client: payments.links.at(-1)!.clientId },
      { amount: 3000, client: clientId },
    );
    await app().processInbound(msg(INSTALLER, 'what now?'));
    assert.match(lastTo(INSTALLER).body, /^Commands:/);
    await app().processInbound(msg(INSTALLER, 'WON ZZZZZ 100'));
    assert.match(lastTo(INSTALLER).body, /couldn't find a booking with reference ZZZZZ/);
  });

  test('low credit pauses ads + notifies; a signed Paystack top-up credits once and resumes ads', async () => {
    await pool.query('update clients set expected_weekly_appts = 20 where id = $1', [clientId]); // threshold R11,000
    assert.equal(await ops.checkCredit(clientId, clock), 'paused');
    assert.deepEqual(ads.calls.at(-1), { action: 'pause', ids: ['as_1'] });
    assert.match(lastTo(INSTALLER).body, /Ads pause below R11 000/);

    const a = app();
    await new Promise<void>((r) => a.server.listen(0, r));
    const url = `http://127.0.0.1:${(a.server.address() as AddressInfo).port}/paystack/webhook`;
    const evt = JSON.stringify({
      event: 'charge.success',
      data: { status: 'success', currency: 'ZAR', amount: 1_000_000, reference: 'ps_ref_1', metadata: { client_id: clientId } },
    });
    const post = (body: string, sig: string) =>
      fetch(url, { method: 'POST', headers: { 'x-paystack-signature': sig, 'content-type': 'application/json' }, body });
    try {
      assert.equal((await post(evt, 'bad')).status, 401);
      const ok = await post(evt, signPaystack(evt, PAYSTACK_SECRET));
      assert.deepEqual([ok.status, await ok.text()], [200, 'credited']);
      const dup = await post(evt, signPaystack(evt, PAYSTACK_SECRET));
      assert.equal(await dup.text(), 'duplicate');
    } finally {
      await new Promise((r) => a.server.close(r));
    }
    const k = await ops.credit(clientId);
    assert.ok(k.balance >= 14_000, `balance ${k.balance}`);
    assert.deepEqual(ads.calls.at(-1), { action: 'resume', ids: ['as_1'] });
    assert.equal((await pool.query('select ads_paused from clients where id = $1', [clientId])).rows[0].ads_paused, false);
    await pool.query('update clients set expected_weekly_appts = 2 where id = $1', [clientId]);
  });

  test('routing: no credit or overdue outcomes -> no installer -> qualified lead goes to a human', async () => {
    const c = await pool.query(
      `insert into clients (legal_name, vertical, contact_name, contact_phone, price_per_appt) values ('Broke Plumbing', 'water_backup', 'Thabo', '27829990000', 550) returning id`,
    );
    const broke = c.rows[0].id;
    await pool.query(`insert into territories (client_id, vertical, area_name, suburbs) values ($1, 'water_backup', 'Ferndale', '{Ferndale}')`, [broke]);
    const q = { vertical: 'water_backup', suburb: 'Ferndale', now: clock, requirePrepaid: true };
    assert.equal(await resolveClientSql(pool, q), null, 'no credit');
    assert.equal(await resolveClientSql(pool, { ...q, requirePrepaid: false }), broke, 'prepaid off');

    await topup(broke, 2000, 'seed-broke');
    assert.equal(await resolveClientSql(pool, q), broke, 'credit ok');
    // An attended visit 15 days ago with no outcome reported -> paused for bookings.
    const l = await pool.query(`insert into leads (source, vertical, phone_e164) values ('manual', 'water_backup', '27830000099') returning id`);
    await pool.query(
      `insert into appointments (lead_id, client_id, starts_at, ends_at, status, attended_at, ref)
       values ($1, $2, $3, $4, 'attended', $3, 'OVRDU')`,
      [l.rows[0].id, broke, new Date(clock.getTime() - 15 * 24 * H), new Date(clock.getTime() - 15 * 24 * H + H)],
    );
    assert.equal(await resolveClientSql(pool, q), null, 'overdue outcomes block routing');

    const phone = '27835555555';
    await chat(phone, ['Hi', 'yes', '1', 'Ferndale', '1', '1', '2']);
    const ld = await lead(phone);
    assert.equal(ld.status, 'handoff');
    assert.ok(ld.handoffs.includes('no_installer_available'));
    assert.equal((await appts(ld.id)).length, 0);
  });

  test('DELETE erases PII, cancels nothing it should not, keeps consent evidence, silences the number', async () => {
    const phone = '27836666666';
    await chat(phone, ['Hi', 'yes', '1', 'Sandton', 'DELETE']);
    assert.equal((await pool.query('select 1 from leads where phone_e164 = $1', [phone])).rowCount, 0);
    const l = await lead(hashPhone(phone));
    assert.ok(l.erased_at);
    assert.equal(l.full_name, null);
    assert.deepEqual(l.qualification, {});
    assert.equal(l.status, 'opted_out');
    const bodies = (await pool.query('select count(*)::int as n from messages where lead_id = $1 and body is not null', [l.id])).rows[0];
    assert.equal(bodies.n, 0);
    const consents = (await pool.query('select count(*)::int as n from consents where lead_id = $1', [l.id])).rows[0];
    assert.equal(consents.n, 2);
    const before = sender.sent.length;
    await chat(phone, ['hello again']);
    assert.equal(sender.sent.length, before);
  });

  test('duplicate webhook delivery is processed once', async () => {
    const store = new PgStore(pool);
    assert.equal(await store.markProcessed('wamid.dupe'), true);
    assert.equal(await store.markProcessed('wamid.dupe'), false);
  });
});
