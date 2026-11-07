# 04 — Compliance (South Africa)

> **Not legal advice.** This is an engineering and operations summary to brief a South African privacy attorney. Budget for a one-off legal review (included in the R60k validation budget) **before** the first live ad runs.

Lead generation means processing personal information for direct marketing. That's the area the Information Regulator watches most closely, so compliance is part of the product's core, not an add-on.

## 1. POPIA (Protection of Personal Information Act 4 of 2013)

In force since 1 July 2020, enforced since 1 July 2021.

| Requirement | What it means for us | How we implement it |
|---|---|---|
| **8 conditions for lawful processing** (accountability, processing limitation, purpose specification, further processing limitation, information quality, openness, security safeguards, data subject participation) | Collect only what the purpose needs and keep it no longer than needed | Minimal qualification fields, retention schedule ([03-architecture.md](03-architecture.md) §6) |
| **Lawful basis (§11)** | The homeowner messaged us first. Consent covers sharing their details with one installer. | Consent ledger row with the exact wording, per purpose |
| **Direct marketing by electronic communication (§69)** | Unsolicited SMS, email or WhatsApp marketing needs prior consent, or an existing-customer relationship. We may ask a non-consenting person for consent **once**. | Inbound-only consumer flow. B2B outreach by warm call or a single logged consent request. No bulk cold email. |
| **Juristic persons are data subjects** | Installers' business contact data is protected too | Applies to our B2B prospecting list as well |
| **Openness (§18)** | Tell people who we are, why we're collecting, and who receives their data | First WhatsApp message plus a privacy notice link |
| **Data subject rights (§23–§25)** | Access, correction, deletion | "Reply DELETE" flow plus an email channel. `erased_at` erasure job. |
| **Security safeguards (§19)** | Reasonable technical and organisational measures | RLS, encryption, access logging, key rotation |
| **Operators (§20–§21)** | Supabase, Meta, LLM provider, Paystack are operators | Data processing agreements on file for each |
| **Cross-border transfer (§72)** | Hosting or AI outside SA needs adequate protection, a binding agreement, or consent | Record the §72 basis per vendor. Prefer vendors with GDPR-grade DPAs. |
| **Information Officer** | Must be registered with the Information Regulator | Founder registered as Information Officer before launch |
| **Penalties** | Administrative fines up to R10 million, and criminal sanctions for certain offences | That's why this document exists |

## 2. ECTA (Electronic Communications and Transactions Act 25 of 2002), §45

Any unsolicited commercial communication must give an opt-out and, on request, say where the contact details came from. → Every outbound template includes the sender identity and "reply STOP to opt out".

## 3. CPA (Consumer Protection Act 68 of 2008)

- **§11:** consumers can refuse and block direct marketing → the STOP keyword immediately writes `consents.granted = false`, and every send checks `current_consent` first.
- **§12 + regulations:** limits on when consumers may be contacted for direct marketing (no Sundays or public holidays, restricted hours on Saturdays and weekdays) → the reminder and nurture scheduler enforces SA quiet hours. Service messages the lead requested (appointment reminders) should still respect them as good practice.
- **Fair, honest dealing:** no savings guarantees, no fake urgency → enforced in the agent's forbidden-claims list.

## 4. Platform policies (as binding as law in practice)

| Platform | Key rules | Our control |
|---|---|---|
| **WhatsApp Business** | Business-initiated messages need opt-in and approved templates. Free-form replies only inside the customer service window. Quality rating affects messaging limits. | Template library with versioning. Opt-in logged. Monitor the quality rating daily. |
| **Meta Ads** | Ad policies on claims and before/after imagery. "Special Ad Categories" (credit and financial services) restrict targeting, and solar *finance* offers may fall under them. | Ad copy checklist. Keep finance claims out of ads unless the campaign is set up as a special category. |
| **Google Ads** | Local-services and misrepresentation policies | No unverifiable claims. Business identity verified. |

## 5. Pre-launch compliance checklist

- [ ] Information Officer registered with the Information Regulator
- [ ] Privacy notice published (purpose, recipients, rights, contact, cross-border basis)
- [ ] Personal Information Impact Assessment completed and filed
- [ ] DPAs signed or accepted: Supabase, Meta, LLM provider, Paystack, Twilio
- [ ] Consent wording reviewed by attorney and stored as versioned constants
- [ ] STOP / DELETE flows tested end to end
- [ ] Quiet-hours enforcement tested
- [ ] Client contract: data-sharing clause, outcome-reporting obligation, prohibition on reselling leads
- [ ] Incident response: who notifies the Regulator and data subjects of a breach (§22), and how fast
