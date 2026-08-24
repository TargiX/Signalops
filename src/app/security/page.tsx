import type { Metadata } from "next";
import { Check, KeyRound, LockKeyhole, ScanSearch, ShieldCheck } from "lucide-react";

import { PublicPageHeading, PublicShell } from "@/components/public-shell";

export const metadata: Metadata = {
  title: "Security · SignalOps",
  description: "SignalOps security model, privacy boundaries, credential lifecycle, and current assurance status.",
};

export default function SecurityPage() {
  return (
    <PublicShell>
      <PublicPageHeading eyebrow="Security by contract" title="Observe AI operations without collecting AI content." description="SignalOps is designed around bounded operational facts. Security controls sit at schema validation, identity, tenant authorization, storage, and credential lifecycle boundaries." />
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SecurityFact icon={ScanSearch} title="Schema gate" text="Unknown fields and unsafe values fail validation before durable ingestion." />
        <SecurityFact icon={KeyRound} title="Digest-only keys" text="Managed ingest secrets appear once; only SHA-256 digests and safe prefixes persist." />
        <SecurityFact icon={LockKeyhole} title="Tenant isolation" text="Operator membership is revalidated against durable storage near every protected read and mutation." />
        <SecurityFact icon={ShieldCheck} title="Deny-by-default data plane" text="Browser roles have no direct grants to SignalOps tables or administrative RPCs." />
      </section>
      <section className="mt-12 grid gap-5 lg:grid-cols-2">
        <SecurityList title="Data SignalOps accepts" items={["Opaque operation and attempt identifiers", "Normalized provider route and logical model keys", "Lifecycle timestamps and bounded durations", "Normalized failure taxonomy and retryability", "Reported or estimated cost with explicit provenance", "Environment, service, release, and region keys"]} />
        <SecurityList title="Data the contract excludes" items={["Prompts, completions, transcripts, or embeddings", "Generated media, input media, or arbitrary URLs", "Customer names, email addresses, or application user IDs", "Provider API keys or customer ingest credentials", "Raw provider errors, stack traces, or free-form logs", "Nested arbitrary metadata or unbounded attributes"]} danger />
      </section>
      <section className="mt-12 rounded-xl border border-[var(--border)] bg-white p-7 shadow-sm">
        <h2 className="text-2xl font-semibold text-[var(--text-strong)]">Current public-beta assurance status</h2>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--text-dim)]">SignalOps currently does not claim SOC 2 certification, ISO 27001 certification, HIPAA eligibility, or a contractual 99.9% SLA. Those require independent scope, controls, evidence, legal terms, and completed audits. The product does enforce HTTPS in production, HSTS, CSP, same-origin mutation checks, signed HttpOnly operator sessions, rate limits, bounded payloads, audit events, retention jobs, and revocable tenant credentials.</p>
        <p className="mt-4 text-sm leading-6 text-[var(--text-dim)]">To report a security issue, use the <a className="font-bold text-[var(--accent)]" href="/contact">contact channel</a> and mark the request as security-related. Do not include production secrets or customer content.</p>
      </section>
    </PublicShell>
  );
}

function SecurityFact({ icon: Icon, title, text }: { icon: typeof KeyRound; title: string; text: string }) {
  return <article className="rounded-xl border border-[var(--border)] bg-white p-5 shadow-sm"><Icon className="size-5 text-[var(--accent)]" /><h2 className="mt-4 text-sm font-bold text-[var(--text-strong)]">{title}</h2><p className="mt-2 text-xs leading-5 text-[var(--text-dim)]">{text}</p></article>;
}

function SecurityList({ title, items, danger = false }: { title: string; items: string[]; danger?: boolean }) {
  return <article className={`rounded-xl border p-6 ${danger ? "border-rose-200 bg-rose-50/50" : "border-[var(--border)] bg-white"}`}><h2 className="text-xl font-semibold text-[var(--text-strong)]">{title}</h2><ul className="mt-5 grid gap-3 text-sm leading-6 text-[var(--text-dim)]">{items.map((item) => <li key={item} className="flex items-start gap-3"><Check className={`mt-1 size-3.5 shrink-0 ${danger ? "text-rose-600" : "text-emerald-600"}`} />{item}</li>)}</ul></article>;
}
