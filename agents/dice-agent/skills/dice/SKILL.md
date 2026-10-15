---
name: dice
description: How to use dice-agent's roll_dice tool and read its output
---

# dice

## roll_dice output fields

- `rolls`: a list of integers, one per die rolled. Each value is between
  1 and the number of sides (inclusive).
- `modifier`: an integer added to (or subtracted from) the sum of the rolls.
  Zero if no modifier was in the notation.
- `total`: the sum of all rolls plus the modifier.

## Domain knowledge

Standard dice notation: `<count>d<sides>` optionally followed by
`+<modifier>` or `-<modifier>`. Examples: "2d6" (two six-sided dice),
"1d20+5" (one twenty-sided die plus five), "4d8-2" (four eight-sided
dice minus two).

If the notation is invalid (e.g. missing a letter, out-of-range values),
the tool returns an `error` field with a message explaining the problem.