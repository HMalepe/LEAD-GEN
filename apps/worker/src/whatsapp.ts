// WhatsApp Business Cloud API: webhook verification, payload parsing, sending.

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Verify Meta's X-Hub-Signature-256 header (HMAC-SHA256 of the raw body with the app secret). */
export function verifySignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header || !header.startsWith('sha256=') || !appSecret) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  let given: Buffer;
  try {
    given = Buffer.from(header.slice('sha256='.length), 'hex');
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function signBody(rawBody: Buffer | string, appSecret: string): string {
  return 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
}

export interface InboundMessage {
  id: string;
  from: string; // E.164 digits without '+', as WhatsApp sends it
  timestamp: Date;
  type: string;
  text: string; // '' for unsupported types
  profileName?: string;
}

/** Extract inbound messages from a webhook payload. Ignores status callbacks. */
export function parseWebhook(payload: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const p = payload as any;
  if (p?.object !== 'whatsapp_business_account' || !Array.isArray(p.entry)) return out;
  for (const entry of p.entry) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      const names = new Map<string, string>();
      for (const c of value?.contacts ?? []) if (c?.wa_id) names.set(c.wa_id, c?.profile?.name);
      for (const m of value?.messages ?? []) {
        if (!m?.id || !m?.from) continue;
        out.push({
          id: String(m.id),
          from: String(m.from),
          timestamp: new Date(Number(m.timestamp ?? 0) * 1000),
          type: String(m.type ?? 'unknown'),
          text: extractText(m),
          profileName: names.get(m.from),
        });
      }
    }
  }
  return out;
}

function extractText(m: any): string {
  switch (m.type) {
    case 'text':
      return String(m.text?.body ?? '');
    case 'button':
      return String(m.button?.text ?? m.button?.payload ?? '');
    case 'interactive':
      return String(m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '');
    default:
      return '';
  }
}

export interface Sender {
  sendText(to: string, body: string): Promise<void>;
}

/** Sends via the Graph API. Requires WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID. */
export class CloudApiSender implements Sender {
  private token: string;
  private phoneNumberId: string;
  private apiVersion: string;

  constructor(token: string, phoneNumberId: string, apiVersion = process.env.WHATSAPP_API_VERSION ?? 'v21.0') {
    this.token = token;
    this.phoneNumberId = phoneNumberId;
    this.apiVersion = apiVersion;
  }

  async sendText(to: string, body: string): Promise<void> {
    const res = await fetch(`https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body, preview_url: false } }),
    });
    if (!res.ok) throw new Error(`WhatsApp send failed: ${res.status} ${await res.text()}`);
  }
}

/** Dry-run sender for local development and tests. */
export class MemorySender implements Sender {
  sent: Array<{ to: string; body: string }> = [];
  log: boolean;
  constructor(log = false) {
    this.log = log;
  }
  async sendText(to: string, body: string): Promise<void> {
    this.sent.push({ to, body });
    if (this.log) console.log(`\n→ ${to}\n${body}\n`);
  }
}
