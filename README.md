<div align="center">

# SaveMyTokens

### Decide which project gets your Claude allowance.

<code>npx savemytokens</code>

<img src="https://img.shields.io/badge/dependencies-0-1a7f37?style=flat-square" alt="zero dependencies">
<img src="https://img.shields.io/badge/node-%E2%89%A5%2018.17-2b7489?style=flat-square" alt="node 18.17+">
<img src="https://img.shields.io/badge/local%20only-no%20network%20call-6e40c9?style=flat-square" alt="local only">
<img src="https://img.shields.io/badge/license-MIT-24292f?style=flat-square" alt="MIT">

</div>

```
  5h █████░░░░░░░  42% resets in 1h57 (18:55)    7d ██░░░░░░░░░░  18% resets in 2d3h (Sun)

  ACTIVE 3
   project        allocation used of it      priority last prompt
   webinvoke    2        50% [|||...]  45%   HIGH     Implement the provider fallback chain end to …
   buydiff               30% [|||...]  44%   NORMAL   Fix the verdict table alignment on mobile
   scratch               20% [||....]  31%   LOW      Try the alternate parser and compare

  RECENT 1
   project         last turn  last prompt
   reposhine          3h ago  This is the new plan for reposhine

  3 projects sharing this window across 4 sessions.
```

<br>

|  |  |
| :-- | :-- |
| **The real numbers** | Your 5-hour and weekly usage exactly as Anthropic publishes them — never an invented *"% remaining"*. |
| **A split you control** | Give each **project** an allocation and a priority. Spare capacity goes to the highest priority first, and a project's allocation is split across its live sessions by what they burn. |
| **Claude working to it** | As a session eats into its slice it is told to narrow scope and finish, and to write down what it dropped — which comes back next time you work on that project. |
| **Unused capacity returned** | When a project finishes, whatever it did not spend goes to the others. |
| **In your status line** | `webinvoke · target 50% · used 21% · HIGH · 5h 42% · in 3h52` — segments you pick and order, in one of thirteen themes |

<br>

| command | |
| :-- | :-- |
| `npx savemytokens` | the control centre |
| `npx savemytokens share buydiff 40` | pin a project's allocation |
| `npx savemytokens priority buydiff high` | who gets spare capacity first |
| `npx savemytokens policy strict` | wind down earlier when it gets tight |
| `npx savemytokens hud` | pick a status line, previewed on your numbers |
| `npx savemytokens audit` | what your last 7 days wasted |
| `npx savemytokens theme` | eighteen themes, or write your own |
| `npx savemytokens uninstall` | remove every trace |

<details>
<summary>Writing your own theme</summary>

<br>

```
npx savemytokens theme new mine nord   copy one to start from
npx savemytokens theme check mine      is it readable?
npx savemytokens theme tui mine        use it
```

`~/.savemytokens/themes/mine.json` — everything you leave out is inherited:

```json
{
  "colors": { "fg": "#eceff4", "dim": "#7b88a1", "accent": "#88c0d0",
              "ok": "#a3be8c", "warn": "#ebcb8b", "danger": "#e0707c", "track": "#434c5e" },
  "tui":    { "cursor": "❯", "pin": "★", "active": "●", "done": "✓",
              "fill": "▰", "empty": "▱", "over": "▶", "meter": "▰", "track": "▱" },
  "glyphs": { "sep": "·" }
}
```

`theme check` measures every colour against the terminal and fails anything unreadable — the same
bar the built-in themes have to clear.

</details>

<div align="center">
<br>
<sub>No daemon · no account · nothing leaves your machine</sub>
</div>
