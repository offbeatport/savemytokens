# SaveMyTokens

A one-time AI cost savings scan. Connect or upload your LLM usage, get a free
**AI Spend Snapshot**, then pay **$99** to unlock the full **AI Cost Health
Report** with exact fixes. One free scan + 5 paid reports ($99 each).

> No prompts or responses required - usage metadata only.

## Quick start

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000. The app runs **fully on mock data** with every
integration (auth social, payments, AI, analytics) disabled by default - no keys
needed to click through the entire funnel.

> First install runs the native `better-sqlite3` build. If your pnpm blocks build
> scripts, run `pnpm rebuild better-sqlite3`.

## Configuration

Copy `.env.example` → `.env` and fill in only what you need. Everything is optional:

| Area | Vars | Behavior when unset |
| --- | --- | --- |
| Database | `SQLITE_PATH` | defaults to `./data/savemytokens.db` (auto-created) |
| Auth | `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID/SECRET` | email+password always on; Google hidden if unset |
| Admin | `ADMIN_EMAILS` | comma-separated; gates `/admin` |
| Payments | `POLAR_ACCESS_TOKEN`, `POLAR_PRODUCT_ID_HEALTH`, `POLAR_WEBHOOK_SECRET` | checkout runs in **mock mode** (unlocks instantly for the demo) |
| AI | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | founder memo uses the deterministic generator |
| Observability | `VITE_POSTHOG_KEY`, `(VITE_)SENTRY_DSN` | no-ops |

## Stack

TanStack Start · React 19 · Vite · TailwindCSS v4 · base-ui-components · drizzle +
better-sqlite3 · better-auth · Polar · OpenRouter · PostHog · Sentry · Recharts ·
TanStack Table · Vitest.

## Architecture

```
src/
  lib/
    analysis/      engine.ts (savings detectors + paywall rule), pricing, mock data, CSV parser
    server/        server functions: scans, payments, notify, memo, session
    db/            drizzle schema + sqlite bootstrap (auto-migrates on boot)
    auth.ts        better-auth (google + email/password)
    reports/       the 5-report catalog
  components/      design system + charts + HealthScore + domain components
  routes/          file-based routes (the 7 screens + api/auth + api/polar)
  styles/global.css design tokens + typography (flat, Space Grotesk)
```

The savings engine is deterministic and unit-tested (`pnpm test`). The free
snapshot is sanitized server-side so the highest-value opportunity is never
exposed before purchase - see `buildSnapshot()` in `engine.ts`.

## Scripts

```bash
pnpm dev          # dev server (port 3000)
pnpm build        # production build
pnpm start        # run the production server
pnpm test         # unit tests (analysis engine)
pnpm typecheck    # tsc --noEmit
pnpm db:studio    # drizzle studio
pnpm auth:secret  # generate a BETTER_AUTH_SECRET
```

## Deploy (Coolify)

Build `pnpm build`, start `pnpm start` (Nitro server on `.output/server/index.mjs`).
Set env vars in Coolify, mount a volume for `./data`, point Polar's webhook at
`/api/polar/webhook`, and set `BETTER_AUTH_URL`/`APP_URL` to your domain.
