// Meta Marketing API (pause/resume ad sets) and Conversions API for Business
// Messaging (send qualified + won events back so Meta optimises for buyers).
// Field names follow Meta's CAPI for Business Messaging docs; verify the current
// Graph API version and event names in your Events Manager before going live.

export interface AdsController {
  pause(adsetIds: string[]): Promise<void>;
  resume(adsetIds: string[]): Promise<void>;
}

export class MetaAdsController implements AdsController {
  private token: string;
  private apiVersion: string;
  constructor(token: string, apiVersion = process.env.META_API_VERSION ?? 'v21.0') {
    this.token = token;
    this.apiVersion = apiVersion;
  }
  pause(ids: string[]) {
    return this.setStatus(ids, 'PAUSED');
  }
  resume(ids: string[]) {
    return this.setStatus(ids, 'ACTIVE');
  }
  private async setStatus(ids: string[], status: 'PAUSED' | 'ACTIVE'): Promise<void> {
    for (const id of ids) {
      const res = await fetch(`https://graph.facebook.com/${this.apiVersion}/${encodeURIComponent(id)}`, {
        method: 'POST',
        body: new URLSearchParams({ status, access_token: this.token }),
      });
      if (!res.ok) throw new Error(`Meta ad set ${id} -> ${status} failed: ${res.status} ${await res.text()}`);
    }
  }
}

export class MemoryAdsController implements AdsController {
  calls: Array<{ action: 'pause' | 'resume'; ids: string[] }> = [];
  async pause(ids: string[]) {
    this.calls.push({ action: 'pause', ids });
  }
  async resume(ids: string[]) {
    this.calls.push({ action: 'resume', ids });
  }
}

export interface CapiEvent {
  eventName: string; // e.g. 'QualifiedLead', 'Purchase'
  eventId: string; // dedup key
  eventTime: Date;
  ctwaClid: string;
  value?: number | null;
}

export interface Capi {
  send(e: CapiEvent): Promise<void>;
}

export class MetaCapi implements Capi {
  private datasetId: string;
  private token: string;
  private wabaId: string;
  private apiVersion: string;
  constructor(datasetId: string, token: string, wabaId: string, apiVersion = process.env.META_API_VERSION ?? 'v21.0') {
    this.datasetId = datasetId;
    this.token = token;
    this.wabaId = wabaId;
    this.apiVersion = apiVersion;
  }

  async send(e: CapiEvent): Promise<void> {
    const event: Record<string, unknown> = {
      event_name: e.eventName,
      event_time: Math.floor(e.eventTime.getTime() / 1000),
      event_id: e.eventId,
      action_source: 'business_messaging',
      messaging_channel: 'whatsapp',
      user_data: { whatsapp_business_account_id: this.wabaId, ctwa_clid: e.ctwaClid },
    };
    if (e.value != null) event.custom_data = { currency: 'ZAR', value: e.value };
    const res = await fetch(`https://graph.facebook.com/${this.apiVersion}/${this.datasetId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [event], access_token: this.token }),
    });
    if (!res.ok) throw new Error(`Conversions API failed: ${res.status} ${await res.text()}`);
  }
}

export class MemoryCapi implements Capi {
  events: CapiEvent[] = [];
  async send(e: CapiEvent) {
    this.events.push(e);
  }
}
