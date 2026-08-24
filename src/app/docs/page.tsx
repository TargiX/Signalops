import type { Metadata } from "next";
import { ArrowRight, Check, FileJson, KeyRound, RadioTower, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { PublicPageHeading, PublicShell } from "@/components/public-shell";
import { buildSignalOpsRawHttpQuickstartV1 } from "@/lib/signalops/v1/quickstart";

export const metadata: Metadata = {
  title: "Documentation · SignalOps",
  description: "Integrate Canonical AI Telemetry V1 with raw HTTP or the framework-neutral Node producer.",
};

const quickstart = buildSignalOpsRawHttpQuickstartV1({
  endpoint: "https://signalops.cc/v1/events",
});

export default function DocsPage() {
  return (
    <PublicShell>
      <PublicPageHeading eyebrow="Canonical AI Telemetry V1" title="Instrument once. Keep every client adapter replaceable." description="SignalOps consumes five privacy-safe lifecycle boundaries. Your product retains its provider-management architecture; the adapter maps local facts into a stable, vendor-neutral contract." />

      <section className="grid gap-4 sm:grid-cols-3">
        <DocFact icon={KeyRound} title="Server credential" text="Create a scoped key in onboarding or settings. Never place it in browser or mobile code." />
        <DocFact icon={RadioTower} title="Five boundaries" text="Operation accepted/terminal, attempt started/terminal, and optional provider probes." />
        <DocFact icon={ShieldCheck} title="Privacy gate" text="Prompts, media, identities, URLs, raw errors, stack traces, and credentials are rejected or removed." />
      </section>

      <section className="mt-12 grid min-w-0 gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
        <div className="min-w-0 lg:sticky lg:top-8">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--accent)]">Quickstart · raw HTTP</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--text-strong)]">Send a useful operation without installing a package.</h2>
          <p className="mt-4 text-sm leading-6 text-[var(--text-dim)]">Save the script as <code className="rounded bg-[var(--surface-mute)] px-1.5 py-0.5 font-mono text-xs">quickstart.mjs</code>, provide your one-time credential through the environment, and run it on Node 20+.</p>
          <pre className="mt-5 overflow-x-auto rounded-lg border border-[var(--border)] bg-white p-3 font-mono text-[11px] text-[var(--text-dim)]">SIGNALOPS_INGEST_CREDENTIAL=&quot;sop_live_…&quot; node quickstart.mjs</pre>
          <Link href="/onboarding" className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-xs font-bold text-white hover:bg-[var(--accent-hover)]">Create a workspace <ArrowRight className="size-3.5" /></Link>
        </div>
        <div className="min-w-0 overflow-hidden rounded-xl border border-[#1d2b52] bg-[#07122b] shadow-lg">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-white"><FileJson className="size-4 text-[#79a0ff]" /> quickstart.mjs</div>
          <pre className="max-h-[720px] overflow-auto p-5 text-[11px] leading-5 text-[#dce6ff]"><code>{quickstart}</code></pre>
        </div>
      </section>

      <section className="mt-16">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--accent)]">Lifecycle model</p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--text-strong)]">Client facts map to canonical facts.</h2>
        <div className="mt-7 overflow-x-auto rounded-xl border border-[var(--border)] bg-white shadow-sm">
          <table className="w-full min-w-[700px] border-collapse text-left text-sm">
            <thead className="bg-[var(--surface-mute)] text-xs text-[var(--text-dim)]"><tr><th className="px-5 py-3">Your application</th><th className="px-5 py-3">SignalOps boundary</th><th className="px-5 py-3">Emit when</th></tr></thead>
            <tbody className="divide-y divide-[var(--border)] text-[var(--text-dim)]">
              <ContractRow local="Durable job accepted" canonical="operation.accepted" when="Your system commits responsibility for the operation." />
              <ContractRow local="Provider call starts" canonical="attempt.started" when="A request is about to cross the provider seam." />
              <ContractRow local="Provider call ends" canonical="attempt.terminal" when="The exact attempt succeeds, fails, expires, or is cancelled." />
              <ContractRow local="Customer-visible job ends" canonical="operation.terminal" when="The overall operation reaches one final outcome." />
              <ContractRow local="Synthetic route check" canonical="provider.probe" when="A bounded health probe completes; optional and separate from user work." />
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-16 grid gap-5 lg:grid-cols-2">
        <Guide title="Production delivery checklist" items={["Emit after durable state transitions, not before database commit.", "Derive stable event IDs so delivery retries are idempotent.", "Persist dead letters or use your existing durable outbox.", "Keep provider request ID, operation ID, and model keys opaque.", "Use normalized failure category, responsibility, code, and retryability."]} />
        <Guide title="Universal adapter boundary" items={["Core contract has no Nuxt, Next, Supabase, queue, or provider dependency.", "Each client owns a thin mapper at its actual lifecycle seams.", "Provider connection keys remain opaque; SignalOps never manages customer credentials.", "Conformance scenarios prove success, retry, fallback, failure, privacy, and replay.", "The Node producer in this repository is release-ready; registry publication is tracked separately."]} />
      </section>

      <section className="mt-16 rounded-2xl border border-[#cfe0f6] bg-[linear-gradient(110deg,#eaf2ff,#f9fbff,#e7f8f1)] p-8 sm:p-10">
        <h2 className="text-3xl font-semibold text-[var(--text-strong)]">Need a client-specific adapter?</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--text-dim)]">Start from the generic contract and conformance suite. We can review lifecycle seams for Nuxt, Next.js, queue workers, or a custom runtime without forcing an application rewrite.</p>
        <Link href="/contact" className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-[var(--accent)]">Discuss an adapter <ArrowRight className="size-4" /></Link>
      </section>
    </PublicShell>
  );
}

function DocFact({ icon: Icon, title, text }: { icon: typeof KeyRound; title: string; text: string }) {
  return <article className="rounded-xl border border-[var(--border)] bg-white p-5 shadow-sm"><Icon className="size-5 text-[var(--accent)]" /><h2 className="mt-4 text-sm font-bold text-[var(--text-strong)]">{title}</h2><p className="mt-2 text-xs leading-5 text-[var(--text-dim)]">{text}</p></article>;
}

function ContractRow({ local, canonical, when }: { local: string; canonical: string; when: string }) {
  return <tr><td className="px-5 py-4 font-semibold text-[var(--text-strong)]">{local}</td><td className="px-5 py-4 font-mono text-xs text-[var(--accent)]">{canonical}</td><td className="px-5 py-4 leading-6">{when}</td></tr>;
}

function Guide({ title, items }: { title: string; items: string[] }) {
  return <article className="rounded-xl border border-[var(--border)] bg-white p-6 shadow-sm"><h2 className="text-xl font-semibold text-[var(--text-strong)]">{title}</h2><ul className="mt-5 grid gap-3 text-sm leading-6 text-[var(--text-dim)]">{items.map((item) => <li key={item} className="flex items-start gap-3"><Check className="mt-1 size-3.5 shrink-0 text-emerald-600" />{item}</li>)}</ul></article>;
}
