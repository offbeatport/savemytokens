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

You ran 414 tasks worth $1,506 and hit your usage limit 14 times.
About $386 of that bought you nothing.
7 days · 36 sessions · 75M new tokens · 3.3B re-read

Most expensive tasks
   $61  ▇▇▇▇▇▇▇▇  picsuper   Build a new app, using 1. This stack: TanS…  273t
   $49  ▇▇▇▇▇▇    webinvoke  I want you to implement BuyDiff.com with t…  286t
   $39  ▇▇▇▇▇     cslopslop  ok, I want you to extract the ui library i…  271t

1. Finished work still riding along in context         $181 · habit · measured
   · 76 tasks started with more than 80k tokens of earlier work already in
     context
   · none of them re-opened a single file from that earlier work, and their
     prompts named their own subject
   · that context was re-read on every turn: 530M tokens

     $40  cslopslop    carried 985k × 81t  "Update Chat agent window scroolba…
     $16  cslopslop    carried 916k × 34t  "When I first load the app and pre…

   Do this: Press Ctrl+C and start a new session (or /clear) when the next
   thing you type is not about the last thing you did.

Start here: hook output injected into context — $34, one config change, then
never think about it again.

Efficiency: 75/100  ▂▄▅▇  +4 since 2026-08-29 09:57
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

Every measurement comes from transcripts already on your disk.

| Agent | Source | State |
| --- | --- | --- |
| Claude Code | `~/.claude/projects` incl. nested `subagents/` transcripts most tools miss | supported |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` | supported |
| Gemini CLI | `~/.gemini` | detected, skipped — logs prompts but no token counts |
| Grok | `~/.grok` | detected, skipped — local store is a title/cwd search index, no token counts |

An agent that does not write token counts to disk cannot be audited, and the tool says so rather
than inventing numbers.

The unit is the **task** — one thing you asked for, and every turn it took to finish. Findings are
attached to tasks you can recognise, priced in dollars, and tagged `one-time fix` or `habit`.

| Detector | What it finds |
| --- | --- |
| `dead-carry` | tasks that began with finished work still in context and never re-opened a file from it |
| `hook-noise` | hooks printing identical stdout into the transcript on every tool call |
| `repeated-reads` | the same file content re-sent unchanged, in one session or across its subagents |
| `large-output` | tool results over 10 KB that then ride along in context for the rest of the session |
| `roundtrips` | turns that did one cheap thing while re-reading the entire conversation |
| `failed-tools` | commands that failed or were interrupted, and what their error dumps cost |
| `write-churn` | files written end-to-end more than once instead of edited |
| `cold-cache` | sessions abandoned within three turns, after paying a full cache write |

### How dead carry is proven, not guessed

"You did not need that context" is the easiest claim to get wrong, so it has to clear four bars
before a single dollar is counted:

1. the task started with **80k+ tokens** already resident,
2. it ran **5+ turns**, so the carry actually cost something,
3. its prompt was **self-contained** — a prompt opening with *"ok"*, *"now do the same"*, *"the
   other ones"* refers to earlier context and is never counted,
4. it **never re-opened a single file** touched by any earlier task in that session.

Only tasks that clear all four are counted, and each one is printed with its prompt, its project
and its price so you can check it yourself.

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
- **Estimated** — anything inferred: bytes converted to tokens at ~4 chars per token, and how much
  of a pattern was realistically avoidable (round trips are discounted to 40% recoverable). Findings
  overlap, so the headline combines them as `largest + 50% of the rest`, capped at 45%, and the
  list is ranked by dollars weighted by certainty — a measured finding outranks a larger estimate.

Dollar figures are list-price equivalents for the tokens you actually used, from a table in
`src/core/pricing.ts` stamped with its source date (Anthropic 2026-06-24, OpenAI 2026-08-31).
Prices drift; override any model with `~/.savemytokens/pricing.json`:

```json
{ "claude-opus-5": { "input": 5, "output": 25, "cacheRead": 0.5, "cacheWrite": 6.25 } }
``` On a subscription you do not pay them directly — they are
the size of the thing, and the usage-limit count is what it costs you in practice.

Estimates are never presented as facts.

### What it cannot see

Claude Code makes a little traffic that is never written to a transcript — session titles, quota
checks, and some background agent work. Those tokens are billed to you but invisible here, so
totals can run slightly under Claude Code's own cost view.

It also cannot read your mind. It knows a task never re-opened an earlier file; it cannot know you
were holding a decision from that conversation in your head. That is why the receipts are printed:
the tool makes the claim, you get to overrule it.

## Privacy

Everything is local, by default and in fact — there is no network call in this tool.

- Reads: `~/.claude/projects`, read-only.
- Writes: `~/.savemytokens/` only. No project file is ever touched.
- Uploads: nothing. Contribution is opt-in, off, and not implemented in v1.

`npx savemytokens privacy` prints exactly what it reads, exactly what it stores, and the exact JSON
payload that *would* be sent if you ever opted in — counters only, no prompts, responses, paths,
commands, repo names or code.

The local cache under `~/.savemytokens/` does keep the first 120 characters of your prompts, because
that is what makes a finding recognisable. It never leaves the machine, and `privacy` shows you the
upload payload that excludes it.

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
