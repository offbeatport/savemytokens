<div align="center">

# SaveMyTokens

### Decide which project gets your Claude allowance.

<a href="https://www.npmjs.com/package/savemytokens"><img src="https://img.shields.io/npm/v/savemytokens?style=flat-square&color=1a7f37&label=npm" alt="npm version"></a>
<img src="https://img.shields.io/badge/dependencies-0-1a7f37?style=flat-square" alt="zero dependencies">
<img src="https://img.shields.io/badge/node-%E2%89%A5%2018.17-2b7489?style=flat-square" alt="node 18.17+">
<img src="https://img.shields.io/badge/local%20only-no%20network%20call-6e40c9?style=flat-square" alt="local only">
<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-24292f?style=flat-square" alt="MIT"></a>

<br><br>

<img src="https://raw.githubusercontent.com/offbeatport/savemytokens/main/assets/screenshot.svg" alt="The SaveMyTokens control centre: three live projects sharing one 5-hour window, each row showing its allocation, how much of that allocation it has spent, its priority and its last prompt." width="880">

</div>

<br>

## Get started

```sh
npx savemytokens
```

That is the whole install. It opens the control centre and, on the first run, offers to add four
hooks and a status line to Claude Code's `settings.json`, backing the file up first.

**Say yes.** The status line is the only place Anthropic publishes your 5h and weekly usage, and it
is what proves a session is still open, so nothing is live without it. Changed your mind?
`npx savemytokens uninstall` takes every entry back out.

<br>

|  |  |
| :-- | :-- |
| **The real numbers** | Your 5-hour and weekly usage exactly as Anthropic publishes it. Never an invented *"% remaining"*. |
| **Two lists you control** | **ACTIVE** is what shares your window; **RECENT** is everything else it has seen. A project joins ACTIVE on its own when you open Claude Code there and stays after you close it, so a target survives the session. `a` moves one up, `x` sends it back. |
| **Claude working to it** | As a session eats into its slice it is told to narrow scope and finish, and to write down whatever it drops. That comes back the next time you work on the project. |
| **Unused capacity returned** | A project with nothing running lends its share to the rest and takes it back when you return. Mark one done and what it did not spend goes to the others immediately. |
| **In your status line** | `21%/50% · 5h 42% · in 3h52`. How much of your share you have spent, where the window is, when it comes back. Pick a shape, or arrange the pieces yourself. |

<br>

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
| `npx savemytokens uninstall` | remove every trace · `--purge` drops the data too |

Inside the control centre, `?` lists every key. The ones worth knowing: `←→` moves an allocation,
`p` cycles priority, `a` promotes a project and `x` drops it, `⏎` opens a project's sessions,
`P` opens settings.

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

<div align="center">
<br>
<sub>No daemon · no account · nothing leaves your machine · MIT</sub>
<br>
<sub>Questions, bugs and ideas: <a href="mailto:hello@offbeatport.com">hello@offbeatport.com</a></sub>
</div>
