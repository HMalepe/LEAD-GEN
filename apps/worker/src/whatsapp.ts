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
  /** Present when the chat was opened from a Click-to-WhatsApp ad or post. */
  referral?: Referral;
}

/** Click-to-WhatsApp attribution, as sent by Meta on the first message from an ad. */
export interface Referral {
  sourceId?: string; // ad id
  sourceType?: string; // 'ad' | 'post'
  sourceUrl?: string;
  headline?: string;
  ctwaClid?: string; // click id, used for Conversions API attribution
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
          referral: parseReferral(m.referral),
        });
      }
    }
  }
  return out;
}

function parseReferral(r: any): Referral | undefined {
  if (!r || typeof r !== 'object') return undefined;
  const out: Referral = {
    sourceId: r.source_id ? String(r.source_id) : undefined,
    sourceType: r.source_type ? String(r.source_type) : undefined,
    sourceUrl: r.source_url ? String(r.source_url) : undefined,
    headline: r.headline ? String(r.headline).slice(0, 200) : undefined,
    ctwaClid: r.ctwa_clid ? String(r.ctwa_clid) : undefined,
  };
  return Object.values(out).some(Boolean) ? out : undefined;
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
  /** Pre-approved template: required for business-initiated messages outside the 24h customer service window. */
  sendTemplate(to: string, name: string, params: string[], language?: string): Promise<void>;
}

/** WhatsApp only allows free-form business messages within 24h of the person's last message. */
export function insideServiceWindow(lastInboundAt: Date | null | undefined, now: Date): boolean {
  return !!lastInboundAt && now.getTime() - lastInboundAt.getTime() < 24 * 3_600_000;
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
    await this.post({ messaging_product: 'whatsapp', to, type: 'text', text: { body, preview_url: false } });
  }

  async sendTemplate(to: string, name: string, params: string[], language = 'en'): Promise<void> {
    await this.post({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name,
        language: { code: language },
        components: params.length ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] : [],
      },
    });
  }

  private async post(payload: unknown): Promise<void> {
    const res = await fetch(`https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`WhatsApp send failed: ${res.status} ${await res.text()}`);
  }
}

/** Dry-run sender for local development and tests. */
export class MemorySender implements Sender {
  sent: Array<{ to: string; body: string; template?: string; params?: string[] }> = [];
  log: boolean;
  constructor(log = false) {
    this.log = log;
  }
  async sendText(to: string, body: string): Promise<void> {
    this.sent.push({ to, body });
    if (this.log) console.log(`\n→ ${to}\n${body}\n`);
  }
  async sendTemplate(to: string, name: string, params: string[]): Promise<void> {
    const body = `[template ${name}] ${params.join(' | ')}`;
    this.sent.push({ to, body, template: name, params });
    if (this.log) console.log(`\n→ ${to}\n${body}\n`);
  }
}
