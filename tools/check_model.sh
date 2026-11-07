#!/usr/bin/env bash
# Fail if the water scenario tables in docs/02-unit-economics.md drift from the model output.
set -euo pipefail
cd "$(dirname "$0")/.."
model=$(python3 tools/unit_economics.py --markdown)
doc=$(cat docs/02-unit-economics.md)
diff <(sed -n '/^| Metric | Water/,/^| Break-even/p' <<<"$model") <(sed -n '/^| Metric | Water/,/^| Break-even/p' <<<"$doc")
diff <(sed -n '/^| Shock/,/^$/p' <<<"$model" | sed '/^$/d') <(sed -n '/^| Shock/,/^$/p' <<<"$doc" | sed '/^$/d')
grep -qF "$(grep '^\*\*Kill switch' <<<"$model")" docs/02-unit-economics.md
diff <(python3 tools/unit_economics.py --markdown --vertical solar | sed -n '/^| Metric/,/^| Break-even/p') \
     <(sed -n '/^| Metric | Conservative/,/^| Break-even/p' <<<"$doc")
echo "model and docs agree"
