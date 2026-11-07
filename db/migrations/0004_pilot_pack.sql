-- 0004: pilot pack: reminders and attendance, installer loop, ad attribution,
-- prepaid credit, ad pausing, Conversions API.

-- ---------- Territories by suburb (water niche routes on suburb names) ----------
alter table territories add column if not exists suburbs text[] not null default '{}';
alter table territories alter column postal_codes set default '{}';

-- ---------- Clients: billing + ads controls ----------
alter table clients add column if not exists expected_weekly_appts integer not null default 5;
alter table clients add column if not exists meta_adset_ids text[] not null default '{}';
alter table clients add column if not exists ads_paused boolean not null default false;
alter table clients add column if not exists last_inbound_at timestamptz;
comment on column clients.prepaid_credit is 'DEPRECATED: balance lives in credit_ledger / client_balance';
create unique index if not exists clients_contact_phone_unique on clients (contact_phone);

-- ---------- Appointments: short reference + lifecycle timestamps ----------
alter table appointments add column if not exists ref text;
create unique index if not exists appointments_ref_unique on appointments (ref);
alter table appointments add column if not exists attended_at timestamptz;
alter table appointments add column if not exists billed_at timestamptz;
alter table appointments add column if not exists updated_at timestamptz not null default now();

-- ---------- Leads: Click-to-WhatsApp click id (Conversions API attribution) ----------
alter table leads add column if not exists ctwa_clid text;
create index if not exists leads_ad_idx on leads ((utm->>'source_id'));

-- ---------- Durable job queue (reminders, briefs, outcome requests, billing, CAPI) ----------
create table if not exists jobs (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null,
  run_at         timestamptz not null,
  status         text not null default 'queued' check (status in ('queued','running','done','skipped','failed')),
  attempts       integer not null default 0,
  lead_id        uuid references leads(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete cascade,
  client_id      uuid references clients(id) on delete cascade,
  payload        jsonb not null default '{}'::jsonb,
  result         text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists jobs_due_idx on jobs (run_at) where status = 'queued';
create index if not exists jobs_appt_idx on jobs (appointment_id);

-- ---------- Prepaid credit: append-only ledger is the source of truth ----------
create table if not exists credit_ledger (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references clients(id),
  amount_zar     numeric(12,2) not null,            -- +topup / -appointment / +refund
  kind           text not null check (kind in ('topup','appointment','refund','adjustment')),
  appointment_id uuid references appointments(id),
  provider_ref   text,                              -- Paystack reference (idempotency)
  note           text,
  created_at     timestamptz not null default now()
);
create unique index if not exists credit_ledger_provider_ref on credit_ledger (provider_ref) where provider_ref is not null;
create unique index if not exists credit_ledger_one_charge on credit_ledger (appointment_id) where kind = 'appointment';

create or replace view client_balance as
select c.id as client_id, coalesce(sum(l.amount_zar), 0)::numeric(12,2) as balance
from clients c left join credit_ledger l on l.client_id = c.id
group by c.id;

-- ---------- Ad attribution ----------
-- Spend per ad per day, imported from Ads Manager (CSV / Marketing API).
create table if not exists ad_spend_daily (
  source_id  text not null,
  day        date not null,
  spend_zar  numeric(12,2) not null,
  primary key (source_id, day)
);

-- Cost per *attended* appointment and revenue per ad: the numbers that decide which ads live.
create or replace view ad_performance as
with funnel as (
  select l.utm->>'source_id' as source_id,
         max(l.utm->>'headline') as headline,
         count(distinct l.id) as leads,
         count(distinct l.id) filter (where l.score >= 60) as qualified,
         count(distinct a.id) as booked,
         count(distinct a.id) filter (where a.status = 'attended') as attended,
         count(distinct o.appointment_id) filter (where o.won) as won,
         coalesce(sum(o.contract_value) filter (where o.won), 0) as won_value
  from leads l
  left join appointments a on a.lead_id = l.id
  left join outcomes o on o.appointment_id = a.id
  where l.utm ? 'source_id'
  group by 1
)
select f.*, s.spend,
       round(s.spend / nullif(f.attended, 0), 2) as cost_per_attended,
       round(s.spend / nullif(f.won, 0), 2) as cost_per_won
from funnel f
left join (select source_id, sum(spend_zar) as spend from ad_spend_daily group by 1) s using (source_id);
