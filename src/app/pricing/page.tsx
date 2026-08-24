import type { Metadata } from "next";
import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";

import { PublicPageHeading, PublicShell } from "@/components/public-shell";

export const metadata: Metadata = {
  title: "Pricing · SignalOps",
  description: "Transparent SignalOps public-beta access and future plan principles.",
};

export default function PricingPage() {
  return (
    <PublicShell>
      <PublicPageHeading eyebrow="Transparent public beta" title="Start free. Prove value before pricing complexity." description="SignalOps does not require a credit card during public beta. We will publish paid limits and give beta users advance notice before any billing begins." />
      <section className="grid gap-5 lg:grid-cols-2">
        <Plan name="Public beta" price="$0" note="while the product is in beta" cta="Create a workspace" href="/onboarding" featured items={["One isolated workspace", "Owner-managed, revocable ingest keys", "Canonical operation and provider-attempt telemetry", "Live cockpit, SLOs, incidents, exports, and saved views", "Raw HTTP integration and Node producer source", "Fair-use ingestion and best-effort beta support"]} />
        <Plan name="Design partner" price="Custom" note="for high-volume or migration support" cta="Talk to us" href="/contact" items={["Everything in public beta", "Adapter and lifecycle-seam review", "Volume and retention planning", "Provider-route taxonomy review", "Migration and backfill safety plan", "Direct launch and incident-response channel"]} />
      </section>
      <section className="mt-12 rounded-xl border border-[var(--border)] bg-white p-7 shadow-sm">
        <h2 className="text-xl font-semibold text-[var(--text-strong)]">What future pricing should align with</h2>
        <div className="mt-5 grid gap-5 text-sm leading-6 text-[var(--text-dim)] sm:grid-cols-3">
          <p><strong className="block text-[var(--text-strong)]">Accepted operations</strong>Not seats, dashboards, or arbitrary provider count.</p>
          <p><strong className="block text-[var(--text-strong)]">Retention and service level</strong>Clear storage windows and operational commitments.</p>
          <p><strong className="block text-[var(--text-strong)]">No surprise telemetry tax</strong>Validation failures and duplicate retries should not become hidden billable usage.</p>
        </div>
      </section>
    </PublicShell>
  );
}

function Plan({ name, price, note, cta, href, items, featured = false }: { name: string; price: string; note: string; cta: string; href: string; items: string[]; featured?: boolean }) {
  return <article className={`rounded-2xl border p-7 shadow-sm sm:p-8 ${featured ? "border-[var(--accent)] bg-[linear-gradient(145deg,#ffffff,#f2f6ff)] ring-4 ring-[var(--accent-soft)]" : "border-[var(--border)] bg-white"}`}><p className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--accent)]">{name}</p><p className="mt-5 text-5xl font-semibold tracking-tight text-[var(--text-strong)]">{price}</p><p className="mt-2 text-xs text-[var(--mute)]">{note}</p><ul className="mt-7 grid gap-3 text-sm leading-6 text-[var(--text-dim)]">{items.map((item) => <li key={item} className="flex items-start gap-3"><Check className="mt-1 size-3.5 shrink-0 text-emerald-600" />{item}</li>)}</ul><Link href={href} className={`mt-8 inline-flex h-11 items-center gap-2 rounded-lg px-4 text-sm font-bold ${featured ? "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]" : "border border-[var(--border)] bg-white text-[var(--text-strong)] hover:border-[var(--accent)] hover:text-[var(--accent)]"}`}>{cta}<ArrowRight className="size-4" /></Link></article>;
}
