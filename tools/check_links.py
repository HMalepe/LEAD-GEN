#!/usr/bin/env python3
"""Fail if any relative markdown link in the repo points at a missing file."""
import pathlib, re, sys

root = pathlib.Path(__file__).resolve().parent.parent
bad = []
for md in root.rglob("*.md"):
    if "node_modules" in md.parts:
        continue
    for target in re.findall(r"\]\(([^)#\s]+)(?:#[^)]*)?\)", md.read_text(encoding="utf-8")):
        if re.match(r"^[a-z]+:", target):
            continue
        if not (md.parent / target).resolve().exists():
            bad.append(f"{md.relative_to(root)} -> {target}")
print("\n".join(bad) or "all links ok")
sys.exit(1 if bad else 0)
