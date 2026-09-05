# Changelog

Versions follow [semver](https://semver.org). Before 1.0 the CLI surface and the shape of
`~/.savemytokens/config.json` can still change; the stored records carry their own `schema`
number and are migrated rather than broken.

## 0.2.0

First published release.

### The scheduler

- Give every Claude Code **project** a target share of your 5-hour or weekly window, and a priority
  that decides who receives spare capacity first.
- A project's allocation is divided across its live sessions by what each one burns. Targets live on
  the project, so they survive `/clear`, a resume, or closing the terminal.
- Finishing a project hands back whatever it did not spend, to the highest priority tier first.
- Liveness comes from a status-line heartbeat, so four open windows read as four active projects
  rather than every session you have ever run.

### What Claude is told

- Four policies (`finish`, `strict`, `relaxed`, `off`) compose five actions: focus, narrow, defer,
  verify, handoff. Each fires at a threshold of a project's own target, not of the global window.
- Sessions report `SMT: DONE`, `NEEDS_MORE`, `BLOCKED` or `DEFER <line>`; deferred work comes back at
  the start of the next session in that project.

### The control centre

- Two tables and a parked tier. ACTIVE shares your window; a project joins it the moment you open
  Claude Code there and holds its target after you close it. RECENT is every project Claude Code has
  opened, read from its own directory so the list is populated on a fresh install. `space` moves a
  project up a level and `x` moves it down, so twice down puts one away for good and `m` shows what
  is hidden. A project with nothing running is dimmed rather than badged.
- The allocation column turns amber when you asked for more than the window can give you.
- A per-project drill-down into its sessions.
- Reset every preference back to the defaults from the settings screen; allocations are kept.
- Settings for columns, themes, status-line shape and what to protect when it gets tight.
- Eighteen built-in themes for both the TUI and the status line, every one contrast-tested; write
  your own with `theme new`.
- Nothing overflows between 60 and any wider terminal.

### Honesty about numbers

- 5h and 7d are Anthropic's published figures, read from the status line and stored with a
  timestamp. Nothing is estimated. A window that has just reset draws an empty bar at zero rather
  than vanishing, and an implausible reading is refused instead of stored.
- Per-project share is measured from transcripts on disk, incrementally, including subagents.
- The split of Anthropic's total between projects is the only inferred number, and is labelled as
  such. Window that moved while none of your projects had a turn is reported separately rather than
  folded into a project's figure.

### Install and safety

- `install` backs up `settings.json` first, refuses to touch it if it is not valid JSON, and wraps an
  existing status line rather than replacing it.
- `uninstall` removes only what it added and restores a wrapped status line. Local state survives
  unless you pass `--purge`.
- No network call, no account, no daemon.


