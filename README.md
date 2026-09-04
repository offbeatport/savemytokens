# SaveMyTokens

**See where your Claude usage goes, give each session a target share, and keep Claude aware of the
budget you want it to work within.**

```
npx savemytokens install
npx savemytokens
```

No daemon. No account. No setup. Nothing leaves your machine.

If you run three or four Claude Code sessions at once, they compete for one allowance and nothing
tells you which one is eating it. SaveMyTokens reads the numbers Anthropic already publishes, splits
them across your running sessions, and tells each session what share it should work within.

```
  SaveMyTokens · Claude Code

  Claude capacity  published · read just now
    5h    ████░░░░░░  43% used · resets 12:27
    7d    █░░░░░░░░░  12% used · resets Mon

    session      target   used   share  priority last prompt
  ❯ webinvoke       50%    19%     44%  HIGH     Implement provider fallback chain…
    buydiff         30%    14%     32%  NORMAL   Fix verdict table alignment…
  ✓ scratch          9%     9%     21%  LOW      Try alternate parser…

    spare target capacity  11%

    ↑↓ select   ←→ target   p priority   e equalize   d done   b blocked   a active   q quit
```

And in every session's status line:

```
SMT · webinvoke target 50% · used 19% · HIGH · 5h 43% 12:27
```

## Where each number comes from

This is the whole product, so it is worth being exact about it.

| Number | Source | Honesty |
| --- | --- | --- |
| `5h` / `7d` / spend bars | Anthropic, via the status line payload (`rate_limits.five_hour.used_percentage`, `resets_at`) | **published** — the account's real usage against its real window |
| `share` | your transcripts on disk, token by token | **measured** — exact per session, including subagent transcripts |
| `used`, `target` | published percentage × measured share | **inferred split** — the total is Anthropic's, the division between sessions is ours |

There is no estimated ceiling anywhere. SaveMyTokens never shows you a made-up "71% of Claude
remaining".

Two things follow from Anthropic publishing this **only to the status line**:

- If you do not install the status line, there is no published capacity, and the control centre says
  so instead of guessing. Everything else still works on measured shares.
- `rate_limits` is absent for API-key and Console accounts, and before a session's first API
  response.

Usage from another machine, or from claude.ai, is invisible here and lands inside your local
sessions' slices. When the window moves while no local session is running, SaveMyTokens counts that
separately and shows it as its own line.

## Allocation

- Sessions split the window evenly by default.
- `←`/`→` pins a target share; `p` cycles priority; `e` clears every pin back to even.
- Spare capacity goes to the **highest priority tier first**, split evenly inside it. A lower tier
  gets it only once the tier above is finished or capped.
- A session that finishes releases **only what it did not consume**. What it used is really gone, so
  it stays reserved.

```
webinvoke  HIGH    50%  →  finishes having used 32%
buydiff    NORMAL  30%  →  38%   (the 18 points it never used)
scratch    LOW     20%  →  20%   (unchanged; the tier above could still take more)
```

## What Claude is told

`install` adds four hooks. They inject text; they never block a prompt, never edit a file, never make
a network call, and exit 0 on every path.

- **at session start** — the target share, and the request to report `SMT: DONE`, `SMT: NEEDS_MORE`
  or `SMT: BLOCKED` when it stops.
- **50%** of that target spent — stay on completion.
- **80%** — stop optional exploration, finish and test.
- **90%** — verification and finalisation only.

Each stage fires once per window. The advice names what you said should be preserved on first run
(implementation, tests, end-to-end checks, documentation, exploration).

`SMT: DONE` returns the unused share to the pool. So does `SessionEnd`, and so does 45 minutes of
silence — most sessions never report anything, and a dead session must not hold a share forever. You
can override any of it in the TUI with `d`, `b` and `a`.

**It is advice, not enforcement.** A hook injects text; a model does not hold a budget reliably.
`Enforcer.supports` is `["advise"]` for Claude Code and the UI reads that field rather than assuming.
Real caps are V1, behind a shadow-mode period.

## Install

```
npx savemytokens install            hooks + status line
npx savemytokens install --dry-run  print the exact settings.json changes, write nothing
npx savemytokens install --force    keep an existing status line and append the SMT segment
npx savemytokens install --rules    also write the token-discipline block into ~/.claude/CLAUDE.md
npx savemytokens uninstall          remove all of it   (--purge also deletes ~/.savemytokens)
```

It writes `~/.savemytokens/hooks/{kernel,hook,statusline}.mjs`, adds `SessionStart`,
`UserPromptSubmit`, `Stop` and `SessionEnd` entries, sets the status line, and backs up your
settings first. Those three scripts are copies rather than references, so they keep working after the
npx cache is cleared — and they are the same modules the TUI imports, so there is one implementation
of metering, allocation and theming, not two that drift.

If you already have a status line (ccusage, a custom PS1) it is **left alone**. `--force` wraps it:
your command runs first, and the SMT segment is appended to its output.

By default nothing outside `~/.savemytokens` and Claude Code's own `settings.json` is touched.

## Themes

The HUD lives in your terminal all day, so themes are part of V0. They are data, not code, and the
tool still has zero runtime dependencies.

```
npx savemytokens theme              what is set, and what is available
npx savemytokens theme tui nord
npx savemytokens theme hud compact
```

Built in: `default`, `minimal`, `nord`, `dracula`, `matrix`. Your own go in
`~/.savemytokens/themes/<name>.json` and override any subset of colours, glyphs and borders. HUD
layouts: `compact`, `allocation`, `global`. The TUI and the status line are themed independently.

Every non-interactive path stays plain text, so output remains pipeable and greppable:

```
npx savemytokens status         one snapshot, no cursor tricks
npx savemytokens status --json  the whole plan, machine-readable
```

## How consumption is measured

Claude Code's transcripts are read **incrementally**: a stored byte offset per file, five-minute
buckets, subagent transcripts included, and a message id is never counted twice. Hooks meter their
own session, the status line meters at most every ten seconds, and the control centre sweeps every
session touched in the window. Nothing re-parses a transcript it has already read, so a prompt hook
costs milliseconds.

The 5-hour window is anchored to Anthropic's own `resets_at`, not to `now − 5h`, so usage is never
counted across a reset boundary.

Tokens are weighted into input-token equivalents before shares are computed, using the standard
Anthropic price ratios — `input 1× · cache write 1.25× · cache read 0.1× · output 5×` — because raw
token counts would let a cache-heavy session look far more expensive than it is.

## The audit

The original product is still here, one command away:

```
npx savemytokens audit            what the last 7 days wasted, and the one thing to change
npx savemytokens audit -v         every finding, per-file detail, spend by project
npx savemytokens history          efficiency score over time
npx savemytokens watch            observe continuously, report regressions
```

| Detector | What it finds |
| --- | --- |
| `dead-carry` | tasks that began with finished work still in context and never re-opened a file from it |
| `hook-noise` | hooks printing identical plain-text stdout into the transcript on every tool call |
| `repeated-reads` | the same file content re-sent unchanged, in one session or across its subagents |
| `large-output` | tool results over 10 KB that then ride along in context for the rest of the session |
| `roundtrips` | turns that did one cheap thing while re-reading the entire conversation |
| `failed-tools` | commands that failed or were interrupted, and what their error dumps cost |
| `write-churn` | files written end-to-end more than once instead of edited |
| `cold-cache` | sessions abandoned within three turns, after paying a full cache write |

Dead carry has to clear four bars before a dollar is counted: 80k+ tokens resident at the start, 5+
turns, a self-contained prompt (one opening with *"ok"*, *"now do the same"* is never counted), and
no re-opened file from earlier work. Each one is printed with its prompt, project and price so you
can overrule it.

Dollar figures are list-price equivalents from `src/core/pricing.ts`, stamped with its source date.
Override any model in `~/.savemytokens/pricing.json`. On a subscription you do not pay them
directly — they are the size of the thing.

The audit hook that warns you about dead carry at prompt time is part of the same installed hook, so
`install` still gets you both.

## Adapters

| Agent | Source | State |
| --- | --- | --- |
| Claude Code | `~/.claude/projects` incl. nested subagent transcripts | scheduler + audit |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` | audit only |
| Gemini CLI | `~/.gemini` | detected, skipped — logs prompts but no token counts |
| Grok | `~/.grok` | detected, skipped — no token counts on disk |

Set `CLAUDE_CONFIG_DIR` if your Claude Code state does not live in `~/.claude`.

## Privacy

Everything is local, by default and in fact — there is no network call in this tool.

- Reads: your Claude Code transcripts, read-only.
- Writes: `~/.savemytokens/` (claimants, meter buckets, quota readings, hooks, audit cache) and the
  hook and status line entries in Claude Code's `settings.json`.
- Uploads: nothing. Contribution is opt-in, off, and not implemented.

`npx savemytokens privacy` prints exactly what is read, exactly what is stored, and the exact payload
that *would* be sent if you ever opted in — counters only, no prompts, responses, paths, commands,
repo names or code.

## Development

```
pnpm install
pnpm build
pnpm test
node dist/cli.js status
```

Point `SAVEMYTOKENS_HOME` at a scratch directory to keep test runs out of `~/.savemytokens`, and
`CLAUDE_CONFIG_DIR` at a fixture tree to keep them off your real transcripts.

`src/runtime/*.mjs` is the shared runtime: it is copied into `~/.savemytokens/hooks/` at install
time and imported directly by the TypeScript CLI, so the hooks, the status line and the control
centre cannot disagree. Requires Node 18.17+.

MIT.
