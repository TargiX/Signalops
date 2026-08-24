# SignalOps

**Live demo:** [signalops.cc](https://signalops.cc)  
**Source:** [github.com/TargiX/signalops](https://github.com/TargiX/signalops)

SignalOps is a vendor-neutral operations layer for AI generation products. It now includes a
privacy-safe canonical telemetry contract, tenant-scoped ingestion, durable storage adapters, and
an authenticated live cockpit. The original synthetic control-plane demo remains available as a
separate mode.

## What It Demonstrates

- A custom virtualized data grid built with TanStack Table and TanStack Virtual.
- Server-state style data loading with TanStack Query, including optimistic routing-rule mutations, rollback, and cache invalidation.
- 10,000 synthetic generation jobs with only the visible rows mounted.
- Provider health, routing risk, spend, latency, and failure-rate analysis.
- Saved ops views for overview, provider triage, and cost review.
- A selectable incident investigation flow with affected jobs, job detail selection, and queue focus.
- A routing rule builder with trigger modes, traffic-drain slider, and simulated impact on jobs, p95, failures, and cost.
- A product entry screen at `/` that frames the control-plane workflow before sending users into `/cockpit`.
- A bespoke Soft Light design system backed by source-owned shadcn primitives, Inter, JetBrains Mono, warm surfaces, subtle borders, and muted semantic status colors.

## Stack

- Next.js App Router
- React 19
- TypeScript
- Tailwind CSS
- TanStack Query
- TanStack Table
- TanStack Virtual
- shadcn/ui
- Recharts
- Lucide React

## Run locally

Requires Node.js 24 or newer and pnpm 10.24.0, matching CI and the native TypeScript contract checks.

```bash
pnpm install
dev-safe inspect
dev-safe run --name signalops -- pnpm dev:any --hostname 127.0.0.1
```

Use the exact URL printed by `dev-safe`; it owns per-worktree routing and avoids colliding with
other local apps. Copy `.env.example` into an ignored local environment file and configure the
workspace password, session secret, and ingest token before testing live mode.

## Live product boundaries

- `/cockpit` is the authenticated live tenant view.
- `/onboarding` creates a Supabase-backed account, isolated workspace, and one-time managed ingest
  credential when public signup is enabled.
- `/settings` lets workspace owners create, rotate, and revoke digest-only ingest credentials.
- `/docs`, `/pricing`, `/security`, `/privacy`, `/terms`, `/contact`, and `/status` are public
  product routes with no synthetic customer or certification claims.
- `/cockpit?mode=demo` is the synthetic routing/incident demonstration.
- `POST /v1/events` accepts canonical AI telemetry using a tenant Bearer credential.
- `POST /v1/events/validate` validates the same contract without storing it.
- `GET /v1/ops/snapshot?range=24h|7d|30d|90d` requires a signed operator session.
- `GET /v1/ops/operations/:operationId` returns a tenant-scoped, privacy-safe operation trace.
- `GET /v1/slos` returns versioned tenant reliability objectives and their current evaluations;
  owners can update bounded policy thresholds through the same route.
- `GET /v1/incidents` lists tenant incidents; `GET/PATCH /v1/incidents/:id` exposes evidence,
  append-only lifecycle history, and owner/operator acknowledgement. The authenticated evaluator
  alone maintains evidence-driven open/resolved transitions.
- `/schemas/ai-telemetry/v1` publishes the exact JSON Schema named by canonical events.
- `/schemas/ai-telemetry/v1/ingest-response` publishes the closed success-envelope schema used by
  producers to reconcile stored, duplicate, conflicting, and rejected event IDs.
- `/api/readiness` reports storage, operator-auth, ingest-auth, self-serve, lead-delivery, and
  incident-delivery configuration without secrets.

Phosphene is the first tenant, not a special schema. SignalOps receives opaque operation/attempt
facts and never receives prompts, media URLs, emails, user IDs, access tokens, or raw provider
errors. Phosphene has a revocable service credential; its user session is never shared with
SignalOps.

Local development uses an append-only file under `.data/`. Hosted production fails closed unless
a Supabase backend is configured (or local storage is explicitly opted into). The committed
Supabase migration enables RLS and revokes `anon`/`authenticated` table access; secret/service-role
credentials stay server-only.

Hosted operators sign in through Supabase using an email magic link or an allowlisted OAuth
provider. Authentication alone grants no tenant access: every request revalidates an active
`signalops_v1_operator_memberships` row, and the cockpit can switch only among those memberships.
Production self-serve is explicit: set `SIGNALOPS_PUBLIC_SIGNUP=true` only after Supabase Auth,
server-only storage credentials, the self-serve migration, rate limiting, and the public origin are
configured. Workspace provisioning is idempotent per authenticated subject, creates the first owner
membership and default SLOs atomically, and returns managed ingest secrets exactly once. Private
installations can leave the flag disabled and keep using the admin workflow in
[`docs/runbooks/signalops-operations.md`](docs/runbooks/signalops-operations.md).

Accepted ingest schedules incident evaluation immediately after the durable receipt is returned.
The authenticated daily job at `/api/internal/evaluate` also closes stale incidents and applies the
configured retention policy. Raw events default to 100 days so the 90-day cockpit remains
rebuildable; conflicts and audit rows default to 400 days, and rate-limit buckets to two days.

## Legacy v0 event API boundaries

- `POST /api/events/validate` is public and verification-only. It normalizes and redacts events but stores nothing.
- `POST /api/events` is a protected development/test ingest seam. Set `SIGNALOPS_INGEST_TOKEN` and send that exact value using the Bearer authorization scheme.
- Accepted local events always use the validator's bounded JSON, batch, normalization, and redaction contract. Exact retries return the same receipt reference and do not duplicate retained events.
- The local memory sink retains at most 1,000 events and can evict the oldest retained event. Receipts expose stored, duplicate, evicted, and retained counts so this behavior is not presented as durability.
- Production intentionally returns `503 storage_not_ready` after authentication because this slice does not configure a durable store. The endpoint is not production-ready until a separate durable sink is implemented and explicitly wired.

## Canonical telemetry v1

The production-oriented, vendor-neutral v1 contract is executable through `/v1/events*`. Its JSON Schema, shared fixtures, portable semantic validator, and
implementation SPEC live under [`schemas/ai-telemetry/v1`](schemas/ai-telemetry/v1) and
[`docs/specs`](docs/specs); the standalone runner is
[`scripts/validate-signalops-contract.mjs`](scripts/validate-signalops-contract.mjs). Run
`pnpm contract:validate`, `pnpm test:contract:v1`, `pnpm test:ops:v1`, and
`pnpm test:auth:v1` verify the
artifact, privacy checks, tenant isolation, idempotent duplicates, changed-payload conflicts,
projection semantics, and signed-session boundaries. Existing `/api/events*` routes remain the v0
demonstration for compatibility.

The workspace also contains two client-facing packages:

- [`@signalops/contracts`](packages/contracts) — TypeScript types plus the normative schemas,
  semantic validator, and fixtures.
- [`@signalops/producer-node`](packages/producer-node) — lifecycle recorder, bounded HTTP transport,
  memory transport, privacy normalization, dead-letter seam, and executable conformance runner.

Both packages build and pack into reproducible public tarballs, and pnpm rewrites the producer's
workspace dependency to `@signalops/contracts@^1.0.0`. They are not yet published to npm. Registry
publication remains a separate release action and is blocked on choosing and committing an explicit
open-source license; raw HTTP onboarding works without either package.

## Public-beta growth and analytics

The privacy-safe activation definition is: `signup_completed` → `workspace_created` →
`ingest_key_created` → `first_production_event_accepted` within seven days. The live PostHog project
contains a pinned **Public Beta Activation** dashboard with that server-truth funnel plus acquisition,
activation-volume, and operator-adoption trends. Authenticated behavior uses opaque Supabase subject
identity and a workspace group; email, prompts, media, tokens, raw operation IDs, and free-form text
are excluded. The acquisition and weekly operating cadence is documented in
[`docs/growth/public-beta-go-to-market.md`](docs/growth/public-beta-go-to-market.md).

## Demo script

For a fast portfolio review, the dashboard opens with a **Guided incident replay** rail directly under the header. It turns the surface into a self-explaining demo — a first-run reviewer can follow one incident end to end in well under 90 seconds.

The fastest shareable entry point is [`/cockpit?mode=demo&replay=alibaba-p95&step=0`](https://signalops.cc/cockpit?mode=demo&replay=alibaba-p95&step=0). The home page secondary CTA now opens that guided replay directly instead of sending reviewers to an unframed incident detail first.

1. Pick a scenario — **Alibaba p95 spike**, **FLUX retry storm**, or **Qwen cost bleed**. Each is backed by the existing mock data, not a separate mock.
2. Step through the rail. Every step drives the real controls (no dead overlay):
   - **Signal detected** — selects the incident and scrolls to the investigation workbench.
   - **Affected jobs** — switches the saved view and focuses the virtualized 10k-row queue on the impacted provider.
   - **Draft mitigation** — sets the routing trigger mode and traffic-drain slider.
   - **Projected KPI delta** — simulates the rule, recomputing the KPI cards and every chart from the same derived state.
   - **Export & handoff** — scrolls back to the header so you can export the post-mitigation snapshot as CSV.
3. Use **Back**/**Next step** to move, click any step chip to jump, and **Finish replay** (or **Exit replay**) to restore the clean baseline.

Each step also surfaces a short "technical proof" line calling out what it exercises: TanStack Query hydration, TanStack Table + Virtual filtering, fully controlled rule-builder state, derived-memo chart re-renders, and the snapshot CSV export. Loading and error states are untouched — the rail only orchestrates state the user could set by hand.

## Routes

- `/` opens the product overview and operating model.
- `/cockpit` opens the authenticated live operations dashboard.
- `/cockpit?mode=demo&replay=alibaba-p95&step=0` opens the guided replay from the first step.
- `/incidents/inc_411` opens the synthetic incident investigation route.
- `/incidents/inc_<canonical fingerprint>` opens a tenant-scoped live incident with measured
  evidence, acknowledgement ownership, and recovery history.

## Portfolio Notes

This project is meant to sit next to Phosphene as a different signal:

- Phosphene: solo product ownership, AI workflows, payments, auth, storage, production deployment.
- SignalOps: senior React/data-heavy frontend, custom dashboard UX, headless table primitives, virtualized rendering, and design-system execution.

Good case-study angle:

> Built a custom AI generation operations dashboard with TanStack Table + TanStack Virtual instead of using a prebuilt enterprise grid, keeping the UI bespoke while still handling large datasets, incident triage, and routing-rule workflows.
