-- 0002: columns and tables the WhatsApp worker needs to persist conversations.

-- Conversation lifecycle states the agent uses that 0001 did not have.
alter type lead_status add value if not exists 'opted_out';
alter type lead_status add value if not exists 'handoff';

-- One lead per phone number (after erasure the column holds 'sha256:<hash>').
create unique index if not exists leads_phone_unique on leads (phone_e164);

-- Full agent state (stage, answers, offered slots, failed parses), so a restart
-- resumes every conversation exactly where it was.
alter table leads add column if not exists conversation jsonb not null default '{}'::jsonb;
alter table leads add column if not exists handoffs text[] not null default '{}';

-- Webhook idempotency: Meta re-delivers; each provider message id is processed once.
create table if not exists webhook_events (
  provider_id  text primary key,
  received_at  timestamptz not null default now()
);
