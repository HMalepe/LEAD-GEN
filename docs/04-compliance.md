# 04 — Compliance (South Africa)

> **Not legal advice.** This is an engineering and operations summary to brief a South African privacy attorney. Budget for a legal review (in the validation budget) **before** the first live ad.
>
> **Correction (v2, 7 Nov 2026):** v1 of this document said a human phone call is not an "electronic communication" under POPIA s69. That was wrong. The Information Regulator's **Guidance Note on Direct Marketing (Dec 2024)** treats telephone marketing as covered by s69, requiring prior opt-in consent for non-customers. Door-to-door and postal marketing fall outside s69. The B2B go-to-market has been changed to match ([01](01-business-plan.md) §6.1).

## 1. POPIA (Act 4 of 2013)

| Requirement | What it means for us | Implementation |
|---|---|---|
| **8 conditions for lawful processing** | Collect only what the purpose needs; keep it no longer than needed | 5 qualification answers; no ID or banking data; retention schedule ([03](03-architecture.md) §6) |
| **Openness at collection (s18)** | Say who receives the details | First WhatsApp message: "shared only with ONE vetted installer for your suburb" + privacy link |
| **Lawful basis (s11) + further processing (s15)** | Sharing a lead with an installer is further processing (Guidance Note); it must be disclosed and consented | Separate `share_with_installer` consent row; the installer brief job **checks it before sending** |
| **Direct marketing by electronic communication (s69)** | Covers SMS, email, WhatsApp **and phone calls**. Non-customers need prior consent; a single request for consent is allowed | Consumer flow is inbound-only (they message us from an ad). B2B: in-person visits, logged one-time consent requests, **no cold calls or cold email** |
| **Juristic persons are data subjects** | Installers' business contact details are protected | Same rules for the installer prospect list |
| **Data subject rights (s23–s25)** | Access, correction, deletion | `DELETE` erases PII and keeps a hashed opt-out so the number is never contacted again (tested) |
| **Security safeguards (s19)** | Reasonable technical and organisational measures | Signed webhooks (Meta, Paystack), least-privilege DB access, encrypted secrets |
| **Operators (s20–s21)** | Supabase, Meta, Anthropic, Paystack, hosting | Data processing agreements on file for each |
| **Cross-border transfer (s72)** | Hosting, Meta and the LLM provider are outside SA | Record the s72 basis per vendor; the LLM receives **only the single answer text**, never name or phone |
| **Information Officer** | Must be registered with the Information Regulator | Founder registers before launch |
| **Penalties** | Administrative fines up to R10 million (s109) | — |

## 2. CPA (Act 68 of 2008) and the National Opt-Out Registry

- **s11 right to block direct marketing.** The National Consumer Commission's **National Opt-Out Registry** is live. **Direct marketers must register between 15 Sep and 31 Dec 2026**; failing to register after that is a contravention of s11. Fees: R2,574 initial, R1,930.50 annual renewal, R0.12 per entry to clean a database. Consumers can register blocks from **May 2027**; databases must then be cleaned against the registry before marketing. Sources: [Bowmans](https://bowmanslaw.com/insights/south-africa-launch-of-the-national-opt-out-registry-direct-marketer-registration-draft-guidelines-and-more/), [CDH](https://www.cliffedekkerhofmeyr.com/news/publications/2026/South-Africa/Corporate-Commercial/combined-corporate-and-commercial-and-insurance-law-alert-26-august-2026-cpa-direct-marketing-amendments-when-the-cpa-applies-to-fsps-and-insurers), [gov.za](https://www.gov.za/news/media-statements/national-consumer-commission-launches-national-opt-out-registry-07-oct-2026). Penalties reported up to R1m or 10% of turnover (s112).
  → **Action: register LEAD-GEN as a direct marketer before 31 Dec 2026.** We market to installers, and any future nurture campaign to households is direct marketing.
- **s12 + regulations: contact hours for direct marketing.** Not on Sundays or public holidays; Saturdays only 09:00–13:00; other days only 08:00–20:00. Implemented in `quietHours.ts` (`isContactAllowed`, SA holidays incl. Easter and Sunday→Monday substitution). Service messages the household asked for (reminders, attendance checks) use a separate 07:00–21:00 courtesy window.
- **Fair, honest dealing.** No guaranteed savings or false urgency. The budget question quotes the *typical* market range only.

## 3. ECTA (Act 25 of 2002), s45
Unsolicited commercial messages must offer an opt-out and identify the sender. Every conversation states the sender and STOP / DELETE.

## 4. Trade and safety rules that affect who we list

| Rule | Why it matters for water backup | Our control |
|---|---|---|
| **Electrical Installation Regulations, 2009**: registered electrical contractors (reg 6); only registered persons issue a COC (reg 9(1)); altered installations need a new COC (reg 7(4)) | Pump and booster circuits are usually new or altered electrical work | Installer must have a registered electrician (staff or partner); contract condition; checked at onboarding |
| **PIRB**: only PIRB-licensed plumbers issue a PIRB Certificate of Compliance (geysers, solar water, heat pumps). Registration is voluntary, and SANS 10254 (amended 2022) no longer names PIRB explicitly | Matters for the geyser playbook and for trust | List only PIRB-registered providers for geyser work; show their number |
| **Boreholes**: no national registration for Schedule 1 domestic use (DWS to Outa, Jul 2026), but City of Johannesburg registration and drilling approval apply | Upsell path | Only list drillers who handle municipal permits |
| **RICA (Act 70 of 2002) s4–s6**: a call-tracking platform may not be a "party" to a call it records | Only if tracked call numbers are added later | WhatsApp-first: no call recording today. If added: pre-connect notice + s5 consent in the installer contract |

## 5. Platform rules (as binding as law in practice)

| Platform | Rules | Control |
|---|---|---|
| **WhatsApp Business** | Business-initiated messages outside the 24h customer service window must use **approved templates**; opt-in required; quality rating affects limits | `sendSmart` sends free text inside the window and a template outside it. Register the 8 templates in `templates.ts` (Utility category). |
| **Meta Ads** | No sensational or fear-based claims; trademark care | Copy cites dated Johannesburg Water / Rand Water statements only; "JoJo" used descriptively, never as affiliation |
| **Meta Conversions API** | Sending click IDs and purchase values to Meta is sharing with an operator | Only `ctwa_clid` + event + value are sent (no name or phone); disclosed in the privacy notice |
| **Paystack** | PCI scope sits with Paystack; webhooks must be verified | We never touch card data; HMAC-SHA512 signature verified; crediting is idempotent |

## 6. Pre-launch checklist
- [ ] Information Officer registered with the Information Regulator
- [ ] **Direct-marketer registration on the NCC National Opt-Out Registry (before 31 Dec 2026)**
- [ ] Privacy notice: purposes, the single-installer sharing, operators (Meta, Anthropic, Paystack, hosting), cross-border basis, rights, contact
- [ ] Personal Information Impact Assessment filed
- [ ] DPAs accepted: hosting/Supabase, Meta, Anthropic, Paystack
- [ ] Attorney review: consent wording (`playbooks/water.ts` intro), installer contract, ad copy
- [ ] 8 WhatsApp templates approved
- [ ] Installer onboarding checklist: registered electrician / COC capability, PIRB number if applicable, signed contract
- [ ] STOP / DELETE / quiet hours tested in staging (automated tests already cover the logic)
- [ ] Breach response (s22): who notifies the Regulator and data subjects, and how fast
