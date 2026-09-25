import { CheckCircle2, CircleDotDashed, ExternalLink, XCircle } from "lucide-react";
import Link from "next/link";

import { buildSetupPlan } from "@/lib/signalops/setup-plan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function StatusPage() {
  const plan = await buildSetupPlan();
  const blockedGates = plan.gates.filter((gate) => !gate.ready);
  const isPilotSetup = plan.stage === "pilot_setup";
  const sourceIngestReady = Boolean(plan.gates.find((gate) => gate.id === "ingest_auth")?.ready);
  const durableStorageReady = Boolean(plan.gates.find((gate) => gate.id === "durable_storage")?.ready);
  const pilotDeliveryReady = Boolean(plan.gates.find((gate) => gate.id === "pilot_delivery")?.ready);

  return (
    <main className="min-h-screen bg-[var(--background)] px-5 py-8 text-[var(--text)] sm:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link href="/" className="text-sm font-semibold text-[var(--accent)]">
            Back to SignalOps
          </Link>
          <div className="flex flex-wrap gap-3 text-sm font-semibold">
            <Link href="/docs" className="text-[var(--accent)]">
              Source docs
            </Link>
            <Link href="/api/status" className="text-[var(--accent)]">
              Status JSON
            </Link>
            <Link href="/api/health" className="text-[var(--accent)]">
              Health JSON
            </Link>
            <Link href="/source-report" className="text-[var(--accent)]">
              Source report
            </Link>
          </div>
        </div>

        <section className="mt-10">
          <p className="font-mono text-[11px] font-bold uppercase text-[var(--accent)]">
            Public product status
          </p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-[-0.03em] text-[var(--text-strong)]">
            {isPilotSetup ? "Pilot setup, not production-ready" : "Hosted demo, not production-ready"}
          </h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[var(--text-dim)]">
            {isPilotSetup
              ? "SignalOps has the minimum pilot setup gates closed: public URLs, durable storage, protected ingest, real workspace identity, redacted privacy mode, separated secrets, operator access, pilot delivery, and first real source traffic. It still does not claim production readiness until a customer pilot proves sustained value."
              : "SignalOps is currently a hosted demo with a real validation API and a token-protected ingest boundary. It does not claim production customer traffic until public URLs, durable storage, real workspace identity, redacted privacy mode, separated secrets, pilot delivery, and first real source traffic are all proven."}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold shadow-[var(--shadow-1)]">
              <CircleDotDashed className="size-4 text-[var(--accent)]" />
              {plan.readyCount} of {plan.totalCount} gates ready
            </span>
            <span className="rounded-full bg-[var(--surface-mute)] px-3 py-1 text-xs font-semibold text-[var(--text-dim)]">
              {plan.stage}
            </span>
          </div>
        </section>

        <section className="mt-8 grid gap-5 md:grid-cols-3">
          <article className="rounded-lg border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)]">
            <h2 className="text-lg font-semibold text-[var(--text-strong)]">Can validate events</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">
              The public dry-run endpoint is available and stores zero events.
            </p>
          </article>
          <article className="rounded-lg border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)]">
            <h2 className="text-lg font-semibold text-[var(--text-strong)]">
              {sourceIngestReady && durableStorageReady ? "Source ingest available" : "Source ingest blocked"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">
              {sourceIngestReady && durableStorageReady
                ? "Authenticated source traffic can be accepted; pilot setup still needs the remaining evidence gates."
                : "Authenticated source traffic stays blocked until D1 or Supabase durable storage and ingest auth are connected."}
            </p>
          </article>
          <article className="rounded-lg border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)]">
            <h2 className="text-lg font-semibold text-[var(--text-strong)]">
              {pilotDeliveryReady ? "Pilot intake available" : "Pilot intake guarded"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">
              {pilotDeliveryReady
                ? "Public requests have a configured storage or delivery path for operator follow-up."
                : "Public requests fail closed unless storage, webhook, alert fallback, or email delivery is configured."}
            </p>
          </article>
        </section>

        <section className="mt-8 grid gap-4">
          {plan.gates.map((gate) => (
            <article key={gate.id} className="rounded-lg border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    {gate.ready ? (
                      <CheckCircle2 className="size-5 text-[var(--success)]" />
                    ) : (
                      <XCircle className="size-5 text-[var(--danger)]" />
                    )}
                    <h2 className="text-lg font-semibold text-[var(--text-strong)]">{gate.label}</h2>
                  </div>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-dim)]">{gate.detail}</p>
                </div>
                <span className="rounded-full bg-[var(--surface-mute)] px-3 py-1 text-xs font-semibold text-[var(--text-dim)]">
                  {gate.ready ? "ready" : "blocked"}
                </span>
              </div>
            </article>
          ))}
        </section>

        <section className="mt-5 rounded-lg border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)]">
          <h2 className="text-lg font-semibold text-[var(--text-strong)]">Next blockers</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">
            {blockedGates.length > 0
              ? blockedGates.map((gate) => gate.id).join(", ")
              : "All cutover gates are currently ready."}
          </p>
          <Link href="/setup" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent)]">
            Operator setup
            <ExternalLink className="size-4" />
          </Link>
        </section>
      </div>
    </main>
  );
}
