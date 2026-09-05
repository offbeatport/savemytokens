# SaveMyTokens: the plan

## Positioning

**Tell SaveMyTokens what matters. It makes your scarce AI capacity go there.**

A free local utility for developers running several Claude Code sessions at once. It grows into a
scheduler for scarce AI capacity, and then into an economic control plane for autonomous software.

- Resource scheduler, not project manager.
- No permanent daemon. Hooks, the status line, and shared local state do the work.
- Individual developers and HN/GitHub are the distribution wedge, not the final market.

The scheduler is the product. The waste-audit engine is now `savemytokens audit`, kept because its
measurements are the scheduler's meter and its findings are reallocation signals, not because
reporting waste is the pitch.

---

## Core abstraction

Everything in every version is one loop:

```
resource → allocation → consumption → reallocation → enforcement
```

The core owns that loop. Nothing in it may name Claude.

| Stage | Core question | Owns |
| --- | --- | --- |
| **Resource** | what is scarce, in what unit, over what window, how much is there | `Resource` |
| **Allocation** | who is entitled to what share of it, and who gets spare first | `Claimant`, `Allocation` |
| **Consumption** | how much has each claimant actually used | `Meter` |
| **Reallocation** | what happens when a claimant finishes, stalls, or overruns | `Scheduler` |
| **Enforcement** | what can actually be done about it, and how hard | `Enforcer` |

The types live in `src/core/resource.ts`. A **provider adapter** is a `{ Resource[], Meter, Enforcer }`
triple; Claude Code is the first one, in `src/adapters/claude-code/provider.ts`. Nothing else in the
codebase may import it.

`observed_usage` is the unit for a resource whose real metering unit the provider does not publish.
The meter records tokens and requests underneath, but the plan never claims any of them *is* the
quota.

### Capacity is published, not guessed

Claude Code hands the status line command a JSON payload that contains, for subscription accounts:

```json
"rate_limits": {
  "five_hour": { "used_percentage": 42.5, "resets_at": 1788000000 },
  "seven_day": { "used_percentage": 12.0, "resets_at": 1788400000 },
  "spend_limit": { "used_percentage": 8.0, "resets_at": 1788400000 }
}
```

Verified against Claude Code 2.1.260. That is the account's real usage against its real window, with
the real reset time, so `Capacity.confidence` is **`published`** and SMT never estimates a ceiling.
An earlier version of this plan proposed learning capacity from lockouts; that is deleted.

Three consequences the product lives with:

- **The numbers exist only in the status line payload.** They are in no transcript on disk (checked
  across 595 recent ones). SMT's status line command captures each reading into
  `~/.savemytokens/quota/` with its timestamp; everything else reads that file. No status line
  installed means no published capacity, and the UI says so rather than inventing one.
- **A reading ages, and a window ends.** Every reading carries `at` and `resets_at`. Past its reset a
  reading is void, not stale-but-usable, and the UI drops it.
- **Attribution between sessions is the inferred part.** The window percentage is account-wide.
  Per-session tokens are exact, from the transcripts, so each session's slice is
  `published_percent × its share of measured tokens`. Usage from another machine or from claude.ai is
  folded into the local sessions' slices; when the window moves while no local session is running,
  SMT counts that separately and shows it.

Windows come from Anthropic too: the 5h window is `resets_at − 5h`, not `now − 5h`, so usage is never
attributed across a reset boundary.

---

## V0, shipped: Claude allowance across your active sessions

> **See where your Claude usage goes, give each project a target share, and keep Claude aware of the
> budget you want it to work within.**

Local, OSS, no daemon, no account, nothing uploaded. Enforcement level: `advise` only.

**Status: complete and tagged `v0.2.0`, unpublished.** 127 tests, green on Node 18.20.8 and 24. The
package installs and runs from a packed tarball. `npm publish` is the only step left. Eighteen
themes for both surfaces, all contrast-tested; the control centre fits any terminal from 60 columns
up; a fuzz over eight thousand random plans finds no allocation above one hundred percent.

### Install

```
npx savemytokens              the control centre
npx savemytokens install      hooks + status line
npx savemytokens uninstall    removes them (--purge also deletes local state)
npx savemytokens status       one plain-text snapshot
npx savemytokens policy       what Claude does as the window fills
npx savemytokens defer        work pushed to the next session
npx savemytokens share|priority|release <project> …
npx savemytokens theme        themes and HUD layouts
npx savemytokens audit        the waste report, now an optional extra
```

`install` writes `~/.savemytokens/hooks/{kernel,hook,statusline}.mjs`, registers `SessionStart`,
`UserPromptSubmit`, `Stop` and `SessionEnd`, and sets the status line. A status line already
configured is left alone; `--force` wraps it, running the existing command first and appending the
SMT segment. The token-discipline block in `~/.claude/CLAUDE.md` is opt-in behind `--rules`, and by
default nothing outside `~/.savemytokens` and Claude Code's own `settings.json` is touched.

The three scripts are copies, not references, so they keep working after the npx cache is cleared.
They are the same modules the TUI imports, so metering, allocation and theming have one
implementation.

### What it shows

```
  5h ████░░░░░░░░  42% resets in 1h57 (21:55)    7d ██░░░░░░░░░░  18% resets in 2d3h (Sun)

  ACTIVE 4
     PROJECT      ALLOCATION USED OF IT              PRIORITY LAST PROMPT
  ❯★2 webinvoke           50% █████████░░░░░░  62%    HIGH     Implement the provider fallback chain
     buydiff             30% ██████░░░░░░░░░  41%    NORMAL   Fix the verdict table alignment
     obp-ui              20% ██████████████░  93%    LOW      Try the alternate parser
     reposhine           15% ░░░░░░░░░░░░░░░   0%    NORMAL   Draft the plan for the ingest rewrite

  RECENT 12
     PROJECT             LAST TURN        LAST PROMPT
     picsuper               9h ago        Compare the two upscalers on the same source
  +7 more

  3 of 4 open, across 4 sessions, 1 waiting.
```

Three tiers, walked by one pair of keys. **ACTIVE** shares the window. **RECENT** is every project
Claude Code has opened, seeded from `~/.claude/projects` rather than only from what SMT has metered,
so the list is populated on a fresh install. **Parked** is out of sight until `m`. `space` moves a
project up a level, `x` moves it down. A row with nothing running is dimmed rather than badged, and
holds its target until you return to it.

`ALLOCATION` is what the project is granted, and turns amber when you asked for more than the window
can give. `USED OF IT` is the published percentage times the project's measured share, so the total
is Anthropic's and the split between rows is ours.

### Allocation

Allocation is per **project**, not per session. A session id changes every time you `/clear` or
resume, so a target pinned to one evaporates the moment you restart; a project is the thing you
actually have an opinion about. A project's allocation is split across its live sessions in
proportion to what they are burning, and sessions are the drill-down behind ⏎.

- Default: even split across running projects.
- `←`/`→` pins an allocation; `p` cycles priority; `e` clears every pin back to an even split.
- Spare capacity goes to the highest-priority tier first, split evenly inside it, and only reaches a
  lower tier once the tier above is done or hits its cap.
- A session that finishes releases **only the share it did not consume**. What it used stays
  reserved, because it is really gone.
- `blocked` receives nothing further until you intervene.

### Consumption

The meter reads Claude Code's transcripts incrementally: a stored byte offset per file, five-minute
buckets, subagent transcripts included, duplicate message ids counted once. Hooks meter their own
session; the status line meters at most every ten seconds; the control centre sweeps every session
touched in the window. Nothing re-parses a transcript it has already read.

### Guidance (enforcement level: advise)

Injected as hook output as a session eats into its target share. What it asks for is a **policy**,
not a fixed script, because "tight" means different things on different work:

| policy | stages, by fraction of the target share spent |
| --- | --- |
| `finish` (default) | 50% focus · 80% narrow+defer · 90% verify+defer+handoff |
| `strict` | 35% · 60% · 80% |
| `relaxed` | 80% focus · 95% verify+handoff |
| `off` | nothing is ever injected |

The moves compose: `focus` (completion only, batch tool calls), `narrow` (smallest genuinely-done
version, start nothing new), `defer` (write the dropped work down), `verify` (finish, test, clean
tree), `handoff` (where it stopped, then the release signal). Set globally or per project with
`savemytokens policy`.

**Deferred work closes the loop.** `SMT: DEFER <one line>` is captured per project and injected at
the start of the next session there, so narrowing scope costs nothing. The rest is written down,
not lost. `savemytokens defer` lists it; `defer clear` drops it.

Pressure is `used ÷ target` against the published window. With no published window it degrades to
`share ÷ target`, which only means anything with two or more sessions running, so with one session
and no reading SMT says nothing at all. Each stage fires once per window. The advice names what you
want preserved (implementation and tests by default, changed with `P` in the control centre or
`savemytokens policy preserve`) and can carry a line of your own, injected verbatim with it.
There is no first-run questionnaire: the control centre opens on working defaults.

**This is advice, not enforcement.** A hook injects text; a model does not hold a budget reliably.
`Enforcer.supports` is `["advise"]` for the Claude adapter and the UI reads that field.

### Release signals

| Signal | State | Effect |
| --- | --- | --- |
| `SMT: DONE` | `done` | release the unused share to the pool |
| `SMT: NEEDS_MORE` | `needs-more` | stay active, may draw from the pool |
| `SMT: BLOCKED` | `blocked` | stop allocating until you intervene |

The `Stop` hook reads the signal out of the transcript. `SessionEnd` releases too, and a session with
no activity for 45 minutes is treated as done, because most sessions never report anything. Any of it
can be overridden in the TUI with `d`, `b` and `a`.

### Driving it without the TUI

`share`, `priority` and `release` take a project name or a session id, so the whole allocation is
scriptable; `status --json` emits the plan, `--7d` allocates against the weekly window, and an
unknown session name exits non-zero.

### Status line

```
SMT · webinvoke target 50% · used 19% · HIGH · 5h 43% 12:27
```

Layouts `compact`, `allocation` and `global`; themes `default`, `minimal`, `nord`, `dracula`,
`matrix`, plus anything in `~/.savemytokens/themes/*.json`. The TUI and the status line are themed
independently. Themes are data, not code, and the whole tool still has zero runtime dependencies.

### More than one agent

The scheduler knows nothing about Claude. A `Provider` supplies four things and the rest of the
product is written against the interface: `resources(now)` for the published windows, a `Meter` for
consumption, an `Enforcer` declaring what it can actually do, and `dataDir` for where the transcripts
live. Storage is keyed by `(adapter, claimantId)`, so two agents on one machine never collide, and
`Capacity.confidence` records whether a window was published or is unknown.

| adapter | published window | metering | enforcement | state |
| --- | --- | --- | --- | --- |
| Claude Code | 5h and 7d, from the status line | transcripts | `advise`, via four hooks | **shipped** |
| Codex | `rate_limits` in its own rollout files, no hook needed | transcripts | none: nowhere to inject | **metered, visibility only** |
| Gemini CLI | none published yet | not written | unknown | not started |
| Grok CLI | none published yet | not written | unknown | not started |

`savemytokens --codex` renders the same view against Codex, from the same incremental reader. Its
`Enforcer.supports` is empty and the interface says so rather than pretending. That is the bar for
any new adapter: a **published** window to read, or it does not ship, because the alternative is
inventing a number and the whole product is a bet against doing that.

**What is still Claude-shaped and would need work for a third adapter.** Thirteen setters in
`plan.ts` default their adapter argument to `claude-code`; callers all pass the real one, but the
default is a trap for the next integration. `audit` only walks the Claude adapter. The three runtime
scripts are Claude hooks by definition and would be joined by, not replaced with, another agent's
equivalents.

### What V0 cannot see

- No status line, no published capacity, and everything else still works, on measured shares alone.
- `rate_limits` is absent for API-key and Console users, and before the first API response of a
  session.
- Usage from another machine, or from claude.ai, lands in the local sessions' slices. SMT reports the
  part of the window that moved while nothing local was metered for five minutes or more, which is
  the visible half of it.
- Advice only. Nothing stops a session from blowing through its target.
- An open session that is not typing still reserves its share. Ten windows open with one in use
  divides the window ten ways and tells the one doing the work it is far over budget. The fix is to
  treat a target as a weight among sessions actually consuming, rather than a reservation held by
  anyone with a window open.

### Deliberately out of scope for V0

Project management, milestones, task graphs, other agents, API-dollar budgets, cloud accounts,
production agents, model routing, enterprise policy, a hosted theme gallery.

---

## V1: real enforcement, still local, still Claude

Raise `Enforcer.supports` from `["advise"]` to `["advise", "warn", "throttle", "deny"]` and prove each
level before shipping it.

- Hard and soft caps per claimant.
- Reserved allowance for tests, end-to-end runs and final verification.
- Block low-value tool activity near a hard limit, shipped only after a shadow-mode period that logs
  what *would* have been blocked and shows nothing broke.
- Better attribution between concurrent sessions, using the published window's movement as the
  calibration signal.
- User-defined borrowing rules for the shared pool.
- Historical allocated-versus-actual per claimant.

## V2: cross-platform capacity scheduler

Add adapters, not concepts. Each new provider supplies a `{ Resource[], Meter, Enforcer }`.

| Provider | Resource | Unit | Capacity | Enforcement available |
| --- | --- | --- | --- | --- |
| Claude Code | 5h / 7d allowance | `observed_usage` | **published** | advise, deny |
| Claude gateway | spend limit | `usd` | **published** | advise, deny |
| Codex | 5h / weekly allowance | `observed_usage` | **published, shipped in V0** | none, no hook to inject through |
| Anthropic / OpenAI API | spend | usd | published | deny, halt |
| Tool and browser calls | calls | call | user-set | throttle, deny |
| GPU / compute | runtime | second | user-set | throttle, halt |

## V3: production agent economics

Same loop, different claimants: deployed agents, tasks, customers. Budgets per agent, task and
customer; limits on time, model calls, tool calls, external API spend and compute; kill switches,
approval thresholds, team policy, audit history, margin controls.

Buyers: AI-native SaaS, agent platforms, teams running production agents. Monetisation: free local
V0; paid team scheduler; production SDK on usage plus subscription; enterprise policy, audit and
approvals.

---

## Architectural choices that would have trapped the product

| Choice | Why it traps | State |
| --- | --- | --- |
| Percentage as the stored unit | Does not survive dollars, calls or GPU seconds | **Fixed**: `share` is stored with `Resource.unit`, rendered as % |
| 5-hour window hardcoded | Other resources use calendar, per-task or unbounded windows | **Fixed**: `Window` type, and the bounds come from `resets_at` |
| "Session" as the allocation unit | Later units are tasks, customers, deployed agents | **Fixed**: allocation is to a `Claimant`; a Claude session is one kind |
| Consumption by transcript polling | APIs and GPUs push or are queried; no transcript exists | **Fixed**: `Meter` interface; the transcript reader is one implementation |
| Enforcement assumed to be hook text | V1 needs deny, V3 needs halt; Codex supports neither | **Fixed**: `Enforcer.supports`, declared per adapter |
| Capacity assumed knowable | It was, all along, and published | **Fixed**: `Capacity.confidence`, `published` for Claude |
| Claude's resource typed as `token` | Its quota is published as a percentage, not tokens | **Fixed**: `observed_usage`, tokens as one metric under the meter |
| Share described as guaranteed | `advise` cannot hold a session to a number | **Fixed**: target share everywhere until `deny` ships |
| Storage keyed by Claude session id and `~/.claude` paths | Collides once a second provider appears | **Fixed**: keyed by `(adapter, claimantId)` |
| One shared state file | Concurrent sessions fire hooks at the same instant and lose writes | **Fixed**: one file per claimant, allocation derived, never stored |
| `AdapterId` as a closed union in `src/core/types.ts` | Third-party adapters cannot be added | Later: widen to `string` when the first external adapter appears |
| `SessionEvidence` shaped around Claude transcript artefacts | Meaningless for an API or GPU resource | Later: the audit still uses it; the scheduler does not |
| Pricing keyed by model name | A call-metered or GPU-metered resource has no model | Later: key rates by resource, with model as one dimension |

---

## Long-term thesis

**SaveMyTokens becomes the scheduler for scarce AI capacity.**

The user controls share, priority and quality. SMT handles visibility, allocation, redistribution,
budget-aware guidance, and eventually enforcement.

```
Claude local scheduler → local enforcement → cross-platform capacity scheduler → production economics
```

Each step adds a resource type or an enforcement level. None of them requires rewriting the loop.
