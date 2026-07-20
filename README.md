# SignalOps

**Live demo:** [signalops.cc](https://signalops.cc)  
**Source:** [github.com/TargiX/signalops](https://github.com/TargiX/signalops)

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

## Run locally

Requires Node.js 24 or newer and pnpm 10.24.0, matching CI and the native TypeScript contract checks.

```bash
pnpm install
pnpm dev
```

The dev server is pinned to [http://localhost:3020](http://localhost:3020) to avoid colliding with other local portfolio/product apps.

## Event API boundaries

- `POST /api/events/validate` is public and verification-only. It normalizes and redacts events but stores nothing.
- `POST /api/events` is a protected development/test ingest seam. Set `SIGNALOPS_INGEST_TOKEN` and send that exact value using the Bearer authorization scheme.
- Accepted local events always use the validator's bounded JSON, batch, normalization, and redaction contract. Exact retries return the same receipt reference and do not duplicate retained events.
- The local memory sink retains at most 1,000 events and can evict the oldest retained event. Receipts expose stored, duplicate, evicted, and retained counts so this behavior is not presented as durability.
- Production intentionally returns `503 storage_not_ready` after authentication because this slice does not configure a durable store. The endpoint is not production-ready until a separate durable sink is implemented and explicitly wired.

## Demo script

For a fast portfolio review, the dashboard opens with a **Guided incident replay** rail directly under the header. It turns the surface into a self-explaining demo — a first-run reviewer can follow one incident end to end in well under 90 seconds.

The fastest shareable entry point is [`/cockpit?replay=alibaba-p95&step=0`](https://signalops.cc/cockpit?replay=alibaba-p95&step=0). The home page secondary CTA now opens that guided replay directly instead of sending reviewers to an unframed incident detail first.

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
- `/cockpit?replay=alibaba-p95&step=0` opens the guided replay from the first step.
- `/incidents/inc_411` opens an incident investigation route.

## Portfolio Notes

This project is meant to sit next to Phosphene as a different signal:

- Phosphene: solo product ownership, AI workflows, payments, auth, storage, production deployment.
- SignalOps: senior React/data-heavy frontend, custom dashboard UX, headless table primitives, virtualized rendering, and design-system execution.

Good case-study angle:

> Built a custom AI generation operations dashboard with TanStack Table + TanStack Virtual instead of using a prebuilt enterprise grid, keeping the UI bespoke while still handling large datasets, incident triage, and routing-rule workflows.
