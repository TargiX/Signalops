# SignalOps

SignalOps is a React dashboard for operating AI image-generation products. It is intentionally built as a custom interface rather than a dropped-in enterprise grid, so the implementation shows state management, data density, virtualization, and design-system work.

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

## Run Locally

```bash
pnpm install
pnpm dev
```

The dev server is pinned to [http://localhost:3020](http://localhost:3020) to avoid colliding with other local portfolio/product apps.

## Demo script

For a fast portfolio review, the dashboard opens with a **Guided incident replay** rail directly under the header. It turns the surface into a self-explaining demo — a first-run reviewer can follow one incident end to end in well under 90 seconds.

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
- `/cockpit` opens the live operations dashboard.
- `/login` opens the operator sign-in flow when cockpit auth is enabled.
- `/docs` shows the source-app event API quickstart.
- `/api/status` returns the honest hosted-demo vs pilot-setup boundary.
- `/api/health` returns operator-facing storage, validation, and ingest readiness.
- `/api/events/validate` validates source events without auth, persistence, or side effects.
- `/api/events` accepts generation lifecycle, provider health, and cost events.
- `/pilot` opens a public pilot request page.
- `/pilot-requests` opens the protected operator queue for captured pilot requests.
- `/status` opens the public human-readable product readiness page.
- `/setup` opens a read-only operator cutover checklist.
- `/source-report` opens the source-only operational report for stored events.
- `/api/setup-plan` returns the same cutover gates as JSON for deploy verification.
- `/api/source-kit` returns a source-app integration kit with endpoints, env names, policy, and snippets.
- `/api/openapi` returns the machine-readable OpenAPI 3.1 contract.
- `/api/source-report` returns a source-only operational report with no seeded demo data.
- `/api/pilot-requests` accepts public pilot interest only when durable storage, webhook, or email delivery is configured.
- `/api/pilot-requests/:id/handoff` returns an operator handoff pack for a captured pilot request.
- `/api/snapshot` returns the cockpit snapshot with any accepted source events layered over the demo data.
- `/incidents/inc_411` opens an incident investigation route.

## Product Reality

SignalOps is not claiming real traces or production customer traffic yet. The current product surface is:

- Hosted demo cockpit with seeded generation data for review.
- Real event validation API with readiness diagnostics for prospective source apps.
- Public event validator playground on `/docs` for checking source payload coverage, gaps, and next actions before integration.
- Machine-readable source kit on `/api/source-kit` so a backend integration can discover endpoints, env names, policy, and snippets without reading the repo.
- Token-protected event ingest API for server-side source apps.
- Filterable source-only operational report for stored events, explicitly excluding seeded demo data, with range/provider/model filters plus Markdown and CSV exports.
- Workspace-preview Node helper package; source kit marks it as not npm-published yet instead of implying a public package exists.
- Explicit ingest policy for free-tier pilot safety: 100 events per batch, 256KB request bodies, and redacted user/prompt fields by default.
- Per-instance rate limits for public validation, source ingest, and pilot-request writes. These are free-tier burst guards, not billing-grade quotas.
- Sensitive-field redaction is a cutover gate: `SIGNALOPS_EVENT_PRIVACY_MODE=raw` keeps the deployment out of controlled pilot setup unless it is changed back to `redact`.
- Fail-open alert evaluation for failed, retrying, provider-health, and cost-threshold events.
- Optional cockpit auth for the dashboard, incidents, and source-event snapshot API.
- Optional operator API token for protected report/queue automation without a browser cookie.
- Protected operator APIs document both browser cookie auth and bearer-token automation in OpenAPI.
- Production cutover checklist gates operator access separately from ingest auth, so reports and pilot queues are not left open by accident.
- Cutover verification rejects reused ingest/operator/cockpit/session secrets; a source-app token must not double as an operator token.
- Public pilot-request contract that refuses requests when no delivery/storage path is configured.
- Public pilot form includes a no-dependency honeypot guard that rejects obvious bot submissions before delivery/storage.
- Pilot intake requires volume, providers, pain, urgency, desired outcome, and workflow context server-side, not only in the UI.
- Pilot request delivery responses include non-secret delivery IDs, attempt timestamps, HTTP status, and signature presence for operator audit.
- Signed pilot webhooks include source-kit/docs links, validate-first env names, and pilot preflight commands so webhook-only intake can still start a setup call.
- Pilot request qualification for volume, providers, pain, urgency, and success criteria instead of generic interest capture.
- Queryable pilot qualification fields in the D1/Supabase schema, so strong-fit and urgent-fit leads are not trapped inside opaque JSON.
- Protected operator lifecycle updates for pilot requests: new, contacted, pilot scoped, closed, operator note, and next action date.
- Pilot request activity history for submission and lifecycle changes, with a durable audit table in D1/Supabase.
- Operator filters and summary metrics for open, urgent, follow-up due, unscheduled, status, and qualification-tier pilot requests.
- CSV export for the filtered operator queue, so early pilots can be worked from a spreadsheet without losing the canonical app state.
- Per-request pilot handoff packs with email draft, call agenda, success signals, validate-first source integration, SDK snippet, and preflight commands for the first setup call.
- Client-side pilot request package fallback so public interest is not lost while delivery is fail-closed.
- Local memory store by default, which is useful for development but not durable.
- Optional Cloudflare D1 storage path for the existing `signalops.cc` Vercel project, using an already-approved D1 database instead of creating new cloud projects/resources.
- Optional Supabase storage path when an approved Supabase project already exists and should be reused instead of creating Cloudflare resources.
- Pilot-ready workspace identity: `SIGNALOPS_WORKSPACE_SLUG=demo` is allowed for hosted demos but does not close the controlled-pilot gate.

Find or reuse an existing Cloudflare D1 database. In constrained/free-tier mode, use
`--existing-only` so the tool fails closed instead of nudging the operator toward a new resource:

```bash
CLOUDFLARE_API_TOKEN=... pnpm discover:cloudflare-d1 -- --existing-only --probe-schema
```

If no existing D1 database is available, do not create one from this runbook. Keep SignalOps in
`hosted_demo`, use webhook/email pilot intake for demand capture, or reuse an approved Supabase
project until a D1 slot is available.

Free-tier rule: Cloudflare D1 is acceptable only when the database already exists in the approved
Cloudflare account. SignalOps does not need a new Cloudflare Pages, Workers, Vercel, or Supabase
project for this path; it only needs durable storage credentials attached to the existing
`signalops.cc` deployment.

Apply the schema to the approved D1 database through the Cloudflare API:

```bash
pnpm prepare:cloudflare-d1-sql --write tmp/signalops-d1.sql
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_D1_DATABASE_ID=... pnpm apply:cloudflare-d1-schema -- --probe-schema
```

Or prepare a Supabase schema bundle for an existing Supabase project:

```bash
pnpm prepare:supabase-sql --write tmp/signalops-supabase.sql
```

The schema probes verify both source-report filter indexes and the exact receipt lookup key:
`PRIMARY KEY (workspace_slug, event_id)`. That key is what backs
`receipt.proof.exactSourceReportPath`, including idempotent duplicate ingests where
`duplicateEventIds` points at an event that already exists.

Apply it to an approved D1 database, then set the server-only production env vars in the existing
Vercel project. Do not create a new Vercel project for this. The tracked, secret-free template is
[`docs/signalops-env.template`](docs/signalops-env.template); use it as the operator checklist and
fill values only in Vercel or a local ignored env file.

```bash
SIGNALOPS_DATABASE_TARGET=cloudflare_d1
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_D1_DATABASE_ID=...
CLOUDFLARE_API_TOKEN=...
SIGNALOPS_REQUIRE_AUTH=true
SIGNALOPS_COCKPIT_PASSWORD=...
SIGNALOPS_SESSION_SECRET=...
SIGNALOPS_INGEST_TOKEN=...
SIGNALOPS_WORKSPACE_SLUG=signalops-pilot
SIGNALOPS_EVENT_PRIVACY_MODE=redact
SIGNALOPS_MAX_BATCH_EVENTS=100
SIGNALOPS_MAX_BODY_BYTES=262144
SIGNALOPS_PILOT_REQUEST_WEBHOOK_URL=...
SIGNALOPS_PILOT_REQUEST_WEBHOOK_SECRET=...
```

For operator access, use either `SIGNALOPS_OPERATOR_TOKEN` for CLI/API automation or cockpit
password auth with both `SIGNALOPS_COCKPIT_PASSWORD` and `SIGNALOPS_SESSION_SECRET`. A cockpit
password without an explicit session secret still protects local UI flows, but it is not treated as
pilot-ready operator access.

For Supabase reuse, set `SIGNALOPS_DATABASE_TARGET=supabase`, `SUPABASE_URL`, and
`SUPABASE_SERVICE_ROLE_KEY` instead of the Cloudflare env vars.

Pilot requests can use durable storage, `SIGNALOPS_PILOT_REQUEST_WEBHOOK_URL`, Resend email, or the
existing operator alert webhook (`SIGNALOPS_ALERT_WEBHOOK_URL`) as a fallback delivery path.
Source-event ingest also uses `SIGNALOPS_ALERT_WEBHOOK_URL` for fail-open alert handoff after events
are accepted into durable storage. Configure `SIGNALOPS_ALERT_COST_THRESHOLD_USD` to flag expensive
events.

The default ingest policy is intentionally conservative for a Cloudflare D1 free-tier pilot:
`SIGNALOPS_MAX_BATCH_EVENTS=100`, `SIGNALOPS_MAX_BODY_BYTES=262144`,
`SIGNALOPS_WORKSPACE_SLUG=signalops-pilot`, and `SIGNALOPS_EVENT_PRIVACY_MODE=redact`.
Write endpoints also expose per-instance burst guards through
`SIGNALOPS_RATE_LIMIT_WINDOW_MS`, `SIGNALOPS_EVENT_VALIDATE_RATE_LIMIT`,
`SIGNALOPS_EVENT_INGEST_RATE_LIMIT`, and `SIGNALOPS_PILOT_REQUEST_RATE_LIMIT`; clients should honor
`Retry-After` on `429 rate_limited` responses.
`/api/health`, `/api/status`, `/api/setup-plan`,
`/api/events/validate`, `/api/events`, and the OpenAPI spec expose those limits, diagnostics, and
privacy readiness so a source app can discover them before sending live traffic.

Verify the local cutover env without printing secret values:

```bash
pnpm verify:env-template
pnpm verify:cutover --local-only --probe-d1
pnpm verify:cutover --local-only --probe-supabase
```

In production, `/api/events` rejects ingest until `SIGNALOPS_INGEST_TOKEN` and durable storage are set. Local development allows tokenless ephemeral ingest by default so the cockpit loop is easy to test; set `SIGNALOPS_ALLOW_EPHEMERAL_INGEST=true` only for an intentional non-production sandbox.

Pilot request intake is deliberately fail-closed. Configure D1/Supabase, `SIGNALOPS_PILOT_REQUEST_WEBHOOK_URL`, the operator alert webhook, or Resend-backed `SIGNALOPS_PILOT_REQUEST_EMAIL_TO` / `SIGNALOPS_PILOT_REQUEST_EMAIL_FROM` before expecting `/pilot` to collect real demand.
For local workflow verification only, run with `SIGNALOPS_ALLOW_EPHEMERAL_PILOT_INTAKE=true`; this stores pilot requests in process memory and is ignored on Vercel/production.

Verify the live hosted-demo contracts after deploy:

```bash
pnpm verify:openapi
SIGNALOPS_BASE_URL=https://signalops.cc pnpm verify:release-readiness --allow-blocked
SIGNALOPS_BASE_URL=https://signalops.cc pnpm verify:live-contracts
SIGNALOPS_BASE_URL=https://signalops.cc pnpm verify:cutover --probe-d1 --allow-blocked
SIGNALOPS_BASE_URL=https://signalops.cc pnpm verify:cutover --probe-supabase --allow-blocked
SIGNALOPS_BASE_URL=https://signalops.cc pnpm verify:source-smoke --allow-storage-gate
SIGNALOPS_BASE_URL=https://signalops.cc pnpm verify:pilot-preflight -- --allow-storage-gate
SIGNALOPS_BASE_URL=https://signalops.cc SIGNALOPS_INGEST_TOKEN=... SIGNALOPS_OPERATOR_TOKEN=... pnpm verify:pilot-preflight -- --require-pilot-ready
```

Validate a source-app event without a token or storage:

```bash
curl -X POST https://signalops.cc/api/events/validate \
  -H "content-type: application/json" \
  -d '{
    "type": "generation.completed",
    "generationId": "gen_prod_001",
    "providerId": "fal",
    "modelId": "flux-2-pro",
    "status": "succeeded",
    "source": "production-api",
    "durationMs": 18420,
    "cost": 0.052,
    "retryCount": 1
  }'
```

Store a source-app smoke event after `SIGNALOPS_INGEST_TOKEN` is set:

```bash
curl -X POST https://signalops.cc/api/events \
  -H "content-type: application/json" \
  -H "authorization: Bearer $SIGNALOPS_INGEST_TOKEN" \
  -d '{
    "type": "generation.completed",
    "generationId": "gen_prod_001",
    "providerId": "fal",
    "modelId": "flux-2-pro",
    "status": "succeeded",
    "source": "production-api",
    "durationMs": 18420,
    "cost": 0.052,
    "retryCount": 1
  }'
```

The source smoke verifier exercises the same flow without printing the token: public validation,
unauthenticated ingest rejection, then authenticated ingest. Before durable storage is connected, a
`503 ingest_storage_not_configured` result is expected with `--allow-storage-gate`.
Successful ingest responses include a `receipt` object. Treat `receipt.proof.durableWrite=true`,
`receipt.proof.demoDataIncluded=false`, and a matching `/source-report` row as the first real source
event proof. Idempotent retries return `duplicateEventIds` and keep
`receipt.proof.exactSourceReportPath` pointed at the existing event. A memory-store receipt is useful
for local workflow checks but is not pilot evidence.

Source apps can use the first-party Node helper once the package source is built:

```ts
import { createSignalOpsClient, createSignalOpsEventId } from "@signalops/node";

const signalops = createSignalOpsClient({
  endpoint: "https://signalops.cc",
  token: process.env.SIGNALOPS_INGEST_TOKEN,
  failOpen: true,
});

await signalops.validate({
  type: "generation.completed",
  generationId: "gen_contract_check",
  providerId: "fal",
  modelId: "flux-2-pro",
});

const sourceVerification = await signalops.verifySource(
  {
    type: "generation.completed",
    generationId: "gen_contract_check",
    providerId: "fal",
    modelId: "flux-2-pro",
    status: "succeeded",
    source: "production-api",
    durationMs: 18420,
    cost: 0.052,
  },
  { allowStorageGate: true },
);

console.log(sourceVerification.mode); // validation_only, storage_gate, or authenticated_ingest

const image = await signalops.trackGeneration(
  {
    generationId: "gen_prod_001",
    providerId: "fal",
    modelId: "flux-2-pro",
    source: "production-api",
  },
  () => generateImage(),
);

await signalops.generationRetrying({
  generationId: "gen_prod_001",
  providerId: "fal",
  modelId: "flux-2-pro",
  status: "retrying",
  retryCount: 1,
});

await signalops.providerHealth({
  eventId: createSignalOpsEventId("provider.health", "fal:status-page:2026-06-25T10:00Z"),
  providerId: "fal",
  status: "retrying",
  source: "provider-status-page",
});

await signalops.costRecorded({
  eventId: createSignalOpsEventId("cost.recorded", "gen_prod_001:final"),
  generationId: "gen_prod_001",
  providerId: "fal",
  modelId: "flux-2-pro",
  cost: 0.052,
});
```

The workspace-preview CLI exposes the same contract without pretending the package is already public on npm:

```bash
pnpm --filter @signalops/node build
node packages/signalops-node/dist/cli.js source-kit --endpoint https://signalops.cc
node packages/signalops-node/dist/cli.js validate-events --endpoint https://signalops.cc --file ./event.json
node packages/signalops-node/dist/cli.js verify-source --endpoint https://signalops.cc --token "$SIGNALOPS_INGEST_TOKEN" --generation gen_prod_001 --event-id "generation.completed:gen_prod_001" --allow-storage-gate
node packages/signalops-node/dist/cli.js source-report --endpoint https://signalops.cc --operator-token "$SIGNALOPS_OPERATOR_TOKEN" --event-id "generation.completed:gen_prod_001"
node packages/signalops-node/dist/cli.js source-report --endpoint https://signalops.cc --operator-token "$SIGNALOPS_OPERATOR_TOKEN" --range 24h --provider-id fal --model-id flux-2-pro
node packages/signalops-node/dist/cli.js source-report --endpoint https://signalops.cc --operator-token "$SIGNALOPS_OPERATOR_TOKEN" --range 24h --provider-id fal --format markdown
```

## Portfolio Notes

This project is meant to sit next to Phosphene as a different signal:

- Phosphene: solo product ownership, AI workflows, payments, auth, storage, production deployment.
- SignalOps: senior React/data-heavy frontend, custom dashboard UX, headless table primitives, virtualized rendering, and design-system execution.

Good case-study angle:

> Built a custom AI generation operations dashboard with TanStack Table + TanStack Virtual instead of using a prebuilt enterprise grid, keeping the UI bespoke while still handling large datasets, incident triage, and routing-rule workflows.
