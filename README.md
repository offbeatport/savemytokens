<div align="center">

<img src="https://raw.githubusercontent.com/offbeatport/savemytokens/main/assets/logo.svg" alt="" width="64" height="64">

# SaveMyTokens

### Decide which projects get your Claude allowance.

<a href="https://www.npmjs.com/package/savemytokens"><img src="https://img.shields.io/npm/v/savemytokens?style=flat-square&color=1a7f37&label=npm" alt="npm version"></a>
<img src="https://img.shields.io/badge/dependencies-0-1a7f37?style=flat-square" alt="zero dependencies">
<img src="https://img.shields.io/badge/node-%E2%89%A5%2018.17-2b7489?style=flat-square" alt="node 18.17+">
<img src="https://img.shields.io/badge/local%20only-no%20network%20call-6e40c9?style=flat-square" alt="local only">
<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-24292f?style=flat-square" alt="MIT"></a>

<br><br>

<img src="https://raw.githubusercontent.com/offbeatport/savemytokens/main/assets/screenshot.svg" alt="The SaveMyTokens control centre: four projects sharing one 5-hour window, three of them open, each row showing its allocation, how much of that allocation it has spent, its priority and its last prompt, above a RECENT table of everything else." width="880">

<br>

<img src="https://raw.githubusercontent.com/offbeatport/savemytokens/main/assets/statusline.svg" alt="A Claude Code status line: a braille bar, then 42% of 50%, 5h 42%, resets in 3h52m." width="520">

</div>

<br>

You have four Claude Code windows open. One of them is a throwaway experiment and it is quietly
eating the afternoon, but Anthropic reports a single number for all four, so there is no way to know
which. By the time the window is gone, the work that mattered is the work that did not finish.

## Get started

```sh
npx savemytokens
```

That is the whole install. It opens the control centre and, on the first run, offers to add four
hooks and a status line to Claude Code's `settings.json`, backing the file up first. Prefer it
installed once rather than fetched each time? `npm i -g savemytokens`, then the command is just
`savemytokens`.

**Say yes.** The status line is the only place Anthropic publishes your 5h and weekly usage, and it
is what proves a session is still open, so nothing is live without it. If you would rather not see
one, take **Install, no line**: everything is installed and the line renders nothing, so the numbers
still arrive and your terminal looks unchanged. `npx savemytokens uninstall` takes every entry back
out.

<br>

|  |  |
| :-- | :-- |
| **The real numbers** | Your 5-hour and weekly usage exactly as Anthropic publishes it, read from the status line. Never an invented *"% remaining"*. |
| **A split you control** | Give each project a target and a priority. Move one and the others move to fit, so the window always adds up. |
| **The agent working to it** | As a session eats into its slice it is told to narrow scope and finish, and to write down whatever it drops. That comes back the next time you open the project. |
| **Capacity returned** | A project with nothing running lends its share to the rest and reclaims it when you come back. |
| **In your status line** | `⣿⣿⣿⣿⣿⣀⣀⣀⣀⣀⣀⣀ 42% of 50% · 5h 42% · resets in 3h52m`. Pick a shape, arrange the pieces yourself, or run it silent. |

<br>

## A worked example

Four sessions open, and the release matters more than the experiment.

```sh
npx savemytokens share webinvoke 50      # Set webinvoke target to 50%
npx savemytokens priority webinvoke high # webinvoke now takes spare capacity first
```

The other three split what is left. When one of them finishes, whatever it did not spend goes to
webinvoke, because it is the only project on the high tier:

```
  ACTIVE 4
    PROJECT       ALLOCATION USED OF IT           PRIORITY LAST PROMPT
  ❯ webinvoke            50% █████████░░░  62%    HIGH     Implement the provider fallback chain
    buydiff              30% ██████░░░░░░  41%    NORMAL   Fix the verdict table alignment
    obp-ui               20% ██████████░░  93%    LOW      Try the alternate parser
```

`obp-ui` is at 93% of its slice, so its next turn opens with a line telling it to finish what it has
and write down the rest. Whatever it drops comes back the next time you open that project. Nothing
here required you to guess how many tokens anything costs.

## Commands

| | |
| :-- | :-- |
| `npx savemytokens` | the control centre |
| `npx savemytokens status` | one plain-text snapshot · `--json` for a script |
| `npx savemytokens share buydiff 40` | pin a project's allocation |
| `npx savemytokens priority buydiff high` | who gets spare capacity first |
| `npx savemytokens release buydiff` | hand its unused share back |
| `npx savemytokens policy strict` | wind down earlier when it gets tight |
| `npx savemytokens hud` | pick a status line, previewed on your numbers |
| `npx savemytokens theme` | eighteen themes, or write your own |
| `npx savemytokens defer` | work a session pushed to next time |
| `npx savemytokens audit` | what your last 7 days wasted |
| `npx savemytokens privacy` | every file it reads and writes |
| `npx savemytokens uninstall` | remove every trace · `--purge` drops the data too |

`--codex` points any of these at Codex instead, which publishes its own rate limits and needs no
hooks. It is metered and shown, but nothing can be injected into it, so there is no advice.

Inside the control centre, `?` lists every key. The ones worth knowing: **`←→` moves an allocation,
and the others move to fit** so the window always adds up. `space` moves a project up a level and
`x` moves it down, so one you never want to see goes ACTIVE to RECENT to hidden, and `m` shows what
is hidden. `e` puts everything back to an even split, `p` cycles priority, `⏎` opens a project's
sessions, `s` opens settings.

## Where the numbers come from

Three different kinds of number sit on that screen, and it matters which is which.

| | |
| :-- | :-- |
| **5h and 7d** | Anthropic's own figures. Claude Code publishes them to the status line, so SaveMyTokens installs one, reads them, and stores each reading with its timestamp. Nothing is estimated. |
| **share** | Measured from the transcripts already on your disk, token by token, including subagents. Exact, and independent of anything Anthropic reports. |
| **used, allocation** | Anthropic's percentage, split by that measured share. The total is theirs. The division between projects is ours, and it is the only inferred number on the screen. |

Usage from another machine, or from claude.ai, is invisible to a local tool. When the window moves
across five minutes in which nothing local was metered, that is reported on its own line rather than
folded silently into a project's figure.

## How it works

`install` writes three scripts to `~/.savemytokens/hooks`, adds four hook entries and a status line
to Claude Code's `settings.json`, and backs that file up first. There is no daemon. The hooks meter
their own session as it runs, the status line captures the published window every ten seconds, and
the control centre reads what they leave behind. Transcripts are read incrementally, from a stored
byte offset per file, so a prompt costs milliseconds however long the session has run.

Nothing outside `~/.savemytokens` and Claude Code's own settings is touched. `uninstall` puts it
back, and restores a status line of your own if it wrapped one.

## Requirements

Node 18.17 or newer, and Claude Code 2.1 or newer. The published 5h and 7d figures come with a Claude
subscription. On an API key or through the Console, Anthropic reports no window; SaveMyTokens says so
rather than guessing, and allocation and advice still work from measured usage alone.

Developed and tested on macOS. Linux should behave identically. Windows is written for but unproven:
paths and the home directory are resolved portably, and the control centre wants a terminal that
handles the alternate screen buffer, which Windows Terminal does. If it misbehaves there, please
[open an issue](https://github.com/offbeatport/savemytokens/issues/new).

<details>
<summary><b>Writing your own theme</b></summary>

<br>

```sh
npx savemytokens theme new mine nord   # copy one to start from
npx savemytokens theme check mine      # is it readable?
npx savemytokens theme tui mine        # use it
```

`~/.savemytokens/themes/mine.json`. Everything you leave out is inherited:

```json
{
  "colors": { "fg": "#eceff4", "dim": "#7b88a1", "accent": "#88c0d0",
              "ok": "#a3be8c", "warn": "#ebcb8b", "danger": "#e0707c", "track": "#434c5e" },
  "tui":    { "cursor": "❯", "pin": "★", "active": "●", "done": "✓",
              "fill": "▰", "empty": "▱", "over": "▶", "meter": "▰", "track": "▱" },
  "glyphs": { "sep": "·" }
}
```

`theme check` measures every colour against the terminal and fails anything unreadable, against the same
bar the built-in themes have to clear.

</details>

<details>
<summary><b>What the hooks read and write</b></summary>

<br>

| | |
| :-- | :-- |
| **reads** | `~/.claude/projects/**/*.jsonl`, the transcripts Claude Code already writes, from a stored byte offset, and the status line payload Claude Code hands it on stdin. |
| **writes** | `~/.savemytokens` only: meter offsets, per-project settings, quota readings, deferred notes. |
| **injects** | A line of context on `SessionStart` and `UserPromptSubmit` when a project is over its share. Nothing else. |
| **never** | Makes a network call, blocks a prompt, or exits non-zero. |

</details>

## What it will not do

- **It advises; it does not enforce.** The hooks inject text, and a model does not hold a budget the
  way a scheduler holds a lock. A session that ignores the advice keeps running. Hard caps are the
  next step, and will ship only after a period of logging what *would* have been blocked.
- **It does not predict a lockout.** Anthropic publishes a percentage and a reset time. Anything
  beyond those two facts would be a guess dressed up as a number.
- **It cannot see usage it did not measure.** Another machine, claude.ai, or work done before you
  installed it shows up as unattributed window, labelled as such.
- **An idle window still holds its share.** A session with nothing running keeps its slice rather
  than lending it out, so ten open terminals divide the window ten ways. Treating a target as a
  weight among sessions actually consuming is the next fix.
- **It makes no network call.** No account, no telemetry, no daemon. `savemytokens privacy` prints
  every file it reads and writes.

<div align="center">
<br>
<sub>No daemon · no account · nothing leaves your machine · MIT</sub>
<br>
<sub>Built by <a href="https://offbeatport.com">Offbeatport</a> · questions and bugs: <a href="mailto:hello@offbeatport.com">hello@offbeatport.com</a></sub>
</div>
