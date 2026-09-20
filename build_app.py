#!/usr/bin/env python3
"""Assemble app.js from the pieces in parts/.

Everything the build needs lives in this repo — parts/ files are concatenated
in filename order inside a single IIFE. Edit parts/, run this, commit both.
"""
import io
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PARTS = os.path.join(HERE, "parts")
OUT = os.path.join(HERE, "app.js")

names = sorted(n for n in os.listdir(PARTS) if n.endswith(".js"))
if not names:
    sys.exit("no parts found in " + PARTS)

pieces = [io.open(os.path.join(PARTS, n), encoding="utf-8").read() for n in names]
app = "\n".join(pieces)

io.open(OUT, "w", encoding="utf-8").write(app)

# The first part opens one IIFE and the last closes it.
assert "(function(){" in app, "IIFE opener missing"
assert app.rstrip().endswith("})();"), "IIFE not closed"

subprocess.check_call(["node", "--check", OUT])
print("built app.js  %d bytes from %d parts:" % (len(app), len(names)))
for n in names:
    print("   ", n)
