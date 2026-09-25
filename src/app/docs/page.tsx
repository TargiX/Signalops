import Link from "next/link";

import { EventValidatorPlayground } from "@/components/event-validator-playground";

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-[var(--background)] px-5 py-8 text-[var(--text)] sm:px-8">
      <div className="mx-auto max-w-4xl">
        <Link href="/" className="text-sm font-semibold text-[var(--accent)]">
          Back to SignalOps
        </Link>
        <section className="mt-10">
          <h1 className="text-4xl font-semibold tracking-[-0.03em] text-[var(--text-strong)]">
            Connect a source app
          </h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[var(--text-dim)]">
            SignalOps currently exposes a real server-side event boundary for generation lifecycle,
            provider-health, and cost events. The hosted demo remains honest: without durable D1
            storage and an ingest token, it is still a demo surface.
          </p>
        </section>

        <section className="mt-8 rounded-lg border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)]">
          <h2 className="text-lg font-semibold text-[var(--text-strong)]">Validate without storing</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">
            Use the public dry-run endpoint first. It checks the event contract, returns readiness
            diagnostics for coverage gaps and next actions, and never stores payloads or triggers
            alerts. The hosted policy starts conservatively at 100 events per batch, 256KB request
            bodies, and redacted user/prompt fields by default.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-lg bg-[#07122b] p-4 text-xs leading-6 text-white">
{`curl -X POST https://signalops.cc/api/events/validate \\
  -H "content-type: application/json" \\
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
  }'`}
          </pre>
        </section>

        <EventValidatorPlayground />

        <section className="mt-5 rounded-lg border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)]">
          <h2 className="text-lg font-semibold text-[var(--text-strong)]">Store a real event</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">
            Production ingest requires a server-side token. On the hosted demo, this endpoint is
            intentionally locked until the operator sets durable storage and auth env. Vercel
            deployments do not accept source events into memory storage. Controlled pilots also
            require a real non-demo workspace slug and redacted privacy mode; raw user/prompt ingest
            stays outside the pilot-ready boundary.
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">
            <code>/api/health</code>, validation responses, and ingest responses echo the active
            ingest policy and diagnostics so a source app can stay inside the pilot budget before
            durable traffic is enabled. After events are stored, <code>/source-report</code> shows
            a source-only operational report without seeded demo data; it can filter by time window,
            provider, and model, then export Markdown or CSV for pilot follow-up.
            Successful ingest responses also return a source-event receipt. Use
            <code>receipt.proof.durableWrite=true</code> with
            <code>receipt.proof.demoDataIncluded=false</code> as the first-event proof boundary; a
            memory-store receipt is local workflow evidence, not pilot evidence.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-lg bg-[#07122b] p-4 text-xs leading-6 text-white">
{`curl -X POST https://signalops.cc/api/events \\
  -H "content-type: application/json" \\
  -H "authorization: Bearer $SIGNALOPS_INGEST_TOKEN" \\
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
  }'`}
          </pre>
        </section>

        <section className="mt-5 rounded-lg border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)]">
          <h2 className="text-lg font-semibold text-[var(--text-strong)]">Node SDK shape</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">
            The first-party Node helper keeps tokens server-side, supports public validation, and
            wraps a provider call with started/completed/failed telemetry. It is currently a
            workspace-preview package; <code>/api/source-kit</code> exposes that distribution status
            instead of implying an npm release exists.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-lg bg-[#07122b] p-4 text-xs leading-6 text-white">
{`import { createSignalOpsClient, createSignalOpsEventId } from "@signalops/node";

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
});`}
          </pre>
        </section>

        <section className="mt-5 rounded-lg border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)]">
          <h2 className="text-lg font-semibold text-[var(--text-strong)]">CLI workflow</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">
            The workspace-preview CLI can validate events, run a source smoke check, and pull the
            same filtered source-only report as JSON, Markdown, or CSV. Protected report reads use
            <code>SIGNALOPS_OPERATOR_TOKEN</code>; ingest still uses <code>SIGNALOPS_INGEST_TOKEN</code>.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-lg bg-[#07122b] p-4 text-xs leading-6 text-white">
{`pnpm --filter @signalops/node build
node packages/signalops-node/dist/cli.js validate-events --endpoint https://signalops.cc --file ./event.json
node packages/signalops-node/dist/cli.js verify-source --endpoint https://signalops.cc --token "$SIGNALOPS_INGEST_TOKEN" --allow-storage-gate --provider fal --model flux-2-pro --generation gen_prod_001 --event-id "generation.completed:gen_prod_001"
node packages/signalops-node/dist/cli.js source-report --endpoint https://signalops.cc --operator-token "$SIGNALOPS_OPERATOR_TOKEN" --range 24h --provider-id fal --model-id flux-2-pro
node packages/signalops-node/dist/cli.js source-report --endpoint https://signalops.cc --operator-token "$SIGNALOPS_OPERATOR_TOKEN" --range 24h --provider-id fal --format markdown`}
          </pre>
        </section>

        <section className="mt-5 rounded-lg border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)]">
          <h2 className="text-lg font-semibold text-[var(--text-strong)]">Pilot preflight</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">
            Before inviting a source app into a pilot, run one preflight that checks public
            contracts, representative event validation, ingest auth, storage readiness, and
            operator report access. The soft mode is useful before D1 cutover; the strict mode is
            the gate before sending real source traffic.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-lg bg-[#07122b] p-4 text-xs leading-6 text-white">
{`SIGNALOPS_BASE_URL=https://signalops.cc pnpm verify:pilot-preflight -- --allow-storage-gate
SIGNALOPS_BASE_URL=https://signalops.cc SIGNALOPS_INGEST_TOKEN=... SIGNALOPS_OPERATOR_TOKEN=... pnpm verify:pilot-preflight -- --require-pilot-ready`}
          </pre>
        </section>

        <section className="mt-5 grid gap-5 md:grid-cols-2">
          <div className="rounded-lg border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)]">
            <h2 className="text-lg font-semibold text-[var(--text-strong)]">Status contract</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">
              <Link href="/status" className="font-semibold text-[var(--accent)]">/status</Link>{" "}
              explains the public claim boundary for humans. <code>/api/status</code> reports
              whether this deployment is still a hosted demo or ready for controlled pilot setup.{" "}
              <code>/api/health</code> exposes the operator-facing readiness pieces.{" "}
              <code>/api/source-kit</code> gives source apps one JSON integration kit with endpoints,
              env names, policy, and snippets. <code>/api/openapi</code> exposes the machine-readable
              API contract.
            </p>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)]">
            <h2 className="text-lg font-semibold text-[var(--text-strong)]">Durable storage path</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">
              Reuse an approved D1 database or an existing Supabase project; free-tier mode should
              not create a new Cloudflare, Vercel, or Supabase project. For D1, run{" "}
              <code>CLOUDFLARE_API_TOKEN=... pnpm discover:cloudflare-d1 -- --existing-only --probe-schema</code>{" "}
              to find the database and env values, then run{" "}
              <code>pnpm prepare:cloudflare-d1-sql --write tmp/signalops-d1.sql</code> and{" "}
              <code>pnpm apply:cloudflare-d1-schema -- --probe-schema</code> to apply the schema if
              needed. Verify it with{" "}
              <code>pnpm verify:cutover --local-only --probe-d1</code>. For Supabase, run{" "}
              <code>pnpm prepare:supabase-sql --write tmp/signalops-supabase.sql</code> and verify
              with <code>pnpm verify:cutover --local-only --probe-supabase</code>. The
              pilot request table stores qualification tier and signals as queryable columns so
              operator follow-up can prioritize strong-fit and urgent-fit requests.
            </p>
          </div>
        </section>
        <section className="mt-5 rounded-lg border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)]">
          <h2 className="text-lg font-semibold text-[var(--text-strong)]">Pilot request intake</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">
            <code>/api/pilot-requests</code> accepts public pilot interest only when durable storage,
            a dedicated webhook, the operator alert webhook, or Resend email delivery is configured.
            Without one of those paths it returns{" "}
            <code>503 pilot_intake_not_configured</code> so requests are not silently lost. Captured
            request responses include non-secret delivery IDs, attempt timestamps, HTTP status, and
            signature presence for audit. Production/Vercel delivery URLs must use HTTPS; plain HTTP
            receivers are accepted only for local workflow checks. Captured requests appear in the protected operator queue
            with lifecycle status, operator notes, next-action dates, activity history,
            status/tier/follow-up filters, CSV export, and summary counts for open, urgent, due, and
            unscheduled follow-up. Each captured request can also generate a handoff pack with a
            first-reply draft, setup-call agenda, success signals, validate-first source commands,
            SDK snippet, and preflight commands. For local workflow checks only,{" "}
            <code>SIGNALOPS_ALLOW_EPHEMERAL_PILOT_INTAKE=true</code> stores requests in process
            memory and is ignored on Vercel/production.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-lg bg-[#07122b] p-4 text-xs leading-6 text-white">
{`curl -X POST https://signalops.cc/api/pilot-requests \\
  -H "content-type: application/json" \\
  -d '{
    "name": "Maya Chen",
    "email": "maya@example.com",
    "company": "Image Studio",
    "productUrl": "https://example.com",
    "generationVolume": "50k images/month",
    "providers": "fal, OpenAI",
    "primaryPain": "Provider latency spikes and retry storms",
    "urgency": "this_month",
    "desiredOutcome": "Know which provider/model is causing user-visible failures before support tickets arrive.",
    "useCase": "We run image generation jobs across multiple providers and need latency, retry, and cost visibility."
  }'`}
          </pre>
        </section>
        <section className="mt-5 rounded-lg border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)]">
          <h2 className="text-lg font-semibold text-[var(--text-strong)]">Operator cutover</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">
            The <Link href="/setup" className="font-semibold text-[var(--accent)]">setup console</Link>{" "}
            shows the current production gates and the exact env/storage commands needed to move
            from hosted demo to controlled pilot setup.
          </p>
        </section>
      </div>
    </main>
  );
}
