// HTTP server.
//   GET  /webhook           -> Meta verification handshake
//   POST /webhook           -> signed WhatsApp messages (leads AND installers); acked fast, processed async, serially per sender
//   POST /paystack/webhook  -> signed Paystack events (prepaid top-ups)
//   GET  /health            -> liveness
//
// Run:  cp .env.example .env  (fill in)  then  npm start

import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { currentQuestion, handleMessage, rulesCanRead } from './agent.ts';
import type { AgentEvent, ConversationState } from './agent.ts';
import { proposeSlots } from './booking.ts';
import type { Slot } from './booking.ts';
import { JobRunner } from './db/jobs.ts';
import { migrate } from './db/migrate.ts';
import { Ops } from './db/ops.ts';
import { PgStore } from './db/pgStore.ts';
import { ClaudeInterpreter } from './llm.ts';
import type { Interpreter } from './llm.ts';
import { MetaAdsController, MetaCapi } from './meta.ts';
import { PaystackPayments, verifyPaystackSignature } from './paystack.ts';
import { getPlaybook } from './playbooks/index.ts';
import type { Playbook } from './playbooks/types.ts';
import { MemoryStore } from './store.ts';
import type { LeadRecord, MessageRecord, Store } from './store.ts';
import { CloudApiSender, MemorySender, parseWebhook, verifySignature } from './whatsapp.ts';
import type { InboundMessage, Sender } from './whatsapp.ts';

const MAX_BODY_BYTES = 1_000_000;

export interface AppOptions {
  store: Store;
  sender: Sender;
  appSecret: string;
  verifyToken: string;
  allowUnsigned?: boolean; // local development only
  now?: () => Date;
  onError?: (err: unknown) => void;
  /** Postgres-only pilot features: installer commands, billing, Paystack. */
  ops?: Ops;
  /** LLM fallback for answers the rules can't read. */
  llm?: Interpreter;
  paystackSecret?: string;
  /** Slot source per installer (default: playbook rules; plug a calendar in here). */
  slotsFor?: (now: Date, pb: Playbook, clientId: string) => Slot[];
}

export interface App {
  server: Server;
  /** Resolves when every queued message has been processed (tests, graceful shutdown). */
  idle(): Promise<void>;
  processInbound(msg: InboundMessage): Promise<void>;
}

export function createApp(opts: AppOptions): App {
  const now = opts.now ?? (() => new Date());
  const onError = opts.onError ?? ((e) => console.error('[worker]', e));
  const slotsFor = opts.slotsFor ?? ((d: Date, pb: Playbook) => proposeSlots(d, pb.slots));
  const queues = new Map<string, Promise<void>>();

  async function processInbound(msg: InboundMessage): Promise<void> {
    if (!(await opts.store.markProcessed(msg.id))) return; // duplicate delivery
    const t = now();

    // Installers talk to the same number: WON/LOST/NOSHOW/BALANCE/TOPUP.
    if (opts.ops) {
      const client = await opts.ops.clientByPhone(msg.from);
      if (client) {
        for (const r of await opts.ops.handleInstallerMessage(client, msg.text, t)) await opts.sender.sendText(msg.from, r);
        return;
      }
    }

    const lead = await opts.store.getOrCreateLead(msg.from, msg.profileName, t, { referral: msg.referral });
    const inbound: MessageRecord = { direction: 'inbound', body: msg.text, providerId: msg.id, at: t };
    lead.messages.push(inbound);

    if (msg.text === '') {
      const outbound = lead.state.stage === 'opted_out' ? [] : ['Sorry, I can only read text messages for now. Please type your answer. 🙏'];
      await persistThenSend(lead, outbound, t, false);
      return;
    }

    // LLM fallback: only when the rules can't read the answer; output is re-validated by the rules.
    let text = msg.text;
    const q = currentQuestion(lead.state);
    if (opts.llm && q && !rulesCanRead(lead.state, text)) {
      try {
        const r = await opts.llm.interpret(q, text);
        Object.assign(inbound, { model: r.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut });
        if (r.canonical !== null && q.parse(r.canonical) !== null) text = r.canonical;
      } catch (e) {
        onError(e); // degrade to the rules' re-prompt
      }
    }

    // Route before slots are offered, so we never offer times no installer can take.
    const prev: ConversationState = lead.state;
    const pb = getPlaybook(prev.playbook);
    const mayOfferSlots = (prev.stage === 'qualifying' && prev.qIndex === pb.questions.length - 1) || prev.stage === 'booked';
    if (mayOfferSlots) lead.clientId = await opts.store.resolveClient(lead, t);
    const clientId = lead.clientId ?? null;

    const result = handleMessage(prev, text, {
      now: t,
      proposeSlots: (d, p) => (clientId ? slotsFor(d, p, clientId) : []),
    });
    lead.state = result.state;
    const erase = applyEvents(lead, prev, result.events, msg, t);
    await persistThenSend(lead, result.replies, t, erase);
  }

  function applyEvents(lead: LeadRecord, prev: ConversationState, events: AgentEvent[], msg: InboundMessage, t: Date): boolean {
    let erase = false;
    const appt = prev.appointmentId;
    for (const ev of events) {
      switch (ev.type) {
        case 'consent':
          lead.consents.push({
            purpose: ev.purpose,
            granted: ev.granted,
            channel: 'whatsapp',
            wording: ev.wording,
            evidence: { inboundMessageId: msg.id },
            recordedAt: t,
          });
          break;
        case 'booked':
          lead.appointments.push({ ...ev.slot });
          break;
        case 'confirmed':
          if (appt) lead.appointmentUpdates.push({ id: appt, status: 'confirmed', by: 'lead' });
          break;
        case 'attendance':
          if (appt) lead.appointmentUpdates.push({ id: appt, status: ev.attended ? 'attended' : 'no_show', by: 'lead' });
          break;
        case 'cancelled':
          if (appt) lead.appointmentUpdates.push({ id: appt, status: 'cancelled', by: 'lead', reason: ev.reason });
          break;
        case 'handoff':
          lead.handoffs.push(ev.reason);
          break;
        case 'erase':
          erase = true;
          break;
      }
    }
    return erase;
  }

  /**
   * Commit state first, then send. A crash between the two can lose a reply
   * (recoverable: the lead writes again) but can never confirm a booking that
   * was not recorded. A failed send is flagged for a human.
   */
  async function persistThenSend(lead: LeadRecord, bodies: string[], t: Date, erase: boolean): Promise<void> {
    const phone = lead.phone;
    for (const body of bodies) lead.messages.push({ direction: 'outbound', body, at: t });
    if (bodies.length && lead.firstResponseSeconds === undefined) {
      lead.firstResponseSeconds = Math.round((now().getTime() - lead.createdAt.getTime()) / 1000);
    }
    if (erase) await opts.store.erase(lead, t);
    else await opts.store.save(lead, t);
    if (!phone) return;
    try {
      for (const body of bodies) await opts.sender.sendText(phone, body);
    } catch (e) {
      onError(e);
      if (!erase) {
        lead.handoffs.push('send_failed');
        await opts.store.save(lead, t);
      }
    }
  }

  function enqueue(msg: InboundMessage): void {
    const prev = queues.get(msg.from) ?? Promise.resolve();
    const next = prev.then(() => processInbound(msg)).catch(onError);
    queues.set(msg.from, next);
    next.finally(() => {
      if (queues.get(msg.from) === next) queues.delete(msg.from);
    });
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, 'ok');

    if (url.pathname === '/paystack/webhook') {
      if (req.method !== 'POST') return send(res, 405, 'method not allowed');
      if (!opts.ops || !opts.paystackSecret) return send(res, 404, 'not configured');
      const raw = await readBody(req);
      if (raw === null) return send(res, 413, 'payload too large');
      if (!verifyPaystackSignature(raw, header(req, 'x-paystack-signature'), opts.paystackSecret)) {
        return send(res, 401, 'invalid signature');
      }
      let evt: unknown;
      try {
        evt = JSON.parse(raw.toString('utf8'));
      } catch {
        return send(res, 400, 'invalid json');
      }
      // Processed before acking: a failure returns 500 and Paystack retries (crediting is idempotent).
      const outcome = await opts.ops.handlePaystackEvent(evt, now());
      return send(res, 200, outcome);
    }

    if (url.pathname !== '/webhook') return send(res, 404, 'not found');

    if (req.method === 'GET') {
      const ok =
        url.searchParams.get('hub.mode') === 'subscribe' &&
        url.searchParams.get('hub.verify_token') === opts.verifyToken &&
        opts.verifyToken !== '';
      return ok ? send(res, 200, url.searchParams.get('hub.challenge') ?? '') : send(res, 403, 'forbidden');
    }
    if (req.method !== 'POST') return send(res, 405, 'method not allowed');

    const raw = await readBody(req);
    if (raw === null) return send(res, 413, 'payload too large');
    const signed = verifySignature(raw, header(req, 'x-hub-signature-256'), opts.appSecret);
    if (!signed && !opts.allowUnsigned) return send(res, 401, 'invalid signature');

    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      return send(res, 400, 'invalid json');
    }
    // Ack immediately: Meta retries slow webhooks, and AI work must not block the response.
    send(res, 200, 'ok');
    for (const msg of parseWebhook(payload)) enqueue(msg);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      onError(e);
      if (!res.headersSent) send(res, 500, 'error');
    });
  });

  return {
    server,
    processInbound,
    async idle() {
      while (queues.size) await Promise.allSettled([...queues.values()]);
    },
  };
}

function send(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function readBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) tooBig = true;
      else chunks.push(c);
    });
    req.on('end', () => resolve(tooBig ? null : Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---------- Entrypoint ----------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  const appSecret = env.WHATSAPP_APP_SECRET ?? '';
  const allowUnsigned = env.ALLOW_UNSIGNED === '1';
  if (!appSecret && !allowUnsigned) {
    console.error('Set WHATSAPP_APP_SECRET (or ALLOW_UNSIGNED=1 for local testing only).');
    process.exit(1);
  }
  const sender: Sender =
    env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID
      ? new CloudApiSender(env.WHATSAPP_TOKEN, env.WHATSAPP_PHONE_NUMBER_ID)
      : new MemorySender(true);
  if (sender instanceof MemorySender) console.warn('[worker] DRY RUN: replies are printed, not sent.');

  const llm = env.LLM_FALLBACK === '0' || !env.ANTHROPIC_API_KEY ? undefined : new ClaudeInterpreter();
  console.log(`[worker] LLM fallback: ${llm ? 'on' : 'off'}`);

  let store: Store = new MemoryStore();
  let pool: pg.Pool | undefined;
  let ops: Ops | undefined;
  let jobs: JobRunner | undefined;
  if (env.DATABASE_URL) {
    pool = new pg.Pool({ connectionString: env.DATABASE_URL });
    try {
      await migrate(pool);
      const pgStore = new PgStore(pool, {
        defaultClientId: env.DEFAULT_CLIENT_ID || undefined,
        requirePrepaid: env.REQUIRE_PREPAID !== '0',
      });
      await pgStore.assertRoutable();
      store = pgStore;
    } catch (e) {
      console.error(`[worker] startup failed: ${(e as Error).message}`);
      await pool.end();
      process.exit(1);
    }
    ops = new Ops(pool, {
      sender,
      payments: env.PAYSTACK_SECRET_KEY ? new PaystackPayments(env.PAYSTACK_SECRET_KEY) : undefined,
      ads: env.META_ACCESS_TOKEN ? new MetaAdsController(env.META_ACCESS_TOKEN) : undefined,
    });
    const capi =
      env.META_DATASET_ID && env.META_ACCESS_TOKEN && env.WHATSAPP_BUSINESS_ACCOUNT_ID
        ? new MetaCapi(env.META_DATASET_ID, env.META_ACCESS_TOKEN, env.WHATSAPP_BUSINESS_ACCOUNT_ID)
        : undefined;
    jobs = new JobRunner({ pool, ops, sender, capi });
    jobs.start();
    console.log(
      `[worker] store: Postgres · jobs: on · payments: ${env.PAYSTACK_SECRET_KEY ? 'Paystack' : 'off'} · ` +
        `ads control: ${env.META_ACCESS_TOKEN ? 'Meta' : 'off'} · conversions API: ${capi ? 'on' : 'off'}`,
    );
  } else {
    console.warn('[worker] store: in-memory (set DATABASE_URL to persist and enable the pilot features)');
  }

  const app = createApp({
    store,
    sender,
    appSecret,
    verifyToken: env.WHATSAPP_VERIFY_TOKEN ?? '',
    allowUnsigned,
    ops,
    llm,
    paystackSecret: env.PAYSTACK_SECRET_KEY,
  });
  const port = Number(env.PORT ?? 3000);
  app.server.listen(port, () => console.log(`[worker] listening on :${port}`));
  const shutdown = () =>
    app.server.close(async () => {
      jobs?.stop();
      await app.idle();
      await pool?.end();
      process.exit(0);
    });
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
