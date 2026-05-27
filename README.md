# SignalOps

SignalOps is a portfolio-grade React dashboard for operating AI image-generation products. It is intentionally built as a custom interface rather than a dropped-in enterprise grid, so the implementation shows state management, data density, virtualization, and design-system work.

## What It Demonstrates

- A custom virtualized data grid built with TanStack Table and TanStack Virtual.
- Server-state style data loading with TanStack Query.
- 10,000 synthetic generation jobs with only the visible rows mounted.
- Provider health, routing risk, spend, latency, and failure-rate analysis.
- Saved ops views for overview, provider triage, and cost review.
- A selectable incident investigation flow with affected jobs, job detail selection, and queue focus.
- A routing rule builder with trigger modes, traffic-drain slider, and simulated impact on jobs, p95, failures, and cost.
- A bespoke Soft Light design system with Inter, JetBrains Mono, warm surfaces, subtle borders, and muted semantic status colors.

## Stack

- Next.js App Router
- React 19
- TypeScript
- Tailwind CSS
- TanStack Query
- TanStack Table
- TanStack Virtual
- Recharts
- Lucide React

## Run Locally

```bash
pnpm install
pnpm dev
```

The dev server is pinned to [http://localhost:3020](http://localhost:3020) to avoid colliding with other local portfolio/product apps.

## Portfolio Notes

This project is meant to sit next to Phosphene as a different signal:

- Phosphene: solo product ownership, AI workflows, payments, auth, storage, production deployment.
- SignalOps: senior React/data-heavy frontend, custom dashboard UX, headless table primitives, virtualized rendering, and design-system execution.

Good case-study angle:

> Built a custom AI generation operations dashboard with TanStack Table + TanStack Virtual instead of using a prebuilt enterprise grid, keeping the UI bespoke while still handling large datasets, incident triage, and routing-rule workflows.
