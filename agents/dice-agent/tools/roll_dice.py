"""roll_dice: --notation <dice_notation>; prints one JSON value on stdout.

Expected failures (invalid notation, out-of-range values) are JSON with an
"error" field and exit 0, so the model sees a useful message. Exit non-zero
only on bugs.
"""
import argparse
import json
import random
import re
import sys

parser = argparse.ArgumentParser()
parser.add_argument("--notation", required=True)
args = parser.parse_args()

notation = args.notation.strip()

# Match the notation pattern: count d sides optional[+/- modifier]
match = re.match(r"^([1-9]\d{0,2})d([1-9]\d{0,3})([+-]\d{1,4})?$", notation)
if not match:
    json.dump(
        {
            "error": "invalid_notation",
            "message": (
                f"'{notation}' is not valid dice notation. "
                "Use the format: <count>d<sides> optional <+/-><modifier>. "
                "Example: '2d6', '1d20+5', '4d8-2'."
            ),
        },
        sys.stdout,
    )
    sys.exit(0)

count_str, sides_str, mod_str = match.groups()
count = int(count_str)
sides = int(sides_str)
modifier = int(mod_str) if mod_str else 0

# Validate ranges (pattern already excludes zero and non-numeric garbage)
if count < 1 or count > 100:
    json.dump(
        {
            "error": "invalid_count",
            "message": f"Number of dice must be between 1 and 100, got {count}.",
        },
        sys.stdout,
    )
    sys.exit(0)
if sides < 2 or sides > 1000:
    json.dump(
        {
            "error": "invalid_sides",
            "message": f"Number of sides must be between 2 and 1000, got {sides}.",
        },
        sys.stdout,
    )
    sys.exit(0)
if modifier < -1000 or modifier > 1000:
    json.dump(
        {
            "error": "invalid_modifier",
            "message": (
                f"Modifier must be between -1000 and 1000, got {modifier}."
            ),
        },
        sys.stdout,
    )
    sys.exit(0)

# Roll the dice
rolls = [random.randint(1, sides) for _ in range(count)]
total = sum(rolls) + modifier

json.dump({"rolls": rolls, "modifier": modifier, "total": total}, sys.stdout)