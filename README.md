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
| **The real numbers** | Your 5-hour and weekly usage exactly as Anthropic publishes it. Never an invented *"% remaining"*. |
| **A split you control** | Give each **project** an allocation and a priority. Spare capacity goes to the highest priority first, and a project's allocation is divided among its live sessions by what they burn. |
| **Claude working to it** | As a session eats into its slice it is told to narrow scope and finish, and to write down whatever it drops. That comes back the next time you work on the project. |
| **Unused capacity returned** | When a project finishes, whatever it did not spend goes to the others. |
| **In your status line** | `webinvoke · 21%/50% · 5h 42% · in 3h52` — pick a shape, or arrange the pieces yourself |

<br>

## Where the numbers come from

Three different kinds of number sit on that screen, and it matters which is which.

| | |
| :-- | :-- |
| **5h and 7d** | Anthropic's own figures. Claude Code publishes them to the status line, so SaveMyTokens installs one, reads them, and stores each reading with its timestamp. Nothing is estimated. |
| **share** | Measured from the transcripts already on your disk, token by token, including subagents. Exact, and independent of anything Anthropic reports. |
| **used, allocation** | Anthropic's percentage, split by that measured share. The total is theirs. The division between projects is ours, and it is the only inferred number on the screen. |

Usage from another machine, or from claude.ai, is invisible to a local tool. When the window moves
while none of your projects had a turn, that is reported on its own line rather than folded silently
into a project's figure.

## How it works

`install` writes three scripts to `~/.savemytokens/hooks`, adds four hook entries and a status line
to Claude Code's `settings.json`, and backs that file up first. There is no daemon. The hooks meter their own
session as it runs, the status line captures the published window every ten seconds, and the control
centre reads what they leave behind. Transcripts are read incrementally, from a stored byte offset
per file, so a prompt costs milliseconds however long the session has run.

Nothing outside `~/.savemytokens` and Claude Code's own settings is touched. `uninstall` puts it
back, and restores a status line of your own if it wrapped one.

## Requirements

Node 18.17 or newer, and Claude Code 2.1.x. The published 5h and 7d figures come with a Claude
subscription. On an API key or through the Console, Anthropic reports no window; SaveMyTokens says so
rather than guessing, and allocation and advice still work from measured usage alone.

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
| `npx savemytokens defer` | work a session pushed to next time |
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

## What it will not do

It advises; it does not enforce. The hooks inject text, and a model does not hold a budget the way a
scheduler holds a lock. A session that ignores the advice keeps running. Hard caps are the next step,
and will ship only after a period of logging what *would* have been blocked.

<div align="center">
<br>
<sub>No daemon · no account · nothing leaves your machine · MIT</sub>
</div>
