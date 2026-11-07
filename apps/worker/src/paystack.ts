// Paystack: prepaid top-up links and webhook verification.
// Docs: https://paystack.com/docs/api/transaction/#initialize and /payments/webhooks

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Paystack signs webhooks with HMAC-SHA512 of the raw body using your secret key (header x-paystack-signature). */
export function verifyPaystackSignature(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (!header || !secret) return false;
  const expected = createHmac('sha512', secret).update(rawBody).digest();
  const given = Buffer.from(header, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function signPaystack(rawBody: Buffer | string, secret: string): string {
  return createHmac('sha512', secret).update(rawBody).digest('hex');
}

export interface TopupRequest {
  clientId: string;
  email: string;
  amountZar: number;
  reference: string;
}

export interface Payments {
  createTopupLink(r: TopupRequest): Promise<string>;
}

export class PaystackPayments implements Payments {
  private secret: string;
  constructor(secret: string) {
    this.secret = secret;
  }

  async createTopupLink(r: TopupRequest): Promise<string> {
    const res = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: r.email,
        amount: Math.round(r.amountZar * 100), // cents
        currency: 'ZAR',
        reference: r.reference,
        metadata: { client_id: r.clientId },
      }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || !body?.status || !body?.data?.authorization_url) {
      throw new Error(`Paystack initialize failed: ${res.status} ${body?.message ?? ''}`);
    }
    return body.data.authorization_url;
  }
}

/** Test / dry-run implementation. */
export class MemoryPayments implements Payments {
  links: TopupRequest[] = [];
  async createTopupLink(r: TopupRequest): Promise<string> {
    this.links.push(r);
    return `https://checkout.example/${r.reference}`;
  }
}
