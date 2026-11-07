# LEAD-GEN

**AI-qualified, booked, attended appointments for South African home-service businesses, billed only when the appointment happens.**

Launch market: residential solar and backup power installers, Gauteng. Expansion: security, then other metros, then the platform sold as SaaS.

---

## Executive summary

| | |
|---|---|
| **Problem** | Installers lose most of their inbound enquiries to slow follow-up, unqualified leads and no-shows. Shared lead marketplaces sell the same lead to several competitors. |
| **Product** | We run the ads, an AI agent qualifies every enquiry on WhatsApp in under 60 seconds and books it into the installer's calendar, and a reminder engine gets the homeowner to show up. One client per vertical per territory. |
| **Pricing** | R2,500/month platform fee + **R1,200 per attended appointment**, prepaid. Optional R5,000/month Territory Lock. |
| **Client ROI** | Base case: each appointment is worth about R5,625 gross profit to the installer, about **4.7x our fee** |
| **Our margin** | Base case: R641 fully loaded cost per attended appointment → **47% contribution margin** |
| **Month-12 base case** | 15 clients · 375 appointments/month · **R487.5k revenue/month · R222k operating profit/month** |
| **Biggest risk** | Funnel efficiency. The conservative case loses money, so the plan has a hard kill switch (R950 cost per appointment) and a day-60 go/no-go gate. |
| **Moat** | Closed-loop outcome data (won/lost) trains our scoring and the ad platforms, plus territory contracts and owned SEO assets |
| **Ask** | **R60k / 60 days** to validate. Go/no-go on measured, not modelled, numbers. |

## Documents

| # | Document | For |
|---|---|---|
| 01 | [Business plan](docs/01-business-plan.md): thesis, vertical scorecard, ICP, offer, GTM, KPIs, moat, risks | Leadership |
| 02 | [Unit economics](docs/02-unit-economics.md): funnel, 3 scenarios, sensitivity, cash flow, assumption register | Finance |
| 03 | [Architecture](docs/03-architecture.md): system design, stack, flows, AI guardrails, security, build order | Engineering |
| 04 | [Compliance](docs/04-compliance.md): POPIA, ECTA, CPA, platform policies, pre-launch checklist | Legal / risk |
| 05 | [Roadmap](docs/05-roadmap.md): phase gates, day-60 decision, week-1 actions | Everyone |

## Working assets

| Path | What it is |
|---|---|
| [`tools/unit_economics.py`](tools/unit_economics.py) | The financial model. Every number in the docs comes from it. |
| [`db/schema.sql`](db/schema.sql) | Postgres schema: leads, consent ledger, appointments, outcomes, billing, funnel view. Verified on PostgreSQL 16. |

```bash
# Re-run the financial model (Python 3.10+, no dependencies)
python3 tools/unit_economics.py --markdown

# Apply the schema to a local or Supabase Postgres
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema.sql
```

## Principles

1. **Sell outcomes, not inputs.** Attended appointments, not clicks or leads.
2. **Measure before scaling.** Every modelled number has a validation date in the assumption register.
3. **Compliance is part of the product.** The consent ledger is part of the core schema.
4. **The data loop is the moat.** No outcome reporting, no bookings.
