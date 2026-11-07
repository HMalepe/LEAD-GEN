# LEAD-GEN

**AI-qualified, booked, *attended* site visits for South African home-service installers, billed only when the visit happens.**

Launch market: **backup water systems** (tanks, pumps, boosters) in **Sandton, Bryanston, Randburg** and 15 surrounding suburbs. Next: emergency plumbing and geysers, then gate motors. Solar is kept as a second playbook.

---

## Executive summary

| | |
|---|---|
| **Problem** | Joburg's northern suburbs face repeated water outages (Sandton and Randburg systems in a second week of outages on 2 Nov 2026). Households need a backup system *now*, but installers are fragmented, and lead marketplaces sell the same lead to 3–5 of them. |
| **Product** | Click-to-WhatsApp ads → an AI agent qualifies the household in under 60 s → a **same-day visit** with **one** installer per suburb → reminders + attendance check → the installer reports WON/LOST on WhatsApp. |
| **Pricing** | R1,500/month + **R550 per attended visit**, prepaid; optional R4,000/month Area Lock. First 3 visits free. |
| **Installer maths** | R550 at a 30% close rate = **R1,833 per won R16,500 job** (11% of revenue). A typical "R700 exclusive lead" costs R2,333 per won job *before* no-shows. |
| **Our margin** | Base case: R228 fully loaded cost per attended visit → **59% contribution margin** |
| **Month-12 base case** | 12 installers · 360 visits/month · **R216k revenue · R109k operating profit / month** |
| **Biggest risk** | Paid-media cost per lead (no data yet). **Kill switch: R149 per raw lead.** The conservative case loses ~R48k/month. |
| **Moat** | Won/lost outcomes feed Meta's Conversions API, plus suburb exclusivity and an owned SEO directory |
| **Ask** | **R45k / 45 days** to validate; go/no-go on measured numbers |

## Documents

| # | Document | For |
|---|---|---|
| 01 | [Business plan](docs/01-business-plan.md): thesis, niche scorecard, ICP, offer, GTM, KPIs, risks, ask | Leadership |
| 02 | [Unit economics](docs/02-unit-economics.md): funnel, scenarios, sensitivity, kill switch, cash flow | Finance |
| 03 | [Architecture](docs/03-architecture.md): system design, pilot pack as built, guardrails, known limits | Engineering |
| 04 | [Compliance](docs/04-compliance.md): POPIA (incl. Dec 2024 guidance), CPA Opt-Out Registry, trade rules, checklist | Legal / risk |
| 05 | [Roadmap](docs/05-roadmap.md): what's built, phase gates, day-45 decision, week-1 actions | Everyone |
| 06 | [Niche research review](docs/06-niche-research-review.md): verification, corrections, decisions, launch kit | Leadership |
| 07 | [Operations runbook](docs/07-operations-runbook.md): go-live config, onboarding, daily checks, disputes | Ops |
| — | [Source research (Nov 2026)](docs/research/2026-11-niche-research.md) | Reference |

## What's built (`apps/worker/`)

| | Capability |
|---|---|
| Agent | Playbook-driven WhatsApp qualification (water default, solar), consent ledger, STOP/DELETE, human handoff |
| Pilot step 1 | Reminders + attendance check, courtesy hours, WhatsApp 24h-window template fallback |
| Pilot step 2 | Installer side on WhatsApp: booking brief, `WON` / `LOST` / `NOSHOW` / `BALANCE` / `TOPUP` |
| Pilot step 3 | Click-to-WhatsApp ad attribution → `ad_performance` (cost per attended visit per ad) |
| Pilot step 4 | Claude fallback for unreadable answers: constrained JSON, re-validated, usage logged |
| Pilot step 5 | Prepaid credit ledger, billing after a 48h dispute window, auto pause/resume of ads, Paystack top-ups |
| Pilot step 6 | Meta Conversions API: QualifiedLead on booking, Purchase + value on WON |
| Platform | Postgres (restart-safe, transactional outbox), durable job runner, migrations, CI |

### Run it (Node ≥ 22.18, Python ≥ 3.10)

```bash
npm install            # two dependencies: pg, @anthropic-ai/sdk
npm test               # unit tests (no database)
npm run test:db        # + full Postgres lifecycle tests (needs a local *_test database)
npm run check          # tests + docs-match-model + link check (what CI runs)
npm run simulate       # chat with the agent as a homeowner (water); `node apps/worker/src/simulate.ts solar`
npm run dev            # webhook server on :3000, in-memory, dry run
npm run model          # financial model (water); add `-- --vertical solar`

# Production: cp .env.example .env, fill it in (see docs/07), then
npm start              # migrates, checks routing, starts webhook server + job runner
```

## Principles

1. **Sell outcomes, not inputs.** Attended visits, not clicks or leads.
2. **Measure before scaling.** Every modelled number has a validation date, and the kill switch is a number, not a feeling.
3. **Compliance is part of the product.** Consent, opt-outs and erasure live in the core schema and are tested.
4. **The data loop is the moat.** No outcome reporting, no bookings.
