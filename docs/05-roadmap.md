# 05 — Roadmap

> Rule: **ship to real users before it feels ready.** Every phase ends at a measurable gate, not a date.
> v2 (7 Nov 2026): launch vertical is **backup water, Sandton / Bryanston / Randburg**. The pilot pack (steps 1–6) is built.

## Built (in this repo, tested)

| | Capability |
|---|---|
| ✅ | WhatsApp qualification agent, playbook-driven (water default, solar second) |
| ✅ | Postgres persistence, restart-safe, transactional saves, migrations |
| ✅ | **Step 1:** reminders (24h / 2h) + attendance check, with the courtesy window and WhatsApp template fallback |
| ✅ | **Step 2:** installer side on WhatsApp: booking brief, `WON` / `LOST` / `NOSHOW` / `BALANCE` / `TOPUP`, outcome requests at +3/+7/+14 days, routing pause when outcomes are overdue |
| ✅ | **Step 3:** Click-to-WhatsApp attribution + `ad_performance` (cost per attended visit, revenue per ad) |
| ✅ | **Step 4:** Claude fallback for unreadable answers (constrained JSON, re-validated, usage logged) |
| ✅ | **Step 5:** prepaid credit ledger, billing after a 48h dispute window, credit reservation, automatic ad pause/resume, Paystack top-ups |
| ✅ | **Step 6:** Conversions API events (QualifiedLead at booking, Purchase with value on WON) |

## Phase 0: Accounts and supply (days 1–10) · ~R18k (legal, registrations)

| Deliverable | Gate |
|---|---|
| Meta Business verified; WhatsApp number live; 8 templates approved | Test template delivered |
| Paystack live keys + webhook; hosting + Postgres; `.env` set | `GET /health` OK; signed test webhook credited |
| Information Officer + **Opt-Out Registry registration (deadline 31 Dec 2026)** | Confirmation numbers on file |
| 15 in-person installer visits ([01](01-business-plan.md) §6.1) | **≥ 3 pilots signed** at R550 per attended visit |
| Clients + territories loaded ([07](07-operations-runbook.md)) | Worker starts (it refuses to start if routing is impossible) |

## Phase 1: Pilot (days 11–45) · ~R27k ad spend

| Week | Focus | Measure |
|---|---|---|
| 2 | 3 ad sets live (R300/day caps); first 3 free visits per installer | CPL per ad, first response < 60 s |
| 3 | Tune the qualification copy from real transcripts; review LLM fallback rate | Raw→qualified ≥ 50%, handoff rate < 10% |
| 4 | Convert installers to prepaid; daily `ad_performance` review | Show rate ≥ 80% |
| 5–6 | Kill losing ad sets (> R149 per raw lead); scale winners | Cost per attended visit ≤ R230 |

**Day-45 go/no-go:** paid media ≤ R149 per raw lead · show rate ≥ 75% · ≥ 5 installers on prepaid.
→ **Pass:** scale. **Fail:** fix the weakest stage for 2 weeks, then switch to the plumbing/geysers playbook or stop.

## Phase 2: Scale (months 2–4)
- 10–12 installers across the 18 suburbs; Area Lock upsell to the top installers
- **Playbook #3: emergency plumbing + geysers** (PIRB-registered only), on the same households and number
- SEO directory site live: sourced outage-status page, 2026 price table, litres calculator (all CTAs open WhatsApp)
- Refill partner product line (the `refill_request` handoffs become a paid feed)
- Calendar integration per installer (plug into `slotsFor` in `server.ts`)
- Ops dashboard on the views: `funnel_daily`, `ad_performance`, `handoff_queue`, `client_balance`

## Phase 3: Compound (months 4–12)
- Gate motors + garage doors playbook (lightning season), then boreholes as an upsell
- Lead scoring v1 from outcome data (≈ 300 outcomes); feed predicted value to the Conversions API
- New metros (Pretoria East, Midrand, Cape Town) with the same playbooks
- **Productise:** license the platform to installers who run their own ads (SaaS)
- Base-case run-rate: 360 attended visits/month, ~R109k operating profit

## Engineering backlog (known limits, from [03](03-architecture.md))
1. Inbox table for raw webhooks (removes the "crash between ack and save" gap)
2. Row lock on the lead during inbound processing (multi-instance safety; job-runner `pending` race)
3. Store installer chat messages (currently only replies are sent)
4. Google Ads offline conversions (non-Meta leads)
5. Admin UI for disputes and refunds (today: SQL in the runbook)

## Week-1 action list (start Monday)
1. Start **Meta Business verification** today. It takes days, so everything else runs in parallel.
2. Register the Information Officer and the **Opt-Out Registry** direct-marketer account.
3. Build the 40-installer list; book 15 **in-person** visits (no cold calls).
4. Open the Paystack business account.
5. Draft 3 ad creatives per suburb cluster, using sourced outage statements only.
6. Run `npm run simulate` with 5 real households (friends and family) and fix the copy that confuses them.
