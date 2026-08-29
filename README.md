# SaveMyTokens

**Get more done.**

```
npx savemytokens
```

No daemon. No account. No setup. Nothing leaves your machine.

SaveMyTokens reads the session logs Claude Code already writes on your disk, finds the token spend
that bought you nothing, and tells you what to change. Then it remembers, so the next run shows
whether the change actually worked.

```
SaveMyTokens

You could get ~24% more work from the same tokens.
7 days · 31 sessions · 187 tasks · 60M new tokens · 2.2B re-read

1. Repeated context reads
   Measured: 44 identical re-reads of 12 files (880 KB re-sent unchanged)
   Measured: worst: scratchpad/MIGRATION-BRIEF.md — 44× after the first read
   Estimated waste: ~6% of token spend
   Fix: Read scratchpad/MIGRATION-BRIEF.md once, then work from it. When you only
   need part of a file, ask for a line range instead of the whole file, and put
   facts you keep re-reading in CLAUDE.md so they ride along once per session.

2. Hook output injected into context
   Measured: 1,203 hook events printed 340 KB into context
   Measured: worst: PostToolUse:Bash — the same output repeated 706×
   Estimated waste: ~2.5% of token spend
   Fix: The PostToolUse:Bash hook re-prints identical output on nearly every tool
   call. Send its stdout to /dev/null in ~/.claude/settings.json.

Efficiency: 75/100
Previous: 68/100 ↑
```

## This is not a usage dashboard

`ccusage` tells you what you consumed. SaveMyTokens tells you what was **wasteful**, what to
**change**, and whether the change **worked**.

## Usage

```
npx savemytokens              audit the last 7 days
npx savemytokens watch        observe continuously, report regressions
npx savemytokens history      score over time
npx savemytokens privacy      what is read, stored, and never sent
```

| Option | Meaning |
| --- | --- |
| `-d, --days <n>` | window to analyse (default 7) |
| `--here` | only the project in the current directory |
| `--project <path>` | only that project directory |
| `--json` | machine-readable output |
| `-v, --verbose` | per-file detail, score breakdown, model split |
| `--interval <s>` | `watch` poll seconds (default 60) |
| `--no-save` | do not write to `~/.savemytokens` |

Requires Node 18.17+. First run over a month of history takes a few seconds; every run after that
is instant, because per-session measurements are cached.

## Passive by design

`watch` is safe to leave running. It observes, records baselines, and reports regressions. It never
blocks, rewrites, redirects or modifies Claude's behaviour, never touches a project or config file,
and never uploads anything. Observe first, prove value, then decide whether you want fixes applied.

`npx savemytokens fix` is deliberately **not** in v1.

## What it measures

Every measurement comes from your own transcripts under `~/.claude/projects` — including the
nested subagent transcripts most tools miss.

| Detector | What it finds |
| --- | --- |
| `repeated-reads` | the same file content re-sent unchanged, in one session or across its subagents |
| `large-output` | tool results over 10 KB that then ride along in context for the rest of the session |
| `hook-noise` | hooks printing identical stdout into the transcript on every tool call |
| `context-bloat` | turns running above 120k context, and the tokens re-read past that line |
| `failed-tools` | commands that failed or were interrupted, and what their error dumps cost |
| `write-churn` | files written end-to-end more than once instead of edited |
| `cold-cache` | sessions abandoned within three turns, after paying a full cache write |
| `model-routing` | premium-model turns that were a single mechanical tool call |

### How cost is compared

Tokens are not equal, so raw counts mislead. Everything is scored in **input-token equivalents**
using the standard Anthropic price ratios:

```
input 1×    cache write 1.25×    cache read 0.1×    output 5×
```

Content that enters context is charged for its whole life, not just the turn it arrived in: it is
written to cache once (1.25×) and re-read on every later turn of that session (0.1× each), up to
the next compaction boundary. A 40 KB log dumped at turn 5 of a 200-turn session is not a 10k-token
mistake — it is a 10k × (1.25 + 0.1 × 195) mistake. That is why the fixes are worth applying.

### Measured vs estimated

The report always separates the two, and so should you:

- **Measured** — counted directly from the logs: token counts, turn counts, duplicate reads, bytes
  of output, failures. These are facts.
- **Estimated** (`~`) — anything inferred: bytes converted to tokens at ~4 chars per token, and how
  much of a pattern was realistically avoidable. Context bloat is discounted to 40% recoverable,
  model routing to 40%. Findings overlap, so the headline combines them as
  `largest + 50% of the rest`, capped at 45%.

Estimates are never presented as facts.

### What it cannot see

Claude Code makes a little traffic that is never written to a transcript — session titles, quota
checks, and some background agent work. Those tokens are billed to you but invisible here, so
totals can run slightly under Claude Code's own cost view.

## Privacy

Everything is local, by default and in fact — there is no network call in this tool.

- Reads: `~/.claude/projects`, read-only.
- Writes: `~/.savemytokens/` only. No project file is ever touched.
- Uploads: nothing. Contribution is opt-in, off, and not implemented in v1.

`npx savemytokens privacy` prints exactly what it reads, exactly what it stores, and the exact JSON
payload that *would* be sent if you ever opted in — counters only, no prompts, responses, paths,
commands, repo names or code.

## Open source strategy

Open, so you can verify what runs on your machine: the CLI, the adapters, the parsers, the privacy
and sanitisation layer, local storage, and the waste-detection rules. All of it is this repository.

Kept private: the anonymous crowd benchmark dataset, task/outcome normalisation, cross-user
efficiency benchmarks, recommendation ranking, and learned optimisation recipes. Parsing Claude
logs is not a moat; millions of tasks mapped to outcomes and proven recommendations is.

## Roadmap

v1 exists to find out whether strangers care. Next, in order, only if they do:

1. `savemytokens fix` — apply safe, reversible optimisations and measure whether they reduce token
   use without making outcomes worse.
2. Codex and Gemini adapters (the adapter interface is already in place).
3. Anonymous crowd benchmarks: *"this kind of task costs you 1.8× the median."*

Long-term goal: find the cheapest proven way to get AI work done.

## Development

```
pnpm install
pnpm build
pnpm test
node dist/cli.js --days 7 --verbose
```

Point `SAVEMYTOKENS_HOME` at a scratch directory to keep test runs out of `~/.savemytokens`.

MIT.
