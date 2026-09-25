import { CheckCircle2, CircleDotDashed, ExternalLink, XCircle } from "lucide-react";
import Link from "next/link";

import { buildSetupPlan } from "@/lib/signalops/setup-plan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function SetupPage() {
  const plan = await buildSetupPlan();

  return (
    <main className="min-h-screen overflow-x-hidden bg-[var(--background)] px-5 py-8 text-[var(--text)] sm:px-8">
      <div className="mx-auto w-full max-w-5xl min-w-0">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-4">
          <Link href="/" className="text-sm font-semibold text-[var(--accent)]">
            Back to SignalOps
          </Link>
          <div className="flex min-w-0 flex-wrap justify-end gap-3 text-sm font-semibold">
            <Link href="/status" className="text-[var(--accent)]">
              Public Status
            </Link>
            <Link href="/api/status" className="text-[var(--accent)]">
              Status JSON
            </Link>
            <Link href="/api/health" className="text-[var(--accent)]">
              Health JSON
            </Link>
            <Link href="/api/setup-plan" className="text-[var(--accent)]">
              Setup JSON
            </Link>
            <Link href="/pilot-requests" className="text-[var(--accent)]">
              Pilot Requests
            </Link>
            <Link href="/source-report" className="text-[var(--accent)]">
              Source Report
            </Link>
            <Link href="/api/source-kit" className="text-[var(--accent)]">
              Source Kit
            </Link>
          </div>
        </div>

        <section className="mt-10">
          <p className="font-mono text-[11px] font-bold uppercase text-[var(--accent)]">Operator setup</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-[-0.03em] text-[var(--text-strong)]">
            Production cutover checklist
          </h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[var(--text-dim)]">
            This page reads only env presence and storage mode. It does not expose secret values.
            SignalOps stays in hosted-demo mode until public URLs, durable storage, workspace
            identity, operator access, secret separation, ingest auth, redacted privacy mode, pilot
            delivery, and one real source event are all proven. The repo template
            <code> docs/signalops-env.template</code> is the secret-free checklist for the existing
            Vercel project.
          </p>
          <div className="mt-6 inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold shadow-[var(--shadow-1)]">
            <CircleDotDashed className="size-4 text-[var(--accent)]" />
            {plan.readyCount} of {plan.totalCount} gates ready
          </div>
        </section>

        <section className="mt-8 grid gap-5">
          {plan.gates.map((gate) => (
            <article key={gate.id} className="min-w-0 rounded-lg border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)]">
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    {gate.ready ? (
                      <CheckCircle2 className="size-5 text-[var(--success)]" />
                    ) : (
                      <XCircle className="size-5 text-[var(--danger)]" />
                    )}
                    <h2 className="min-w-0 text-lg font-semibold text-[var(--text-strong)]">{gate.label}</h2>
                  </div>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-dim)]">{gate.detail}</p>
                </div>
                <span className="rounded-full bg-[var(--surface-mute)] px-3 py-1 text-xs font-semibold text-[var(--text-dim)]">
                  {gate.ready ? "ready" : "blocked"}
                </span>
              </div>
              <pre className="mt-4 max-w-full overflow-x-auto rounded-lg bg-[#07122b] p-4 text-xs leading-6 text-white">
                {gate.commands.join("\n")}
              </pre>
            </article>
          ))}
        </section>

        <section className="mt-5 min-w-0 rounded-lg border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)]">
          <h2 className="text-lg font-semibold text-[var(--text-strong)]">After env changes</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">
            Redeploy the existing Vercel project, then re-open this page and verify the public
            status contracts before sending real source traffic.
          </p>
          <pre className="mt-4 max-w-full overflow-x-auto rounded-lg bg-[#07122b] p-4 text-xs leading-6 text-white">
            pnpm verify:env-template{"\n"}
            SIGNALOPS_BASE_URL=https://signalops.cc pnpm verify:cutover --probe-d1 --allow-blocked
          </pre>
          <Link href="/docs" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent)]">
            Source-app docs
            <ExternalLink className="size-4" />
          </Link>
          <Link href="/source-report" className="ml-4 mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent)]">
            Source-only report
            <ExternalLink className="size-4" />
          </Link>
        </section>
      </div>
    </main>
  );
}
