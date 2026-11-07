-- LEAD-GEN core schema (PostgreSQL 15+ / Supabase)
-- Design rules:
--   1. Every personal-data row is traceable to a consent record (POPIA s11, s69).
--   2. Every billable event is traceable to an attended appointment (dispute-proof billing).
--   3. Outcomes flow back from clients so lead scoring learns (the data moat).

create extension if not exists "pgcrypto";

-- ---------- Enums ----------
create type lead_source      as enum ('meta_ads','google_ads','seo_site','click_to_whatsapp','referral','manual');
create type lead_status      as enum ('new','engaging','qualified','disqualified','booked','attended','no_show','won','lost','recycled');
create type channel          as enum ('whatsapp','sms','voice','email','web');
create type message_dir      as enum ('inbound','outbound');
create type consent_purpose  as enum ('contact_about_enquiry','share_with_installer','marketing');
create type appt_status      as enum ('scheduled','confirmed','attended','no_show','cancelled','disputed','credited');
create type invoice_status   as enum ('draft','issued','paid','void');

-- ---------- Clients (businesses that buy appointments) ----------
create table clients (
  id                uuid primary key default gen_random_uuid(),
  legal_name        text not null,
  trading_name      text,
  vertical          text not null,                 -- e.g. 'solar', 'security', 'plumbing'
  contact_name      text not null,
  contact_phone     text not null,
  contact_email     text,
  price_per_appt    numeric(10,2) not null,
  platform_fee      numeric(10,2) not null default 0,
  prepaid_credit    numeric(12,2) not null default 0,  -- appointments are drawn down from prepaid balance
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);

-- Exclusive territories: one client per vertical per area. Exclusivity is the product.
create table territories (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  vertical    text not null,
  area_name   text not null,                       -- e.g. 'Pretoria East'
  postal_codes text[] not null,
  unique (vertical, area_name)
);

-- ---------- Campaigns ----------
create table campaigns (
  id            uuid primary key default gen_random_uuid(),
  vertical      text not null,
  source        lead_source not null,
  external_id   text,                              -- ad platform campaign id
  name          text not null,
  daily_budget  numeric(10,2),
  started_at    timestamptz not null default now(),
  ended_at      timestamptz
);

-- ---------- Leads (consumers) ----------
create table leads (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid references campaigns(id),
  source          lead_source not null,
  vertical        text not null,
  full_name       text,
  phone_e164      text not null,
  email           text,
  postal_code     text,
  status          lead_status not null default 'new',
  score           smallint check (score between 0 and 100),
  qualification   jsonb not null default '{}'::jsonb,  -- answers captured by the AI agent
  assigned_client uuid references clients(id),
  first_response_seconds integer,                 -- speed-to-lead KPI
  utm             jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  erased_at       timestamptz                      -- POPIA s24 deletion: PII nulled, row kept for stats
);
create index leads_status_idx   on leads (status);
create index leads_phone_idx    on leads (phone_e164);
create index leads_created_idx  on leads (created_at desc);

-- ---------- Consent ledger (append-only, never updated) ----------
create table consents (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references leads(id) on delete cascade,
  purpose      consent_purpose not null,
  granted      boolean not null,                   -- false = withdrawal / opt-out
  channel      channel not null,
  wording      text not null,                      -- exact text the person agreed to
  evidence     jsonb not null default '{}'::jsonb, -- message id, form id, IP, user agent
  recorded_at  timestamptz not null default now()
);
create index consents_lead_idx on consents (lead_id, purpose, recorded_at desc);

-- Latest consent state per lead+purpose.
create view current_consent as
select distinct on (lead_id, purpose) lead_id, purpose, granted, recorded_at
from consents
order by lead_id, purpose, recorded_at desc;

-- ---------- Conversations ----------
create table messages (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references leads(id) on delete cascade,
  channel       channel not null,
  direction     message_dir not null,
  body          text,
  provider_id   text unique,                       -- WhatsApp/Twilio message id (idempotency)
  author        text not null default 'agent',     -- 'agent' | 'human:<user>' | 'lead'
  model         text,                              -- LLM used, for cost + quality audits
  tokens_in     integer,
  tokens_out    integer,
  cost_zar      numeric(10,4),
  created_at    timestamptz not null default now()
);
create index messages_lead_idx on messages (lead_id, created_at);

-- ---------- Appointments (the billable unit) ----------
create table appointments (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references leads(id),
  client_id     uuid not null references clients(id),
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  address       text,
  status        appt_status not null default 'scheduled',
  reminder_sent boolean not null default false,
  attended_confirmed_by text,                     -- 'client' | 'lead' | 'auto_timeout'
  dispute_reason text,
  created_at    timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index appts_client_idx on appointments (client_id, starts_at);

-- ---------- Outcomes (closed loop, feeds scoring) ----------
create table outcomes (
  appointment_id uuid primary key references appointments(id) on delete cascade,
  won            boolean not null,
  contract_value numeric(12,2),
  lost_reason    text,
  reported_at    timestamptz not null default now()
);

-- ---------- Billing ----------
create table invoices (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id),
  period_start  date not null,
  period_end    date not null,
  status        invoice_status not null default 'draft',
  total_zar     numeric(12,2) not null default 0,
  provider_ref  text,                              -- Paystack/Yoco reference
  created_at    timestamptz not null default now()
);

create table invoice_lines (
  id             uuid primary key default gen_random_uuid(),
  invoice_id     uuid not null references invoices(id) on delete cascade,
  appointment_id uuid unique references appointments(id), -- an appointment can be billed once
  description    text not null,
  amount_zar     numeric(10,2) not null
);

-- ---------- Funnel view: the numbers the business runs on ----------
create view funnel_daily as
select
  date_trunc('day', l.created_at)::date                      as day,
  l.vertical,
  count(*)                                                   as raw_leads,
  count(*) filter (where l.status in ('qualified','booked','attended','no_show','won','lost')) as qualified,
  count(a.id)                                                as booked,
  count(a.id) filter (where a.status = 'attended')           as attended,
  percentile_cont(0.5) within group (order by l.first_response_seconds) as median_response_s
from leads l
left join appointments a on a.lead_id = l.id
group by 1, 2;
