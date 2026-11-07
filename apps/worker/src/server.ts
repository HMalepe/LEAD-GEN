// HTTP webhook server for the WhatsApp Cloud API.
//   GET  /webhook  -> Meta verification handshake
//   POST /webhook  -> signed inbound messages; acked fast, processed async, serially per lead
//   GET  /health   -> liveness
//
// Run:  WHATSAPP_APP_SECRET=... WHATSAPP_VERIFY_TOKEN=... node apps/worker/src/server.ts

import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { handleMessage } from './agent.ts';
import type { AgentContext } from './agent.ts';
import { proposeSlots } from './booking.ts';
import { MemoryStore } from './store.ts';
import type { LeadRecord, Store } from './store.ts';
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
  slots?: AgentContext['proposeSlots'];
  onError?: (err: unknown) => void;
}

export interface App {
  server: Server;
  /** Resolves when every queued message has been processed (used by tests and graceful shutdown). */
  idle(): Promise<void>;
  processInbound(msg: InboundMessage): Promise<void>;
}

export function createApp(opts: AppOptions): App {
  const now = opts.now ?? (() => new Date());
  const slots = opts.slots ?? ((d: Date) => proposeSlots(d));
  const onError = opts.onError ?? ((e) => console.error('[worker]', e));
  const queues = new Map<string, Promise<void>>();

  async function processInbound(msg: InboundMessage): Promise<void> {
    if (!(await opts.store.markProcessed(msg.id))) return; // duplicate delivery
    const t = now();
    const lead = await opts.store.getOrCreateLead(msg.from, msg.profileName, t);
    lead.messages.push({ direction: 'inbound', body: msg.text, providerId: msg.id, at: t });

    if (msg.text === '' && lead.state.stage !== 'opted_out') {
      await reply(lead, ["Sorry, I can only read text messages for now. Please type your answer. 🙏"], t);
      await opts.store.save(lead);
      return;
    }

    const result = handleMessage(lead.state, msg.text, { now: t, proposeSlots: slots });
    lead.state = result.state;
    let erase = false;
    for (const ev of result.events) {
      if (ev.type === 'consent') {
        lead.consents.push({
          purpose: ev.purpose,
          granted: ev.granted,
          channel: 'whatsapp',
          wording: ev.wording,
          evidence: { inboundMessageId: msg.id },
          recordedAt: t,
        });
      } else if (ev.type === 'booked') lead.appointments.push(ev.slot);
      else if (ev.type === 'handoff') lead.handoffs.push(ev.reason);
      else if (ev.type === 'erase') erase = true;
    }
    await reply(lead, result.replies, t);
    if (erase) await opts.store.erase(lead, t);
    else await opts.store.save(lead);
  }

  async function reply(lead: LeadRecord, bodies: string[], t: Date): Promise<void> {
    for (const body of bodies) {
      if (!lead.phone) break;
      await opts.sender.sendText(lead.phone, body);
      if (lead.firstResponseSeconds === undefined) {
        lead.firstResponseSeconds = Math.round((now().getTime() - lead.createdAt.getTime()) / 1000);
      }
      lead.messages.push({ direction: 'outbound', body, at: t });
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
  const appSecret = process.env.WHATSAPP_APP_SECRET ?? '';
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN ?? '';
  const allowUnsigned = process.env.ALLOW_UNSIGNED === '1';
  if (!appSecret && !allowUnsigned) {
    console.error('Set WHATSAPP_APP_SECRET (or ALLOW_UNSIGNED=1 for local testing only).');
    process.exit(1);
  }
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const sender: Sender = token && phoneId ? new CloudApiSender(token, phoneId) : new MemorySender(true);
  if (!(token && phoneId)) console.warn('[worker] DRY RUN: replies are printed, not sent.');

  const app = createApp({ store: new MemoryStore(), sender, appSecret, verifyToken, allowUnsigned });
  const port = Number(process.env.PORT ?? 3000);
  app.server.listen(port, () => console.log(`[worker] listening on :${port}`));
  const shutdown = () => app.server.close(async () => (await app.idle(), process.exit(0)));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
