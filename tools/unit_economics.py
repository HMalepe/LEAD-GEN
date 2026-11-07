#!/usr/bin/env python3
"""
LEAD-GEN unit economics model.

Single source of truth for every number quoted in docs/02-unit-economics.md.
Change an assumption here, re-run, and paste the output into the doc.

    python3 tools/unit_economics.py            # all scenarios
    python3 tools/unit_economics.py --markdown # markdown tables for the docs

All money is in South African Rand (ZAR). All inputs are ASSUMPTIONS to be
validated in the 30-day pilot (see docs/05-roadmap.md), not observed data.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass, replace


@dataclass(frozen=True)
class Scenario:
    name: str
    # --- Acquisition funnel (our side) ---
    cost_per_raw_lead: float        # paid media spend per inbound lead (R)
    raw_to_qualified: float         # share of raw leads that pass AI qualification
    qualified_to_booked: float      # share of qualified leads that book an appointment
    ai_msg_cost_per_lead: float     # LLM + WhatsApp + SMS cost per raw lead (R)
    show_rate: float                # booked appointments that actually happen
    # --- Pricing ---
    price_per_appointment: float    # what the client pays per *attended* appointment (R)
    platform_fee_per_client: float  # monthly retainer per client (R)
    # --- Client side (proves the ROI we sell) ---
    client_close_rate: float        # client's appointment -> sale conversion
    client_avg_job_value: float     # average contract value (R)
    client_gross_margin: float      # client's gross margin on a job
    # --- Scale ---
    clients: int
    appointments_per_client: int    # attended appointments per client per month
    fixed_costs_month: float        # tooling, hosting, phone, insurance (excl. founder pay)


# ---------------- Backup water systems, Sandton / Bryanston / Randburg (launch) ----------------
# Job value: HC Water Backup published packages R15,550–R19,880 (see docs/06).
# Funnel rates are higher than solar because demand is urgent (dry taps), and the
# CPL is an ASSUMPTION for a hyper-local Click-to-WhatsApp audience: validate first.

WATER_BASE = Scenario(
    name="Water base",
    cost_per_raw_lead=60.0,
    raw_to_qualified=0.50,
    qualified_to_booked=0.65,
    ai_msg_cost_per_lead=3.0,
    show_rate=0.85,
    price_per_appointment=550.0,
    platform_fee_per_client=1500.0,
    client_close_rate=0.30,
    client_avg_job_value=16_500.0,
    client_gross_margin=0.30,
    clients=12,
    appointments_per_client=30,
    fixed_costs_month=25_000.0,
)

WATER_CONSERVATIVE = replace(
    WATER_BASE,
    name="Water conservative",
    cost_per_raw_lead=100.0,
    raw_to_qualified=0.35,
    qualified_to_booked=0.55,
    show_rate=0.75,
    price_per_appointment=450.0,
    client_close_rate=0.22,
    clients=6,
    appointments_per_client=20,
)

WATER_AGGRESSIVE = replace(
    WATER_BASE,
    name="Water aggressive",
    cost_per_raw_lead=40.0,
    raw_to_qualified=0.55,
    qualified_to_booked=0.70,
    show_rate=0.90,
    price_per_appointment=650.0,
    clients=20,
    appointments_per_client=40,
)

# ---------------- Residential solar, Gauteng (original thesis, now secondary) ----------------

BASE = Scenario(
    name="Base",
    cost_per_raw_lead=120.0,
    raw_to_qualified=0.40,
    qualified_to_booked=0.60,
    ai_msg_cost_per_lead=3.0,
    show_rate=0.80,
    price_per_appointment=1200.0,
    platform_fee_per_client=2500.0,
    client_close_rate=0.25,
    client_avg_job_value=90_000.0,
    client_gross_margin=0.25,
    clients=15,
    appointments_per_client=25,
    fixed_costs_month=25_000.0,
)

CONSERVATIVE = replace(
    BASE,
    name="Conservative",
    cost_per_raw_lead=180.0,
    raw_to_qualified=0.30,
    qualified_to_booked=0.50,
    show_rate=0.70,
    price_per_appointment=950.0,
    client_close_rate=0.18,
    clients=8,
    appointments_per_client=20,
)

AGGRESSIVE = replace(
    BASE,
    name="Aggressive",
    cost_per_raw_lead=90.0,
    raw_to_qualified=0.45,
    qualified_to_booked=0.65,
    show_rate=0.85,
    price_per_appointment=1500.0,
    client_close_rate=0.30,
    clients=30,
    appointments_per_client=30,
)


@dataclass(frozen=True)
class Result:
    raw_leads_per_attended: float
    cost_per_attended: float
    margin_per_attended: float
    margin_pct: float
    client_value_per_appt: float
    client_roi_multiple: float
    monthly_appointments: int
    monthly_revenue: float
    monthly_gross_profit: float
    monthly_operating_profit: float
    breakeven_appointments: float
    ad_spend_month: float


def evaluate(s: Scenario) -> Result:
    attended_per_raw = s.raw_to_qualified * s.qualified_to_booked * s.show_rate
    raw_per_attended = 1.0 / attended_per_raw
    cost_per_attended = raw_per_attended * (s.cost_per_raw_lead + s.ai_msg_cost_per_lead)
    margin = s.price_per_appointment - cost_per_attended

    client_value = s.client_close_rate * s.client_avg_job_value * s.client_gross_margin
    roi = client_value / s.price_per_appointment

    appts = s.clients * s.appointments_per_client
    revenue = appts * s.price_per_appointment + s.clients * s.platform_fee_per_client
    gross = appts * margin + s.clients * s.platform_fee_per_client
    op = gross - s.fixed_costs_month
    breakeven = s.fixed_costs_month / margin if margin > 0 else float("inf")
    ad_spend = appts * raw_per_attended * s.cost_per_raw_lead

    return Result(
        raw_leads_per_attended=raw_per_attended,
        cost_per_attended=cost_per_attended,
        margin_per_attended=margin,
        margin_pct=margin / s.price_per_appointment,
        client_value_per_appt=client_value,
        client_roi_multiple=roi,
        monthly_appointments=appts,
        monthly_revenue=revenue,
        monthly_gross_profit=gross,
        monthly_operating_profit=op,
        breakeven_appointments=breakeven,
        ad_spend_month=ad_spend,
    )


VERTICALS = {
    "water": [WATER_CONSERVATIVE, WATER_BASE, WATER_AGGRESSIVE],
    "solar": [CONSERVATIVE, BASE, AGGRESSIVE],
}


def max_cost_per_raw_lead(s: Scenario, target_margin: float = 0.0) -> float:
    """Highest paid-media CPL at which an attended appointment still earns `target_margin` of price."""
    attended_per_raw = s.raw_to_qualified * s.qualified_to_booked * s.show_rate
    return s.price_per_appointment * (1 - target_margin) * attended_per_raw - s.ai_msg_cost_per_lead


def sensitivity(base: Scenario) -> list[tuple[str, float, float]]:
    """Operating-profit impact of a 20% adverse move in each key driver."""
    base_op = evaluate(base).monthly_operating_profit
    shocks = {
        "Cost per raw lead +20%": replace(base, cost_per_raw_lead=base.cost_per_raw_lead * 1.2),
        "Raw->qualified -20%": replace(base, raw_to_qualified=base.raw_to_qualified * 0.8),
        "Qualified->booked -20%": replace(base, qualified_to_booked=base.qualified_to_booked * 0.8),
        "Show rate -20%": replace(base, show_rate=base.show_rate * 0.8),
        "Price per appointment -20%": replace(base, price_per_appointment=base.price_per_appointment * 0.8),
    }
    out = []
    for label, sc in shocks.items():
        op = evaluate(sc).monthly_operating_profit
        out.append((label, op, op - base_op))
    return sorted(out, key=lambda r: r[2])


def r(x: float) -> str:
    return f"R{x:,.0f}"


def markdown(scenarios: list[Scenario], base: Scenario) -> str:
    rows = [(s, evaluate(s)) for s in scenarios]
    head = "| Metric | " + " | ".join(s.name for s, _ in rows) + " |"
    sep = "|---|" + "---:|" * len(rows)
    lines = [head, sep]

    def add(label, fn):
        lines.append(f"| {label} | " + " | ".join(fn(s, res) for s, res in rows) + " |")

    add("Raw leads per attended appointment", lambda s, x: f"{x.raw_leads_per_attended:.1f}")
    add("Fully loaded cost per attended appointment", lambda s, x: r(x.cost_per_attended))
    add("Price per attended appointment", lambda s, x: r(s.price_per_appointment))
    add("Contribution margin per appointment", lambda s, x: f"{r(x.margin_per_attended)} ({x.margin_pct:.0%})")
    add("Client gross profit per appointment", lambda s, x: r(x.client_value_per_appt))
    add("Client ROI on our fee", lambda s, x: f"{x.client_roi_multiple:.1f}x")
    add("Clients", lambda s, x: str(s.clients))
    add("Attended appointments / month", lambda s, x: str(x.monthly_appointments))
    add("Ad spend / month", lambda s, x: r(x.ad_spend_month))
    add("Revenue / month", lambda s, x: r(x.monthly_revenue))
    add("Gross profit / month", lambda s, x: r(x.monthly_gross_profit))
    add("Fixed costs / month", lambda s, x: r(s.fixed_costs_month))
    add("Operating profit / month", lambda s, x: r(x.monthly_operating_profit))
    add("Break-even appointments / month (excl. retainers)", lambda s, x: f"{x.breakeven_appointments:.0f}")

    lines.append("")
    lines.append(f"**Sensitivity ({base.name} scenario, 20% adverse move, ranked by damage):**")
    lines.append("")
    lines.append("| Shock | Operating profit / month | Change |")
    lines.append("|---|---:|---:|")
    for label, op, delta in sensitivity(base):
        lines.append(f"| {label} | {r(op)} | {r(delta)} |")
    return "\n".join(lines)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--markdown", action="store_true", help="emit markdown tables")
    p.add_argument("--vertical", choices=sorted(VERTICALS), default="water")
    args = p.parse_args()
    scenarios = VERTICALS[args.vertical]
    base = scenarios[1]
    if args.markdown:
        print(markdown(scenarios, base))
        print()
        print(f"**Kill switch:** at base-case conversion rates, paid media must stay under "
              f"{r(max_cost_per_raw_lead(base))} per raw lead to break even per visit, and under "
              f"{r(max_cost_per_raw_lead(base, 0.40))} to keep a 40% contribution margin.")
        return
    for s in scenarios:
        x = evaluate(s)
        print(f"== {s.name} ==")
        for k, v in x.__dict__.items():
            print(f"  {k:28s} {v:,.2f}")


if __name__ == "__main__":
    main()
