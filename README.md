<div align="center">

<img src="https://raw.githubusercontent.com/offbeatport/savemytokens/main/assets/logo.svg" alt="" width="64" height="64">

# SaveMyTokens

### Decide which projects get your Claude allowance.

<sub>A capacity scheduler for Claude Code · Node 18.17+ · nothing leaves your machine</sub>

<a href="https://www.npmjs.com/package/savemytokens"><img src="https://img.shields.io/npm/v/savemytokens?style=flat-square&color=1a7f37&label=npm" alt="npm version"></a>
<img src="https://img.shields.io/badge/dependencies-0-1a7f37?style=flat-square" alt="zero dependencies">
<img src="https://img.shields.io/badge/node-%E2%89%A5%2018.17-2b7489?style=flat-square" alt="node 18.17+">
<img src="https://img.shields.io/badge/local%20only-no%20network%20call-6e40c9?style=flat-square" alt="local only">
<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-24292f?style=flat-square" alt="MIT"></a>

<br><br>

<img src="https://raw.githubusercontent.com/offbeatport/savemytokens/main/assets/screenshot.svg" alt="The SaveMyTokens control centre: seven projects sharing one 5-hour window, three of them pinned to the top, each row showing its allocation, how much of that allocation it has spent, its priority and its last prompt, above a RECENT table of six more." width="955">

<br>

<img src="https://raw.githubusercontent.com/offbeatport/savemytokens/main/assets/statusline.svg" alt="A Claude Code status line: a braille bar, then 42% of 50%, 5h 42%, resets in 3h52m." width="520">

</div>

<br>

You have four Claude Code windows open. One of them is a throwaway experiment and it is quietly
eating the afternoon, but there is one usage number for all four, so there is no way to know
which. By the time the window is gone, the work that mattered is the work that did not finish.

## Get started

```sh
npx savemytokens
```

That is the whole install. On the first run it offers to add four hooks and a status line to Claude
Code's `settings.json`, backing the file up first.

- **Say yes.** The status line is the only place your 5h and weekly usage is published, and it is
  what proves a session is still open. Nothing is live without it.
- **Don't want to see one?** Take **Install, no line**. Everything is installed and the line renders
  nothing, so the numbers still arrive and your terminal looks unchanged.
- **Rather not fetch it each time?** `npm i -g savemytokens`, then the command is just
  `savemytokens`.
- **Changed your mind?** `npx savemytokens uninstall` takes every entry back out.

<br>

|  |  |
| :-- | :-- |
| **The real numbers** | Your 5-hour and weekly usage exactly as Claude Code publishes it to the status line. Never an invented *"% remaining"*. |
| **A split you control** | Give each project a target and a priority. Move one and the others move to fit, so the window always adds up. |
| **The agent working to it** | As a session eats into its slice it is told to narrow scope and finish, and to write down whatever it drops. That comes back the next time you open the project. |
| **Capacity returned** | A project with nothing running lends its share to the rest and reclaims it when you come back. |
| **In your status line** | `⣿⣿⣿⣿⣿⣀⣀⣀⣀⣀⣀⣀ 42% of 50% · 5h 42% · resets in 3h52m`. Pick a shape, arrange the pieces yourself, or run it silent. |

<br>

## A worked example

Seven projects open, and the release matters more than the experiment.

```sh
npx savemytokens share burningdemand 20      # Set burningdemand target to 20%
npx savemytokens priority burningdemand high # burningdemand now takes spare capacity first
```

The others split what is left. When one of them finishes, whatever it did not spend goes to
burningdemand, because it is the only project on the high tier.

<div align="center">

<img src="https://raw.githubusercontent.com/offbeatport/savemytokens/main/assets/example.svg" alt="Seven projects in the ACTIVE table. Three are pinned, in the order they were pinned: burningdemand at 20% and 71% through it on HIGH, autonomykernel at 18% and 44% through, coldverdict at 12% and 93% through on LOW. Below them the unpinned ones share what is left." width="955">

</div>

`coldverdict` is at 93% of its slice, so its next turn opens with a line telling it to finish what it
has and write down the rest. Whatever it drops comes back the next time you open that project.

The three pinned rows hold the order you pinned them in, whatever happens to the numbers beside
them. Nothing here required you to guess how many tokens anything costs.

## Commands

<div align="center">

<img src="https://raw.githubusercontent.com/offbeatport/savemytokens/main/assets/commands.svg" alt="The command list: npx savemytokens for the control centre, status, share, priority, release, policy, hud, theme, defer, audit, privacy and uninstall." width="955">

</div>

`--codex` points any of these at Codex instead, which publishes its own rate limits and needs no
hooks. It is metered and shown, but nothing can be injected into it, so there is no advice.

In a row, `★` means you pinned it and pinned rows keep the order you pinned them in; a number beside
it is how many Claude Code windows are open in that project, shown only when there is more than one;
a dimmed row is holding its share while nothing runs there.

Inside the control centre, `?` lists every key. The ones worth knowing: **`←→` moves an allocation,
and the others move to fit** so the window always adds up. `space` moves a project up a level and
`x` moves it down, so one you never want to see goes ACTIVE to RECENT to hidden, and `m` shows what
is hidden. `e` puts everything back to an even split, `p` cycles priority, `⏎` opens a project's
sessions, `s` opens settings.

## Where the numbers come from

Three different kinds of number sit on that screen, and it matters which is which.

| | |
| :-- | :-- |
| **5h and 7d** | Published figures, not ours. Claude Code writes them to the status line, so SaveMyTokens installs one, reads them, and stores each reading with its timestamp. Nothing is estimated. |
| **share** | Measured from the transcripts already on your disk, token by token, including subagents. Exact, and independent of anything the provider reports. |
| **used, allocation** | The published percentage, split by that measured share. The total is not ours. The division between projects is ours, and it is the only inferred number on the screen. |

Usage from another machine, or from claude.ai, is invisible to a local tool. When the window moves
across five minutes in which nothing local was metered, it is reported on its own line rather than
folded silently into a project's figure.

## How it works

- **No daemon.** Three scripts in `~/.savemytokens/hooks`, four hook entries and a status line in
  Claude Code's `settings.json`, which is backed up first.
- **The hooks meter their own session** as it runs. The status line captures the published window
  every ten seconds. The control centre reads what they leave behind.
- **Transcripts are read incrementally**, from a stored byte offset per file, so a prompt costs
  milliseconds however long the session has run.
- **Nothing else is touched.** `uninstall` puts it back, and restores a status line of your own if
  it wrapped one.

## Requirements

- **Node 18.17 or newer**, and **Claude Code 2.1 or newer**.
- **A Claude subscription** for the published 5h and 7d figures. On an API key or through the
  Console no window is reported; SaveMyTokens says so rather than guessing, and allocation and
  advice still work from measured usage alone.
- **macOS** is what it is developed and tested on. **Linux** should behave identically. **Windows**
  is written for but unproven: paths and the home directory resolve portably, and the control centre
  wants a terminal that handles the alternate screen buffer, which Windows Terminal does. If it
  misbehaves there, please [open an issue](https://github.com/offbeatport/savemytokens/issues/new).

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
- **It does not predict a lockout.** A percentage and a reset time are published. Anything
  beyond those two facts would be a guess dressed up as a number.
- **It cannot see usage it did not measure.** Another machine, claude.ai, or work done before you
  installed it shows up as unattributed window, labelled as such.
- **The split moves under you.** A window that has taken no turn in ten minutes lends its share to
  the rest, and takes it back the moment you type in it again. What is on screen is the current
  split, not a contract: a project's allocation can change without you touching anything.
- **It makes no network call.** No account, no telemetry, no daemon. `savemytokens privacy` prints
  every file it reads and writes.

<div align="center">
<br>
<sub>No daemon · no account · nothing leaves your machine · MIT</sub>
<br>
<sub>Built by <a href="https://offbeatport.com">Offbeatport</a> · questions and bugs: <a href="mailto:hello@offbeatport.com">hello@offbeatport.com</a></sub>
</div>
