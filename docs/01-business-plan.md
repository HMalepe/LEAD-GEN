# 01 — Business Plan

> **Status:** v1 draft for executive review. Every quantitative claim is either sourced, or marked as an *assumption* to be validated in the 30-day pilot ([05-roadmap.md](05-roadmap.md)).

## 1. The thesis in one paragraph

South African home-service businesses (solar and backup power, security, plumbing, electrical) lose most of their inbound enquiries to **slow follow-up, unqualified tyre-kickers and no-shows**. LEAD-GEN sells **booked, AI-qualified, attended appointments**, not raw leads. We run the advertising and the conversation (WhatsApp first), qualify every enquiry in under 60 seconds, book it straight into the installer's calendar, and bill only when the appointment happens. One client per vertical per territory. We capture deal outcomes, so our targeting improves every month. A competitor starting later can't catch up on that.

## 2. Why this, why now

| Force | Implication |
|---|---|
| **Speed-to-lead decides deals.** Oldroyd, McElheran & Elkington (*HBR*, 2011, "The Short Life of Online Sales Leads") found firms that contacted a lead within an hour were roughly **7x** more likely to qualify it than those that waited longer, and most firms were far slower. | An AI agent that replies in seconds, 24/7, beats every owner-operated business on the first contact. |
| **WhatsApp is South Africa's default channel.** It's the dominant messaging app in SA, and Click-to-WhatsApp ads remove the web form entirely. | Competitors still run email forms and next-day callbacks. We start each conversation from a much better position. |
| **LLM costs have collapsed** while quality rose. | A full qualification conversation now costs a few rand (assumption: ≤R3/lead). Doing the same with human SDRs isn't economical at SA price points. |
| **Local-service lead gen is under-served in SA.** Most lead-gen operators and tooling target the US market. | Local search results and ad auctions are less contested. Territory exclusivity is still available to claim. |
| **Electricity cost and reliability pressure.** Tariff increases and grid uncertainty keep demand for solar and backup power structurally high. | The launch vertical has high contract values. That is what supports premium per-appointment pricing. |

## 3. Market and vertical selection

The vertical is chosen on a weighted scorecard, not by feel. Scores 1–5 are *assumptions to validate by interviewing 15 operators in week 1*.

| Criterion (weight) | Solar / backup | Security | Plumbing | Electrical | Legal (personal injury) |
|---|---|---|---|---|---|
| Avg job value (30%) | 5 | 3 | 2 | 3 | 5 |
| Enquiry volume (20%) | 4 | 4 | 5 | 4 | 3 |
| Pain from slow follow-up (20%) | 5 | 4 | 3 | 3 | 4 |
| Ability to pay / marketing budget (15%) | 5 | 4 | 2 | 3 | 5 |
| Regulatory & ad-policy friction (15%, higher = easier) | 4 | 4 | 5 | 5 | 1 |
| **Weighted score** | **4.65** | **3.70** | **3.25** | **3.50** | **3.80** |

**Decision:** launch in **residential solar and backup power, Gauteng (Pretoria + Johannesburg North)**. Add **security** as vertical #2. It shares the same homeowner audience, so we can cross-sell to leads we already have, with consent.

Legal scores well on economics, but advertising and professional-conduct rules make it a later, deliberate move, not a launch vertical.

## 4. Ideal Customer Profile (ICP)

**Buyer:** owner or sales manager of a solar or backup installer with:

- 3–25 staff, 2–8 install teams, operating in Gauteng
- Average contract value **R60k–R250k**
- Already spending on Facebook or Google, or on lead marketplaces, and unhappy with lead quality
- **Capacity to take 15–40 more appointments a month** (no capacity means churn)
- Owner answers WhatsApp personally. That is how we sell to them and how we deliver.

**Disqualify:** single-person operators with no install capacity, businesses that won't report outcomes, and anyone who wants a "list of numbers".

**End consumer (the lead):** a Gauteng homeowner with a monthly electricity bill above ~R2,000. They own the property and are planning within 3 months.

## 5. The offer

### 5.1 Product: "Qualified Appointment as a Service"

1. **Demand:** we fund and run the ads (Meta Click-to-WhatsApp plus Google Search), plus our own SEO sites over time.
2. **Qualification:** an AI agent on WhatsApp confirms homeownership, location in territory, bill size, roof type, budget or finance intent, and timeline. It scores the lead 0–100.
3. **Booking:** the agent books a site visit directly into the client's calendar.
4. **Show-rate engine:** confirmation, a 24-hour reminder, a 2-hour reminder, and a reschedule flow. This is where most of the margin comes from.
5. **Delivery:** the client receives a WhatsApp brief and a dashboard card with every answer and the conversation transcript.
6. **Closed loop:** the client marks won or lost with one tap. That outcome data retrains our scoring.

### 5.2 Pricing

| Tier | Price | Who it's for |
|---|---|---|
| **Pilot** | 10 attended appointments, prepaid, at R1,200 each = **R12,000** | Every new client. Low risk for them, cash up front for us. |
| **Growth** | **R2,500/month platform fee + R1,200 per attended appointment**, drawn from prepaid credit | Default plan |
| **Territory Lock** | Growth plan + **R5,000/month** for guaranteed exclusivity in their area | The top 20% of clients. Converts competitive fear into recurring revenue. |

**Billing rules (no grey areas):**

- We bill only *attended* appointments. A no-show is free, and a dispute raised within 48 hours is credited.
- **Prepaid credit is mandatory.** Ad spend leaves our account before the client pays us. Prepayment funds the working capital (see [02-unit-economics.md](02-unit-economics.md) §4).
- Clients must report the outcome within 14 days, or future bookings pause. Without outcome data we have no moat.

### 5.3 Why the client says yes

Base-case numbers: the client closes 25% of appointments on a R90k job at 25% gross margin. That makes each appointment worth **R5,625 gross profit** to them. We charge R1,200, so the client makes roughly **4.7x their spend in gross profit**. The sales pitch is that arithmetic, not adjectives.

## 6. Go-to-market

### 6.1 Acquiring clients (B2B)

POPIA §69 restricts *unsolicited electronic* direct marketing, including email and SMS to businesses. Juristic persons are data subjects under POPIA. So cold-email blasting is off the table. Use:

1. **Warm calls and in-person visits** to installers found on Google Maps. A human phone call isn't an "electronic communication" under §69, but CPA §11/§12 contact rules and time windows still apply.
2. **One-time consent request** (POPIA §69(2)), worded correctly and logged.
3. **Proof-first offer:** "We'll send your first 3 appointments before you pay. If they don't show, you owe nothing." Cap this at 3 clients.
4. **Industry channels:** solar installer associations, supplier and distributor networks (inverter and panel wholesalers know every installer), and LinkedIn content.
5. **Referral fee:** R2,000 credit for each referred client that completes a pilot.

### 6.2 Acquiring leads (B2C)

| Channel | Role | Notes |
|---|---|---|
| Meta Click-to-WhatsApp ads | Primary volume, from day 1 | No form step. Consent is captured in the first message. |
| Google Search ads | High-intent capture | "solar installer pretoria" and similar terms. Expensive but converts. |
| Owned SEO sites ("rank and rent") | From month 3, compounding asset | One site per vertical per metro. Leads cost close to nothing once the sites rank. |
| Referrals from won customers | From month 4 | R500 voucher, sent only with the homeowner's consent |

### 6.3 First 10 clients (name-level plan)

| Week | Action | Output |
|---|---|---|
| 1 | Build a list of 60 Gauteng installers from Google Maps and supplier directories. Score them against the ICP. | Top 25 prioritised |
| 1–2 | Interview 15 of them (calls or visits) to validate vertical scores and price | Validated or killed assumptions |
| 2 | Offer 3 "proof-first" pilots | 3 signed |
| 3–4 | Deliver appointments and collect testimonials plus outcome data | Case study with real numbers |
| 5–8 | Paid pilots for the next 7 | **10 clients** |

## 7. KPIs (the dashboard the boss reads)

| Layer | KPI | Target (base) | Kill threshold |
|---|---|---|---|
| Speed | Median first response | **< 60 s** | > 5 min |
| Funnel | Raw → qualified | 40% | < 25% |
| Funnel | Qualified → booked | 60% | < 40% |
| Funnel | Show rate | 80% | < 65% |
| Cost | **Fully loaded cost per attended appointment** | **≤ R650** | **> R950 for 3 consecutive weeks: pause and fix** |
| Client | Client close rate | 25% | < 15% (lead quality problem) |
| Retention | Monthly client churn | < 5% | > 10% |
| Data | Outcomes reported within 14 days | > 90% | < 70% |

The north-star metric is **contribution margin per attended appointment**. It is the only number that combines lead quality, operating efficiency and pricing power.

## 8. Competitive position and moat

| Alternative the client has today | Its weakness | Our edge |
|---|---|---|
| Running their own Facebook ads | Slow follow-up, unqualified leads, owner's time | 60-second AI response, qualification, booking, show-rate engine |
| Lead marketplaces (shared leads) | The same lead is sold to 3–5 installers, so it's a race to the bottom | Exclusive appointments plus territory lock |
| Marketing agencies | Paid on clicks, not outcomes | Paid only on attended appointments |
| Hiring a human SDR | R15k–R25k/month, works office hours only | Cheaper, available 24/7, consistent |

**Moat, in order of durability:**

1. **Outcome data.** Won/lost labels on thousands of conversations make our scoring and targeting compound. New entrants start with none.
2. **Territory contracts.** Locked exclusivity creates switching costs.
3. **Owned SEO assets.** Lead cost drops toward zero over time, and the sites have resale value.
4. **Process IP.** Qualification scripts, reminder cadences and dispute rules, refined on real volume.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Funnel underperforms (the conservative case **loses ~R132k/month**) | Medium | **Severe** | Weekly kill switch at R950 cost per attended appointment. Start with R500/day ad budget caps. Scale only after 3 green weeks. |
| Working-capital squeeze from ad spend | High | High | Mandatory prepaid credit. Never run ads for a client with less than 1 week of credit. |
| Meta ad account restriction | Medium | High | Two business managers, a strict ad-policy checklist, Google as second channel, SEO as a hedge |
| POPIA complaint or Information Regulator action | Low–Med | Severe | Consent ledger, Information Officer registered, DPIA done before launch ([04-compliance.md](04-compliance.md)) |
| Client disputes no-shows dishonestly | Medium | Medium | The lead confirms attendance via WhatsApp. GPS check-in is optional. Repeat disputers get offboarded. |
| Demand shock in the vertical | Low–Med | High | Second vertical (security) live by month 4 |
| AI agent says something wrong or off-brand | Medium | Medium | Constrained prompts, a list of forbidden claims, human handoff, transcript QA sampling ([03-architecture.md](03-architecture.md) §5) |

## 10. Financial summary (base case, month 12)

From [`tools/unit_economics.py`](../tools/unit_economics.py), base scenario:

- **15 clients × 25 attended appointments = 375 appointments/month**
- Revenue **R487,500/month**, gross profit **R247,266/month**, operating profit **R222,266/month** (before founder salary and tax)
- Break-even at **45 attended appointments/month**, about 2 clients

These are model outputs from stated assumptions. The pilot exists to turn them into measured numbers.

## 11. The ask

1. **R60k validation budget:** about R40k ad spend plus R20k tooling and legal review, over 60 days.
2. **Go/no-go gate at day 60:** cost per attended appointment ≤ R650, show rate ≥ 75%, and ≥ 5 paying clients. If not met, stop or pivot the vertical. Sunk cost doesn't justify continuing.
