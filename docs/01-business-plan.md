# 01 — Business Plan

> **Status:** v2 (7 Nov 2026). The launch vertical moved from solar to **backup water systems** after the niche research ([06](06-niche-research-review.md)). Every number is either sourced or marked as an *assumption* to be validated in the pilot ([05](05-roadmap.md)).

## 1. The thesis in one paragraph

Households and body corporates in Sandton, Bryanston and Randburg are facing repeated, worsening water outages. A complete tank-and-pump system costs about R15,500–R20,000 installed, so the demand is urgent and high value. The supply side is fragmented: individual plumbers with suburb SEO pages, and no trusted neutral way to get a vetted installer to your door *today*. LEAD-GEN sells installers **attended site visits, not leads**. Our ads open a WhatsApp chat, an AI agent qualifies the household in under 60 seconds, books a same-day visit with **one** installer for that suburb, and reminds the household so the visit happens. Billing is per attended visit, from prepaid credit, after a 48-hour dispute window. Installers report won/lost on WhatsApp, and that outcome data trains Meta to find more buyers. Competitors without the data can't copy that.

## 2. Why now

| Force | Evidence | Implication |
|---|---|---|
| **Water is the live crisis** | Sandton, Randburg and other Joburg systems in a second week of outages on 2 Nov 2026; Joburg exceeded its Rand Water target every month Jan–Sep 2026; ~49% non-revenue water ([06](06-niche-research-review.md) §1) | "Dry taps today" demand converts far better than "save money on power" |
| **Electricity is no longer the driver** | Eskom: a full year without load-shedding (16 May 2026) | Solar is now a considered purchase, so it's our second playbook, not the first |
| **Speed-to-lead decides deals** | Firms that respond within an hour are ~7× more likely to qualify a lead (Oldroyd et al., *HBR* 2011) | A 60-second WhatsApp reply, 24/7, beats every owner-operated plumber |
| **Installers hate shared leads** | Kandua (Santam) dropped pay-per-lead for one-to-one matching in June 2026; Bark reviews complain about cost per job | Exclusive, attended visits are what the market is moving to |
| **Property value signal** | Bryanston listings advertise "backup water" as a headline feature | Landlords, sellers and body corporates are buyers too, not only distressed households |

## 3. Market and vertical selection

The research ranked ten niches ([source](research/2026-11-niche-research.md)). Re-scored on our model, which sells attended visits:

| Criterion (weight) | Backup water | Plumbing / geysers | Gate motors | Solar servicing | Boreholes |
|---|---|---|---|---|---|
| Urgency (25%) | 5 | 5 | 4 | 2 | 2 |
| Job value (25%) | 4 | 3 | 2 | 5 | 5 |
| Competition, inverted (20%) | 4 | 2 | 3 | 2 | 3 |
| Repeat / upsell (15%) | 3 | 4 | 4 | 3 | 3 |
| Speed to close (15%) | 4 | 5 | 5 | 2 | 1 |
| **Weighted** | **4.10** | **3.75** | **3.45** | **2.90** | **2.95** |

**Decision:** launch **backup water systems** in 18 suburbs (Sandton, Sandown, Bryanston, Morningside, Illovo, Rivonia, Sandhurst, Hyde Park, Wendywood, Randburg, Ferndale, Blairgowrie, Northriding, Olivedale, Bromhof, Fontainebleau, Robindale, Bordeaux). Next playbook: **emergency plumbing and geysers**, same households and partly the same installers. Boreholes are an upsell, not a launch niche.

## 4. Ideal Customer Profile

**Buyer (installer):** a plumbing or water-backup business in the northern suburbs with:
- 2–20 staff and at least one install team available for same-day or next-day visits
- A **registered electrician** on staff or as a partner (pump circuits need a COC), and PIRB registration where plumbing work is involved
- Capacity for **15–40 more visits a month**
- An owner who runs the business on WhatsApp (that's our delivery channel)

**Disqualify:** no install capacity, no COC capability, won't report outcomes, or wants "a list of numbers".

**Household (the lead):** owns the property (house, townhouse or body corporate) in one of the 18 suburbs, needs a backup system now or soon, and can afford roughly R10k–R20k+. Renters are asked to involve their landlord. Refill-only requests go to a separate refill partner.

## 5. The offer

### 5.1 Product: "Attended Site Visit as a Service"
1. **Demand:** Meta Click-to-WhatsApp ads per suburb cluster, plus an SEO directory site (outage status page, 2026 price table, litres calculator) whose CTA is "WhatsApp us".
2. **Qualification (AI, WhatsApp):** property type, suburb, need, timeline and budget. The budget question anchors the typical R15k–R20k price, which filters out tyre-kickers early. Scored 0–100.
3. **Booking:** a same-day visit ≥ 2h ahead, Saturdays included, from the installer who holds that suburb.
4. **Show-rate engine:** confirmation, a 2h "on the way" reminder (plus a 24h reminder when booked further ahead), and an attendance check after the slot.
5. **Delivery:** the installer gets a WhatsApp brief with the household's answers and a booking reference.
6. **Closed loop:** the installer replies `WON <ref> <amount>` or `LOST <ref> <reason>`. Won value goes to Meta's Conversions API.

### 5.2 Pricing

| Tier | Price | For |
|---|---|---|
| **Pilot** | First **3 attended visits free**, then a prepaid top-up of ≥ R5,500 (10 visits) | Every new installer. Proof before payment. |
| **Growth** | **R1,500/month platform fee + R550 per attended visit**, drawn from prepaid credit | Default plan |
| **Area Lock** | Growth + **R4,000/month** for guaranteed exclusivity on a suburb set | The top 20% of installers. The research's R4k–R8k retainer range. |

**Billing rules:**
- Bill **attended** visits only. Attendance comes from the household's "yes" or the installer's WON/LOST.
- **48-hour dispute window:** an installer `NOSHOW` against a household "yes" freezes billing for ops review.
- **Prepaid credit is mandatory.** Routing reserves credit for every booked-but-unbilled visit, and ads pause automatically below one week of expected visits.
- **Outcomes within 14 days**, or the installer stops receiving bookings. This is enforced in routing, not by asking nicely.

### 5.3 Why the installer says yes (do this arithmetic in the meeting)
At a 30% close rate on a R16,500 job, the installer's cost per **won** job is R550 ÷ 0.30 = **R1,833**: 11% of revenue. For comparison, a R700 *lead* costs R2,333 per won job **before** the no-shows and unreachable contacts that we absorb. The research's "under 15% of gross margin" claim is really ~49% of gross margin ([06](06-niche-research-review.md) §2.1). Showing an installer that correction is the strongest sales argument we have.

## 6. Go-to-market

### 6.1 Installers (B2B)
The Information Regulator treats telephone marketing as covered by POPIA s69 (Guidance Note, Dec 2024), and juristic persons are data subjects. So **no cold calls and no cold email.** Instead:
1. **Walk in.** Door-to-door is outside s69 and justifiable on legitimate interests (s11(1)(f)). Visit 15 installers' premises or job sites with a one-page offer plus a live demo (`npm run simulate`).
2. **Supplier channel:** tank and pump distributors (JoJo-approved dealers, plumbing merchants) know every installer and benefit from more installs.
3. **One-time consent request** (s69(2)) only where you already have a lawful contact, logged.
4. **Proof first:** 3 free attended visits, then prepaid.

### 6.2 Households (B2C)
| Channel | Role | Notes |
|---|---|---|
| Meta Click-to-WhatsApp ads | Primary from day 1 | Suburb-cluster targeting; attribution is automatic (`ad_performance`) |
| SEO directory site | From week 2, compounding | Sourced outage-status page, price table, calculator. All CTAs open WhatsApp. |
| Google Search | Test in month 2 | "jojo tank installation bryanston" and similar. Expensive, high intent. |
| Body corporates / managing agents | Month 2 | Bigger jobs; B2B channel rules apply |

### 6.3 First 10 installers
| Week | Action | Output |
|---|---|---|
| 1 | List 40 installers from Google Maps, distributors and suburb SEO pages; score against the ICP | Top 15 |
| 1–2 | In-person visits; validate price, capacity and COC capability | 3–5 signed pilots |
| 2–3 | Ads live; 3 free visits each; collect outcomes | First measured CPL and show rate |
| 4–8 | Convert to prepaid; add installers per suburb cluster | **10 installers** |

## 7. KPIs

| Layer | KPI | Target (base) | Kill / fix threshold |
|---|---|---|---|
| Speed | Median first response | < 60 s | > 5 min |
| Cost | **Paid media per raw lead** | ≤ R60 | **> R149 for 7 days: pause that ad set** |
| Funnel | Raw → qualified | 50% | < 35% |
| Funnel | Qualified → booked | 65% | < 50% |
| Funnel | Show rate | 85% | < 75% |
| Unit | **Fully loaded cost per attended visit** | ≤ R230 | > R450 for 2 weeks |
| Installer | Close rate | 30% | < 20% (lead-quality problem) |
| Data | Outcomes reported within 14 days | > 90% | enforced by routing |
| Retention | Monthly installer churn | < 5% | > 10% |

The north-star metric is **contribution margin per attended visit**.

## 8. Competition and moat

| Alternative | Weakness | Our edge |
|---|---|---|
| Installer's own SEO / ads | Slow follow-up, unqualified enquiries, owner's time | 60-second AI qualification, same-day booking, reminders |
| Snupit / Bark (shared credits) | Same lead sold to 3–5 pros; pay even if unreachable | Exclusive, attended, suburb-locked |
| Kandua (one-to-one matching) | National generalist, consumer-app flow | Hyper-local water specialist, WhatsApp-native, outage-aware content |
| Content farms | No conversion engine | We own the conversion step |

**Moat, in order of durability:** (1) outcome data feeding Meta's optimisation, (2) suburb exclusivity contracts, (3) the owned SEO directory, (4) operating know-how on the qualification script and reminder cadence.

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Funnel underperforms (conservative case **−R48k/month**) | Medium | Severe | R149 CPL kill switch; R300/day caps per ad set; scale only after 2 green weeks |
| Crisis eases, demand drops | Medium | High | Repair, filtration and upgrade demand; December shutdowns; plumbing/geysers playbook ready |
| Meta ad account restriction | Medium | High | Sourced, non-alarmist copy; SEO site as a hedge; second business manager |
| Installer disputes attendance dishonestly | Medium | Medium | Household attendance confirmation is primary evidence; repeat disputers offboarded |
| POPIA / CPA complaint | Low–Med | Severe | Consent ledger, opt-out registry registration, Information Officer, attorney review ([04](04-compliance.md)) |
| Installer can't do the electrical work (no COC) | Medium | Medium | ICP vetting; COC capability is a contract condition |

## 10. Financial summary (water base case, month 12)

From [`tools/unit_economics.py`](../tools/unit_economics.py):
- **12 installers × 30 attended visits = 360/month**
- Revenue **R216,000/month**, gross profit **R133,900**, operating profit **R108,900** (before founder salary and tax)
- Break-even at **78 attended visits/month**, about 3 installers
- Kill switch: **R149 per raw lead**

These are model outputs from stated assumptions. The pilot turns them into measurements.

## 11. The ask
1. **R45k validation budget** over 45 days: ~R27k ad spend (3 ad sets × R300/day × 30 days), ~R2.6k opt-out registry registration, ~R15k legal review and tooling.
2. **Go/no-go at day 45:** paid media ≤ R149 per raw lead, show rate ≥ 75%, ≥ 5 installers on prepaid. If not, switch to the plumbing/geysers playbook or stop.
