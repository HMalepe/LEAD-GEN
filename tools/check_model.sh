#!/usr/bin/env bash
# Fail if the scenario table in docs/02-unit-economics.md drifts from the model output.
set -euo pipefail
cd "$(dirname "$0")/.."
diff <(python3 tools/unit_economics.py --markdown | sed -n '/^| Metric/,/^| Break-even/p') \
     <(sed -n '/^| Metric/,/^| Break-even/p' docs/02-unit-economics.md) \
  && diff <(python3 tools/unit_economics.py --markdown | sed -n '/^| Shock/,$p') \
          <(sed -n '/^| Shock/,/^$/p' docs/02-unit-economics.md | sed '/^$/d') \
  && echo "model and docs agree"
