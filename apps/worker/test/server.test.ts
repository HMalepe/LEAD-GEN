import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server.ts';
import { hashPhone, MemoryStore } from '../src/store.ts';
import { MemorySender, parseWebhook, signBody, verifySignature } from '../src/whatsapp.ts';
import { saDate } from '../src/saTime.ts';

const SECRET = 'test-app-secret';

function payload(id: string, from: string, body: string, referral?: Record<string, string>) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              contacts: [{ wa_id: from, profile: { name: 'Thabo' } }],
              messages: [{ id, from, timestamp: '1762675200', type: 'text', text: { body }, ...(referral ? { referral } : {}) }],
            },
          },
        ],
      },
    ],
  };
}

async function start() {
  const store = new MemoryStore();
  const sender = new MemorySender();
  const app = createApp({
    store,
    sender,
    appSecret: SECRET,
    verifyToken: 'verify-me',
    now: () => saDate(2026, 11, 9, 10, 0),
    onError: (e) => {
      throw e;
    },
  });
  await new Promise<void>((r) => app.server.listen(0, r));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const post = async (body: unknown, sign = true) => {
    const raw = JSON.stringify(body);
    return fetch(`${base}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(sign ? { 'X-Hub-Signature-256': signBody(raw, SECRET) } : {}) },
      body: raw,
    });
  };
  return { app, store, sender, base, post, close: () => new Promise((r) => app.server.close(r)) };
}

test('signature verification', () => {
  const raw = Buffer.from('{"a":1}');
  assert.equal(verifySignature(raw, signBody(raw, SECRET), SECRET), true);
  assert.equal(verifySignature(raw, signBody(raw, 'wrong'), SECRET), false);
  assert.equal(verifySignature(raw, undefined, SECRET), false);
  assert.equal(verifySignature(raw, 'sha256=zz', SECRET), false);
});

test('parseWebhook ignores status-only payloads', () => {
  const status = { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { statuses: [{ id: 'x' }] } }] }] };
  assert.deepEqual(parseWebhook(status), []);
  const [m] = parseWebhook(payload('wamid.1', '27821234567', 'hi'));
  assert.equal(m.text, 'hi');
  assert.equal(m.profileName, 'Thabo');
});

test('GET /webhook verification handshake', async () => {
  const s = await start();
  try {
    const ok = await fetch(`${s.base}/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), '42');
    const bad = await fetch(`${s.base}/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42`);
    assert.equal(bad.status, 403);
  } finally {
    await s.close();
  }
});

test('unsigned POST is rejected', async () => {
  const s = await start();
  try {
    const res = await s.post(payload('wamid.1', '27821234567', 'hi'), false);
    assert.equal(res.status, 401);
    await s.app.idle();
    assert.equal(s.sender.sent.length, 0);
  } finally {
    await s.close();
  }
});

test('end to end: signed messages drive the conversation; duplicates are ignored', async () => {
  const s = await start();
  const phone = '27821234567';
  try {
    const script = ['Hi', 'yes', '1', 'Bryanston', '1', 'today', '2', '1'];
    for (const [i, text] of script.entries()) {
      const res = await s.post(payload(`wamid.${i}`, phone, text));
      assert.equal(res.status, 200);
      await s.app.idle();
    }
    // Meta re-delivers message 0: must not trigger a second intro.
    await s.post(payload('wamid.0', phone, 'Hi'));
    await s.app.idle();

    const lead = s.store.leads.get(phone)!;
    assert.equal(lead.state.stage, 'booked');
    assert.equal(lead.appointments.length, 1);
    assert.equal(lead.consents.filter((c) => c.granted).length, 2);
    assert.equal(lead.firstResponseSeconds, 0);
    assert.equal(s.sender.sent.filter((m) => /automated assistant/.test(m.body)).length, 1, 'intro sent once');
    assert.equal(s.sender.sent.length, script.length);
  } finally {
    await s.close();
  }
});

test('DELETE erases PII but keeps a hashed opt-out record', async () => {
  const s = await start();
  const phone = '27829999999';
  try {
    for (const [i, text] of ['Hi', 'yes', '1', 'Sandton', 'DELETE'].entries()) {
      await s.post(payload(`wamid.d${i}`, phone, text));
      await s.app.idle();
    }
    assert.equal(s.store.leads.has(phone), false);
    const erased = s.store.leads.get(hashPhone(phone))!;
    assert.equal(erased.phone, null);
    assert.equal(erased.name, null);
    assert.deepEqual(erased.state.answers, {});
    assert.equal(erased.messages.length, 0);
    assert.equal(erased.state.stage, 'opted_out');

    // Returning number is recognised as opted out: no reply.
    const before = s.sender.sent.length;
    await s.post(payload('wamid.d9', phone, 'hello again'));
    await s.app.idle();
    assert.equal(s.sender.sent.length, before);
  } finally {
    await s.close();
  }
});

test('Click-to-WhatsApp referral is parsed and kept on the lead', async () => {
  const [m] = parseWebhook(
    payload('wamid.r1', '27825550000', 'Hi', {
      source_id: '120210000000001',
      source_type: 'ad',
      source_url: 'https://fb.me/x',
      headline: 'Dry taps in Bryanston?',
      ctwa_clid: 'ARAkLkA8rmlFeiCktEJQ',
    }),
  );
  assert.deepEqual(m.referral, {
    sourceId: '120210000000001',
    sourceType: 'ad',
    sourceUrl: 'https://fb.me/x',
    headline: 'Dry taps in Bryanston?',
    ctwaClid: 'ARAkLkA8rmlFeiCktEJQ',
  });
  const s = await start();
  try {
    await s.post(payload('wamid.r1', '27825550000', 'Hi', { source_id: '1202', source_type: 'ad', ctwa_clid: 'clid-1' }));
    await s.app.idle();
    assert.equal(s.store.leads.get('27825550000')!.referral?.ctwaClid, 'clid-1');
  } finally {
    await s.close();
  }
});
