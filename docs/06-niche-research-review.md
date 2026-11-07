# 06 — Niche Research Review: Backup Water, Sandton / Bryanston / Randburg

> Review of [`research/2026-11-niche-research.md`](research/2026-11-niche-research.md), dated 7 Nov 2026.
> **Verdict: adopt backup water systems as the launch vertical.** The research is strong on demand and competition. It has one material pricing error, two gaps that change the product, and a compliance point that corrected our own earlier docs.

## 1. What I verified independently (7 Nov 2026)

| Claim | Status | Source |
|---|---|---|
| Joburg outages: Sandton, Midrand, Randburg, Roodepoort and others in their **second week** as of 2 Nov 2026 | ✅ Confirmed | [gauteng.net](https://www.gauteng.net/whats-on-g/?p=43886) |
| Johannesburg Water 29 Oct notice naming **Bryanston, Illovo, Morningside** | ⚠️ Not independently found | Check [johannesburgwater.co.za](https://www.johannesburgwater.co.za) before using it in ad copy |
| Rand Water maintenance May–Jul 2026 hit Sandton/Randburg | ✅ Consistent | [Daily Maverick](https://www.dailymaverick.co.za/article/2026-05-28-water-woes-to-hit-large-parts-of-the-city-before-planned-maintenance-schedule/) |
| Information Regulator treats **phone calls** as direct marketing under POPIA s69 | ✅ Confirmed (Guidance Note, Dec 2024). Door-to-door and post fall **outside** s69 | [Moonstone](https://www.moonstone.co.za/spam-calls-are-now-electronic-communication-guidance-note-closes-direct-marketing-loophole/), [Cliffe Dekker Hofmeyr](https://www.cliffedekkerhofmeyr.com/en/news/publications/2025/Sectors/Technology-Communications/Technology-and-Communications-Alert-29-january-Navigating-the-Information-Regulators-guidance-note-on-direct-marketing) |
| CPA **National Opt-Out Registry**: direct-marketer registration 15 Sep – 31 Dec 2026; consumers from May 2027 | ✅ Confirmed; fees R2,574 initial, R1,930.50 annual, R0.12 per entry to clean | [Bowmans](https://bowmanslaw.com/insights/south-africa-launch-of-the-national-opt-out-registry-direct-marketer-registration-draft-guidelines-and-more/), [CDH](https://www.cliffedekkerhofmeyr.com/news/publications/2026/South-Africa/Corporate-Commercial/combined-corporate-and-commercial-and-insurance-law-alert-26-august-2026-cpa-direct-marketing-amendments-when-the-cpa-applies-to-fsps-and-insurers), [gov.za](https://www.gov.za/news/media-statements/national-consumer-commission-launches-national-opt-out-registry-07-oct-2026) |

## 2. Where the research is wrong or incomplete

### 2.1 Pricing error: it confused revenue with gross margin
> *"At a 25–35% close rate on R16,000 jobs, a R700 exclusive lead is still under 15% of a typical installer's gross margin per job."*

| | Value |
|---|---|
| Cost per **won** job at 30% close, R700/lead | R700 ÷ 0.30 = **R2,333** |
| As a share of **revenue** (R16,000) | 14.6%. This is the "under 15%" figure. |
| As a share of **gross margin** (R16,000 × 30% = R4,800) | **49%** |

The 15% figure is a share of revenue. As a share of gross margin it's about half. And that's per *lead*, before no-shows and unreachable contacts, so the installer's real cost per won job is higher still. Installers who do this arithmetic churn after month two.

**Our fix:** sell **attended site visits at R550**, not leads at R700. The installer's cost per won job is R550 ÷ 0.30 = **R1,833**: 11% of revenue, 38% of gross margin. That's lower, *and* the risk of no-shows and unreachable leads moves to us. We can price there because our funnel (60-second WhatsApp qualification plus reminders) is the cost advantage. See [02-unit-economics.md](02-unit-economics.md).

### 2.2 Product gap: water demand is urgent, so slots must be same-day
A household with dry taps won't wait for "a visit in 3 days". The research's own framing is "near me, now". **Implemented:** the water playbook offers **same-day slots (≥ 2h ahead), Saturdays included, earliest-first**. Solar keeps next-day-plus, spread-out slots ([`playbooks/water.ts`](../apps/worker/src/playbooks/water.ts)). The 24h reminder rarely fires for water, so the **2h reminder and the attendance check** carry the show rate.

### 2.3 Product gap: refills are a different business
Refill and delivery leads (R100–R200) need a supplier within hours, not a site visit. Mixing them into the installer funnel would destroy show rate and installer trust. **Implemented:** "Just a water refill or delivery" routes to a human handoff (`refill_request`) to be sold to refill partners as a separate, cheaper product line.

### 2.4 Directory vs. agent: keep both, in order
The research proposes an SEO directory site. We keep the **WhatsApp agent as the conversion engine** and treat the directory as a **lead source** that feeds it. Every suburb page's CTA is "WhatsApp us". The directory is a compounding, owned asset (rank-and-rent). The agent is what turns traffic into attended visits at a cost competitors can't match.

### 2.5 Call tracking and recording: not needed at launch
The research's RICA analysis is correct, but it applies to tracked call-forwarding numbers. Our channel is WhatsApp-first, so there's **no call recording to consent to**. If tracked numbers are added later, play the recording notice and put the s5 consent into the installer contract.

### 2.6 Demand risk: it's a crisis niche
If Johannesburg Water stabilises, "dry taps today" searches fall. Mitigations: (a) the same buyers need **pump servicing, filtration and tank upgrades** (repeat work, already a playbook answer); (b) December maintenance shutdowns are likely to recur; (c) plumbing/geysers is the next playbook and reuses the same installers; (d) the kill switch in §4 stops spend automatically when the economics fail.

### 2.7 Ad-copy rules
- Quote Johannesburg Water and Rand Water statements **with dates and links only**. Never claim an outage that isn't published. A "live outage status" page must be sourced and timestamped.
- "JoJo" is a trademark. Use it as a descriptive keyword ("JoJo tank installation"), never in a way that implies affiliation.
- No fear-based claims ("your taps WILL run dry"). They breach Meta ad policy and CPA fairness.

## 3. Decisions taken

| Decision | Where |
|---|---|
| Launch vertical: **backup water systems**, Sandton / Bryanston / Randburg + 15 surrounding suburbs | `apps/worker/src/playbooks/water.ts` (default playbook) |
| Product: exclusive **attended site visit at R550**, R1,500/month platform fee, optional territory lock | [01-business-plan.md](01-business-plan.md) |
| Refills: human handoff, separate partner product | `water.ts` → `refill_request` |
| Suburb routing (not postal codes); one installer per suburb set | `territories.suburbs`, migration 0004 |
| Solar demoted to second playbook | `playbooks/solar.ts` |
| Next playbook: emergency plumbing + geysers (PIRB-registered installers only) | [05-roadmap.md](05-roadmap.md) |
| B2B installer recruitment: **in person** (outside s69), not cold calls | [04-compliance.md](04-compliance.md) |
| Register as a direct marketer on the National Opt-Out Registry **before 31 Dec 2026** | [04-compliance.md](04-compliance.md) |

## 4. The numbers that decide it (water base case)

From [`tools/unit_economics.py`](../tools/unit_economics.py) (`--vertical water`):

- **3.6 raw leads → 1 attended visit**, at **R228** fully loaded cost, sold at R550 → **R322 margin (59%)**
- Month-12 base: 12 installers × 30 visits → **R216k revenue / R109k operating profit per month**
- Conservative case **loses ~R48k/month**
- **Kill switch:** paid media must stay **under R149 per raw lead** to break even per visit, and under R88 to keep a 40% margin. CPL is the single assumption with no data behind it yet. Measuring it is job #1 of the pilot.

## 5. Launch kit: what's still needed

Ticked = built in this repo. Unticked = needs you (accounts, people, money).

**Platform (built)**
- [x] Water playbook: 5 questions, suburb matching with typo tolerance, scoring, same-day slots
- [x] Suburb-based territory routing, with exclusions for no credit or overdue outcomes
- [x] Reminders, attendance check, installer brief and outcome loop on WhatsApp
- [x] Click-to-WhatsApp ad attribution + `ad_performance` view (cost per attended visit per ad)
- [x] LLM fallback for unreadable answers (Claude, constrained output, re-validated)
- [x] Prepaid credit, billing after a 48h dispute window, automatic ad pause/resume, Paystack top-ups
- [x] Conversions API events (QualifiedLead, Purchase with value)

**Accounts and approvals (you)**
- [ ] Meta Business verification + WhatsApp Business number (verification can take days, so start first)
- [ ] Register the 8 message templates in [`templates.ts`](../apps/worker/src/templates.ts) (category: Utility)
- [ ] Paystack business account (live secret key + webhook URL `/paystack/webhook`)
- [ ] Meta Events Manager dataset for Business Messaging (dataset ID)
- [ ] Hosting: one Node 22 service + Postgres (e.g. Supabase); set the `.env.example` values
- [ ] Information Officer registered with the Information Regulator
- [ ] Direct-marketer registration on the NCC Opt-Out Registry (**deadline 31 Dec 2026**, R2,574)
- [ ] Attorney review of consent wording and the installer contract

**Supply (you)**
- [ ] Recruit 3–5 installers **in person**. Vet for a registered electrician (pump circuits need a COC) and PIRB registration where plumbing work is involved.
- [ ] Installer contract: price per attended visit, 48h dispute rule, outcome reporting within 14 days, no reselling leads, data-sharing clause
- [ ] Load clients + territories (see [07-operations-runbook.md](07-operations-runbook.md))

**Demand (you)**
- [ ] 3 Click-to-WhatsApp ad sets (Bryanston/Sandton, Randburg/Ferndale, Northriding/Olivedale), R300/day cap each to start
- [ ] Sourced outage-status page + 2026 price table + litres calculator (SEO lead source, CTA = WhatsApp)
- [ ] Daily: import ad spend into `ad_spend_daily`; check `ad_performance` against the R149 kill switch
