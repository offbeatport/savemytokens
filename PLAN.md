# SaveMyTokens — Plan

## Positioning

**Tell SaveMyTokens what matters. It makes your scarce AI capacity go there.**

Starts as a free local utility for individual developers running several Claude Code sessions at
once. Grows into a scheduler for scarce AI capacity, and then into an economic control plane for
autonomous software.

- Resource scheduler, not project manager.
- No permanent daemon. Hooks, status line, and shared local state do the work.
- Individual developers and HN/GitHub are the distribution wedge, not the final market.

The scheduler is the product. The existing waste-audit engine is demoted to an optional
`savemytokens audit`, kept because its measurements are the scheduler's meter and its findings are
reallocation signals — not because reporting waste is the pitch any more.

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

```ts
type Unit = "observed_usage" | "token" | "usd" | "call" | "second" | "request";

interface Window {
  kind: "rolling" | "calendar" | "per-task" | "unbounded";
  ms?: number;
  resetsAt?: number;
}

interface Capacity {
  amount: number;
  confidence: "published" | "measured" | "estimated" | "unknown";
  learnedFrom?: number;
}

interface Resource {
  id: string;
  adapter: string;
  unit: Unit;
  window: Window;
  capacity: Capacity;
}

interface Claimant {
  id: string;
  resourceId: string;
  label: string;
  share: number;
  priority: "high" | "normal" | "low";
  cap?: number;
  state: "active" | "done" | "needs-more" | "blocked";
}

interface Sample {
  claimantId: string;
  amount: number;
  at: number;
  metrics: { tokens: number; usd: number; requests: number };
}

interface Meter {
  sample(since: number): Promise<Sample[]>;
}

type EnforcementLevel = "advise" | "warn" | "throttle" | "deny" | "halt";

interface Enforcer {
  supports: EnforcementLevel[];
  apply(claimant: Claimant, level: EnforcementLevel, reason: string): Promise<void>;
}
```

A **provider adapter** is a `{ Resource[], Meter, Enforcer }` triple. Claude Code is the first one.
Nothing else in the codebase may import it.

`observed_usage` is the unit for a resource whose real metering unit the provider does not publish.
It is a proxy: the meter still records tokens, dollars and requests underneath, but the plan does
not claim any of them *is* the quota. Claude Code uses it. The day Anthropic publishes the real
unit, the adapter changes and nothing above it does.

### Capacity confidence is a first-class field, not a footnote

Measured on real data (14 lockouts across 200 days of transcripts): Claude Code writes
`quotaLimits` **only on the rejection record**, at the moment you are already blocked. Seven
candidate metrics were tested against those lockouts — raw tokens, input-only, output-only,
cost-weighted, request count — and every one has a coefficient of variation around **40%**. The
5-hour ceiling is therefore not a clean function of anything in the transcripts.

Consequences the product must live with:

- **Token attribution is exact; its relationship to the quota is not.** Per-session and per-task
  tokens come straight from the transcripts. How many of Anthropic's quota units those tokens
  burned is unknown, so the product says *share of observed token usage* and never *share of your
  Claude allowance*.
- **Absolute percentage of Anthropic's limit is `estimated`,** and stays that way until a lockout
  calibrates it. Every lockout is a free data point: consumption in the preceding window was, by
  definition, 100%.
- An estimated capacity is **never rendered as a fact**. Same discipline as the audit product's
  measured-versus-estimated split, which already exists in `src/analyze`.
- Codex publishes `rate_limits.primary.used_percent` for both windows on every turn — capacity
  `published`. The same UI renders both, because confidence is a field rather than an assumption.

---

## V0 — Claude allowance across your active sessions

> **See where your Claude usage goes. Allocate it across sessions. Tell Claude what share it should
> work within.**

Scope is unchanged: make Claude Code's real allowance visible and useful, and split it across the
sessions you are actually running. It is expressed in core terms so that V1 and V2 add adapters
rather than rewrite the product.

### Scope

- One resource: Claude Code allowance, two windows (rolling 5h, calendar week).
- Claimants are active Claude Code sessions, labelled by project.
- Enforcement level: `advise` only.
- Local, OSS, no daemon, no account, nothing uploaded.

### Install

```
npx savemytokens              opens the control centre
npx savemytokens install      hooks + status line
npx savemytokens uninstall    removes hooks, status line, config, and optionally local state
npx savemytokens audit        the waste report, now an optional extra
```

State lives in `~/.savemytokens/`. Hooks and the status line read and update it, so SMT keeps
working when the TUI is closed.

### What it shows

Exact and estimated never share a block. What is measured is stated flat; what is inferred is
fenced off and carries its confidence.

```
SaveMyTokens

Share of observed token usage, this window          measured
  webinvoke      42%   High     "Implement provider fallback..."
  buydiff        31%   Normal   "Fix comparison table..."
  smt            27%   Low      "Try alternate parser..."
  unused pool     0%

Window capacity                                     estimated
  ~340M tokens · confidence low · 3 lockouts seen
  quota consumption does not track tokens cleanly; treat as a rough gauge
```

The shares are exact measurements *of observed token usage*, which is the honest claim: the
transcripts say precisely how many tokens each session spent. They do not say what fraction of
Anthropic's allowance that represents. The capacity block is a learned estimate, fenced off, and
carries its confidence until enough lockouts calibrate it.

### Allocation

- Percentages stay the user-facing unit, because developers think in them. They are a
  **rendering** of `Claimant.share`, not the storage format — a resource metered in dollars or GPU
  seconds renders the same field differently.
- Default: split evenly across active sessions.
- Priority (`high` / `normal` / `low`) decides who receives spare capacity first.
- A share is a **target**, not a guarantee. In `advise` mode SMT can tell a session to aim at 40%;
  it cannot hold it there. The word "guaranteed" belongs to V1, once `deny` ships and is proven.

### Reallocation

- A claimant that finishes returns its unused share to a shared pool.
- The pool goes to active claimants, highest priority first.
- Rebalance on start, stop, and release.
- Lower priority may still receive spare capacity when higher-priority work is already done.

### Release signals

Claude self-reports one of `DONE`, `NEEDS_MORE`, `BLOCKED`, which map onto `Claimant.state`:

| Signal | State | Effect |
| --- | --- | --- |
| `DONE` | `done` | release unused share to the pool |
| `NEEDS_MORE` | `needs-more` | stay active, may draw from the pool |
| `BLOCKED` | `blocked` | stop allocating until the user intervenes |

The signal is Claude-specific; the state is not. A future API adapter derives the same state from
an exit code or a job status. V0 trusts the self-report plus user override and verifies nothing.

### Guidance (enforcement level: advise)

Injected through hooks as a session eats into its target share. The trigger is share consumed, which
is measured, not window remaining, which is not:

- ~50% of its share spent — stay on completion.
- ~80% spent — stop optional exploration, finish and test.
- ~90% spent — verification and finalisation only.
- At the end, report `DONE`, `NEEDS_MORE` or `BLOCKED`.

**This is advice, not enforcement.** A hook injects text; a model does not hold a budget reliably.
V0's copy must not claim otherwise. `Enforcer.supports` is `["advise"]` for the Claude adapter and
the UI reads that field rather than assuming.

### Status line

```
SMT · webinvoke 18/40 share · High · window estimate: low confidence
```

Works whether or not the TUI is running.

### Appearance is part of V0

This thing lives in your terminal all day and its screenshot is the distribution mechanism. Themes
and HUD layouts are function, not decoration, and they ship in V0.

- Themes are **data**, not code: colours, borders, spacing, bar glyphs, density, symbols and Nerd
  Font icons in a JSON file.
- Built-ins: `default`, `minimal`, `nord`, `dracula`, `matrix`.
- User themes load from `~/.savemytokens/themes/`.
- The TUI and the status line theme independently.
- A stable render API, so a community theme is a file someone can put on GitHub.

```bash
npx savemytokens theme
npx savemytokens theme tui nord
npx savemytokens theme hud compact
```

HUD layouts: `compact`, `allocation`, `global`.

First-run preferences, kept to one screen and skippable: which work should capacity be preserved
for — implementation, tests, E2E, documentation, exploration. Saved per project.

Two constraints this must not break: the theme engine stays dependency-free like the rest of the
tool, so `npx savemytokens` is still instant; and every non-interactive path stays plain text, so
output remains pipeable and greppable.

### Out of scope for V0

Project management, milestones, task graphs, TODO ownership, other agents, API-dollar budgets,
cloud accounts, production agents, model routing, enterprise policy, a hosted theme gallery.

---

## V1 — Real enforcement, still local, still Claude

Raise `Enforcer.supports` from `["advise"]` to `["advise", "warn", "throttle", "deny"]` and prove
each level before shipping it.

- Hard and soft caps per claimant.
- Reserved allowance for tests, E2E, and final verification.
- Block low-value tool activity near a hard limit — shipped only after a shadow-mode period that
  logs what *would* have been blocked and shows nothing broke.
- Better attribution between concurrent sessions.
- User-defined borrowing rules for the shared pool.
- Historical allocated-versus-actual per claimant.
- Capacity confidence improves from `estimated` toward `measured` as lockouts calibrate it.

---

## V2 — Cross-platform capacity scheduler

Add adapters, not concepts. The loop is unchanged; each new provider supplies a
`{ Resource[], Meter, Enforcer }`.

| Provider | Resource | Unit | Capacity | Enforcement available |
| --- | --- | --- | --- | --- |
| Claude Code | 5h / weekly allowance | `observed_usage` | estimated → measured | advise, deny |
| Codex | 5h / weekly allowance | `observed_usage` (percent published) | **published** | advise |
| Anthropic / OpenAI API | spend | usd | published | deny, halt |
| Tool and browser calls | calls | call | user-set | throttle, deny |
| GPU / compute | runtime | second | user-set | throttle, halt |

The user sets share, priority, optional urgency, and quality floor. SMT decides where spare
capacity goes, what pauses, what runs where, and what does not fit.

---

## V3 — Production agent economics

Same loop, different claimants: deployed agents, tasks, customers.

- Budgets per agent, task and customer.
- Limits on time, model calls, tool calls, external API spend, compute.
- Kill switches, approval thresholds, team policy, audit history, margin controls.

The promise: autonomous software is given explicit economic authority, optimises to finish useful
work inside it, and has a bounded worst case.

Buyers: AI-native SaaS, agent platforms, teams running production agents.

Monetisation: free local V0; paid team scheduler; production SDK on usage plus subscription;
enterprise policy, audit and approvals.

---

## Architectural choices that would trap the product

Called out against the code as it stands today. Only the marked ones need changing now.

| Choice | Why it traps | Change now? |
| --- | --- | --- |
| Percentage as the stored unit | Does not survive dollars, calls or GPU seconds | **Yes** — store `share` plus `Resource.unit`; render as % |
| 5-hour window hardcoded | Other resources use calendar, per-task or unbounded windows | **Yes** — `Window` type from the start |
| "Session" as the allocation unit | Later units are tasks, customers, deployed agents | **Yes** — allocate to `Claimant`; a Claude session is one kind |
| Consumption by transcript polling | APIs and GPUs push or are queried; no transcript exists | **Yes** — a `Meter` interface; the transcript reader is one implementation |
| Enforcement assumed to be hook text | V1 needs deny, V3 needs halt; Codex supports neither | **Yes** — `Enforcer.supports` levels, declared per adapter |
| Capacity assumed knowable | Claude's ceiling is a ±40% estimate today | **Yes** — `Capacity.confidence`, never rendered as fact |
| Claude's resource typed as `token` | Its quota provably does not track tokens; baking that in makes every later number a lie | **Yes** — `observed_usage` as the unit, tokens as one metric under the meter |
| Share described as guaranteed | `advise` cannot hold a session to a number | **Yes** — target share until `deny` ships in V1 |
| `AdapterId` as a closed union in `src/core/types.ts` | Third-party adapters cannot be added | Later — widen to `string` when the first external adapter appears |
| `SessionEvidence` shaped around Claude transcript artefacts (reads, hooks, attachments) | Meaningless for an API or GPU resource | Later — split observation from metering; V0 only needs the `Meter` slice |
| Pricing keyed by model name | A call-metered or GPU-metered resource has no model | Later — key rates by resource, with model as one dimension |
| Storage keyed by Claude session id and `~/.claude` paths | Collides once a second provider appears | **Yes** — key by `(adapter, claimantId)` |

### What carries over from the audit product

The transcript parser already produces exact per-session and per-task token attribution — of
tokens, which is not the same thing as quota — including
nested subagent transcripts. That is the V0 `Meter`, finished. Pricing, local storage, and the
fenced install/uninstall plumbing carry over as-is.

The audit itself survives as `savemytokens audit`, off the main path. Its detectors become
scheduler *signals*: a session bleeding capacity on dead carry is a reallocation input, and a
claimant asking for more allowance while wasting a third of what it has is a decision the
scheduler can make on evidence.

---

## Long-term thesis

**SaveMyTokens becomes the scheduler for scarce AI capacity.**

The user controls share, priority and quality. SMT handles visibility, allocation, redistribution,
budget-aware guidance, and eventually enforcement.

```
Claude local scheduler → local enforcement → cross-platform capacity scheduler → production economics
```

Each step adds a resource type or an enforcement level. None of them requires rewriting the loop.
