# 07 — Operations Runbook

Day-to-day operation of the worker. Everything here is plain SQL against the production database, until an admin UI exists.

## 1. Go-live configuration

Copy `.env.example` to `.env` and fill in:

| Variable | Needed for |
|---|---|
| `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID` | Receiving and sending WhatsApp |
| `DATABASE_URL` | Persistence + all pilot features (jobs, installers, billing) |
| `PLAYBOOK` | `water` (default) or `solar` for new conversations |
| `ANTHROPIC_API_KEY` | LLM fallback (on automatically when set; `LLM_FALLBACK=0` turns it off) |
| `PAYSTACK_SECRET_KEY` | Top-up links + webhook verification. Webhook URL: `https://<host>/paystack/webhook` |
| `META_ACCESS_TOKEN` | Pausing/resuming installers' ad sets |
| `META_DATASET_ID` (+ `META_ACCESS_TOKEN`, `WHATSAPP_BUSINESS_ACCOUNT_ID`) | Conversions API |
| `REQUIRE_PREPAID` | `1` (default): only route to installers with credit. `0` during free-visit pilots. |
| `DEFAULT_CLIENT_ID` | Optional house account when no territory matches |

On startup the worker applies migrations, refuses to start if no booking could ever be routed, and logs which integrations are on.

**Register these WhatsApp templates** (Meta Business Manager → WhatsApp Manager → Message templates, category *Utility*, language *English*), using the exact names and bodies in [`templates.ts`](../apps/worker/src/templates.ts): `visit_reminder_day_before`, `visit_reminder_same_day`, `visit_attendance_check`, `installer_new_booking`, `installer_outcome_request`, `installer_low_balance`, `installer_topup_received`, `installer_ads_resumed`.

## 2. Onboard an installer

```sql
-- 1. The installer (contact_phone = their WhatsApp number in E.164 without '+')
insert into clients (legal_name, trading_name, vertical, contact_name, contact_phone, contact_email,
                     price_per_appt, platform_fee, expected_weekly_appts, meta_adset_ids)
values ('AquaSafe (Pty) Ltd', 'AquaSafe Plumbing', 'water_backup', 'Sipho', '27821234567', 'sipho@example.com',
        550, 1500, 5, '{120210000000001}')
returning id;

-- 2. Their exclusive suburbs (canonical names from playbooks/water.ts SUBURBS)
insert into territories (client_id, vertical, area_name, suburbs)
values ('<client id>', 'water_backup', 'Bryanston + Morningside', '{Bryanston,Morningside}');

-- 3. Pilot: 3 free visits as a credit adjustment (so routing works before they prepay)
insert into credit_ledger (client_id, amount_zar, kind, note) values ('<client id>', 1650, 'adjustment', 'pilot: 3 free visits');
```

Tell the installer: *"Reply HELP to this number any time. After each visit reply WON <ref> <amount> or LOST <ref> <reason>."*

## 3. Daily checks (5 minutes)

```sql
-- Ads: cost per attended visit per ad (import yesterday's spend first)
insert into ad_spend_daily (source_id, day, spend_zar) values ('<ad id>', current_date - 1, 412.50)
  on conflict (source_id, day) do update set spend_zar = excluded.spend_zar;
select source_id, headline, leads, attended, won, spend, cost_per_attended from ad_performance order by spend desc nulls last;
-- Kill rule: (spend / leads) > 149 for 7 days -> pause that ad set.

-- Funnel
select * from funnel_daily where day >= current_date - 7 order by day desc;

-- Chats a human must answer (refills, unreadable answers, "speak to a person", no installer available)
select * from handoff_queue;

-- Disputes to resolve
select a.ref, c.trading_name, a.starts_at, a.dispute_reason from appointments a join clients c on c.id = a.client_id
 where a.status = 'disputed' order by a.updated_at;

-- Jobs that failed after 5 attempts
select kind, appointment_id, result, updated_at from jobs where status = 'failed' order by updated_at desc limit 20;

-- Installer balances
select c.trading_name, b.balance, c.ads_paused from clients c join client_balance b on b.client_id = c.id order by b.balance;
```

## 4. Resolve a dispute

```sql
-- Installer was right (nobody home): mark no-show; if it was already billed, refund.
update appointments set status = 'no_show', dispute_reason = 'resolved: installer upheld' where ref = 'ABCDE';
insert into credit_ledger (client_id, amount_zar, kind, appointment_id, note)
select client_id, (select price_per_appt from clients where id = a.client_id), 'refund', id, 'dispute upheld'
  from appointments a where ref = 'ABCDE' and billed_at is not null;

-- Household was right: mark attended; billing job runs on the next tick if it hasn't billed yet.
update appointments set status = 'attended', dispute_reason = 'resolved: household upheld' where ref = 'ABCDE';
insert into jobs (kind, run_at, appointment_id, client_id) select 'bill_appointment', now(), id, client_id from appointments where ref = 'ABCDE' and billed_at is null;
```

## 5. Take over a chat

A lead in `handoff` gets no bot replies. Answer from the WhatsApp Business inbox. To hand the conversation back to the bot:

```sql
update leads set status = 'engaging', conversation = jsonb_set(conversation, '{stage}', '"qualifying"') where phone_e164 = '2782...';
```

## 6. POPIA requests
- **Deletion:** the person replies `DELETE`, or ops runs the same erasure via the app. Never hand-delete rows: the hashed opt-out record must stay.
- **Access request:** `select * from leads where phone_e164 = '...'` plus their `messages` and `consents`. Respond within a reasonable time per s23.
