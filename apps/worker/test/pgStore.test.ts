// Integration tests against a real Postgres.
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/leadgen_test npm test
// Skipped when TEST_DATABASE_URL is unset. The database name MUST end in "_test":
// the suite drops and recreates its public schema.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { migrate } from '../src/db/migrate.ts';
import { PgStore, reviveState, statusFor } from '../src/db/pgStore.ts';
import { createApp } from '../src/server.ts';
import { hashPhone } from '../src/store.ts';
import { saDate } from '../src/saTime.ts';
import { MemorySender } from '../src/whatsapp.ts';
import type { InboundMessage } from '../src/whatsapp.ts';

const URL_ = process.env.TEST_DATABASE_URL;
const NOW = saDate(2026, 11, 9, 10, 0);

test('statusFor maps every agent stage onto lead_status', () => {
  assert.equal(statusFor('new'), 'new');
  assert.equal(statusFor('postal'), 'engaging');
  assert.equal(statusFor('booking'), 'qualified');
  assert.equal(statusFor('booked'), 'booked');
  assert.equal(statusFor('opted_out'), 'opted_out');
  assert.equal(statusFor('handoff'), 'handoff');
});

test('reviveState restores Date objects after a JSON round trip', () => {
  const s = { stage: 'booking', answers: {}, failedParses: 0, offeredSlots: [{ startsAt: NOW, endsAt: NOW }] };
  const back = reviveState(JSON.parse(JSON.stringify(s)));
  assert.ok(back.offeredSlots![0].startsAt instanceof Date);
  assert.equal(back.offeredSlots![0].startsAt.getTime(), NOW.getTime());
  assert.equal(reviveState({}).stage, 'new');
});

describe('PgStore (integration)', { skip: !URL_ && 'TEST_DATABASE_URL not set' }, () => {
  let pool: pg.Pool;
  let clientId: string;
  let n = 0;
  const msg = (from: string, text: string): InboundMessage => ({
    id: `wamid.pg.${++n}`,
    from,
    timestamp: NOW,
    type: 'text',
    text,
    profileName: 'Naledi',
  });

  before(async () => {
    const dbName = new URL(URL_!).pathname.slice(1);
    assert.ok(dbName.endsWith('_test'), `refusing to reset non-test database "${dbName}"`);
    pool = new pg.Pool({ connectionString: URL_ });
    await pool.query('drop schema public cascade; create schema public;');
    const applied = await migrate(pool, undefined, () => {});
    assert.deepEqual(applied, ['0001_init.sql', '0002_worker_state.sql', '0003_handoff_queue.sql']);
    const c = await pool.query(
      `insert into clients (legal_name, vertical, contact_name, contact_phone, price_per_appt, platform_fee)
       values ('Test Solar (Pty) Ltd', 'solar', 'Sipho', '27820000000', 1200, 2500) returning id`,
    );
    clientId = c.rows[0].id;
    await pool.query(
      `insert into territories (client_id, vertical, area_name, postal_codes) values ($1, 'solar', 'Pretoria East', '{0081,0181}')`,
      [clientId],
    );
  });

  after(async () => {
    await pool?.end();
  });

  const appFor = (store: PgStore, sender = new MemorySender()) =>
    createApp({
      store,
      sender,
      appSecret: 'x',
      verifyToken: 'y',
      now: () => NOW,
      onError: (e) => {
        throw e;
      },
    });

  test('migrations are idempotent', async () => {
    assert.deepEqual(await migrate(pool, undefined, () => {}), []);
  });

  test('assertRoutable passes with a territory, fails with an unknown default client', async () => {
    await new PgStore(pool).assertRoutable();
    await assert.rejects(
      new PgStore(pool, { defaultClientId: '00000000-0000-0000-0000-000000000000' }).assertRoutable(),
      /not an active client/,
    );
    await assert.rejects(new PgStore(pool, { defaultClientId: 'abc' }).assertRoutable(), /must be a client UUID/);
  });

  test('full conversation persists lead, consents, messages, appointment; survives a restart', async () => {
    const phone = '27831111111';
    const sender = new MemorySender();
    const first = appFor(new PgStore(pool), sender);
    for (const t of ['Hi', 'yes', 'yes', '0081', 'R4000', '1']) await first.processInbound(msg(phone, t));

    // "Restart": brand-new store + app instance; conversation must resume mid-flow.
    const second = appFor(new PgStore(pool), sender);
    await second.processInbound(msg(phone, 'cash')); // -> offered slots (stored as JSON)
    const third = appFor(new PgStore(pool), sender);
    await third.processInbound(msg(phone, '2')); // -> books using revived slots

    const lead = (await pool.query('select * from leads where phone_e164 = $1', [phone])).rows[0];
    assert.equal(lead.status, 'booked');
    assert.equal(lead.score, 100);
    assert.equal(lead.postal_code, '0081');
    assert.equal(lead.assigned_client, clientId);
    assert.equal(lead.first_response_seconds, 0);
    assert.equal(lead.full_name, 'Naledi');

    const consents = (await pool.query('select purpose, granted from consents where lead_id = $1 order by purpose', [lead.id])).rows;
    assert.deepEqual(consents, [
      { purpose: 'contact_about_enquiry', granted: true },
      { purpose: 'share_with_installer', granted: true },
    ]);
    const msgs = (await pool.query('select direction, count(*)::int as n from messages where lead_id = $1 group by 1 order by 1', [lead.id])).rows;
    assert.deepEqual(msgs, [
      { direction: 'inbound', n: 8 },
      { direction: 'outbound', n: 8 },
    ]);
    const appts = (await pool.query('select client_id, starts_at from appointments where lead_id = $1', [lead.id])).rows;
    assert.equal(appts.length, 1);
    assert.equal(appts[0].client_id, clientId);
    assert.ok(new Date(appts[0].starts_at).getTime() >= NOW.getTime() + 24 * 3600e3);

    const funnel = (await pool.query("select raw_leads, qualified, booked from funnel_daily where vertical = 'solar'")).rows;
    assert.ok(funnel.some((r) => Number(r.booked) >= 1));
    assert.match(sender.sent.at(-1)!.body, /Booked/);
  });

  test('duplicate webhook delivery is processed once', async () => {
    const store = new PgStore(pool);
    assert.equal(await store.markProcessed('wamid.dupe'), true);
    assert.equal(await store.markProcessed('wamid.dupe'), false);
  });

  test('no territory and no default client: booking is not confirmed', async () => {
    const phone = '27832222222';
    const sender = new MemorySender();
    const errors: unknown[] = [];
    const app = createApp({
      store: new PgStore(pool),
      sender,
      appSecret: 'x',
      verifyToken: 'y',
      now: () => NOW,
      onError: (e) => errors.push(e),
    });
    // 2196 is inside the agent's service area but no client holds that territory.
    for (const t of ['Hi', 'yes', 'yes', '2196', 'R4000', '1', 'cash']) await app.processInbound(msg(phone, t));
    await assert.rejects(app.processInbound(msg(phone, '1')), /No client for postal code 2196/);
    assert.ok(!sender.sent.some((m) => /Booked/.test(m.body)), 'never confirm an unrecorded booking');
    const lead = (await pool.query('select status from leads where phone_e164 = $1', [phone])).rows[0];
    assert.equal(lead.status, 'qualified', 'state rolled back to slot offer');
  });

  test('DELETE erases PII in Postgres, keeps consent evidence, and silences a returning number', async () => {
    const phone = '27833333333';
    const sender = new MemorySender();
    const app = appFor(new PgStore(pool), sender);
    for (const t of ['Hi', 'yes', 'yes', '0081', 'DELETE']) await app.processInbound(msg(phone, t));

    assert.equal((await pool.query('select 1 from leads where phone_e164 = $1', [phone])).rowCount, 0);
    const lead = (await pool.query('select * from leads where phone_e164 = $1', [hashPhone(phone)])).rows[0];
    assert.ok(lead.erased_at);
    assert.equal(lead.full_name, null);
    assert.equal(lead.postal_code, null);
    assert.deepEqual(lead.qualification, {});
    assert.equal(lead.status, 'opted_out');
    const bodies = (await pool.query('select count(*)::int as n from messages where lead_id = $1 and body is not null', [lead.id])).rows[0];
    assert.equal(bodies.n, 0);
    const consents = (await pool.query('select count(*)::int as n from consents where lead_id = $1', [lead.id])).rows[0];
    assert.equal(consents.n, 2, 'consent evidence retained');
    assert.match(sender.sent.at(-1)!.body, /deleted/);

    const before = sender.sent.length;
    await appFor(new PgStore(pool), sender).processInbound(msg(phone, 'hello again'));
    assert.equal(sender.sent.length, before, 'erased + opted-out number gets no reply');
  });
});
