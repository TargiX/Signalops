import type { Metadata } from "next";

import { ContactForm } from "@/components/contact-form";
import { PublicPageHeading, PublicShell } from "@/components/public-shell";

export const metadata: Metadata = {
  title: "Contact · SignalOps",
  description: "Request SignalOps beta access, adapter review, or design-partner support.",
};

export default function ContactPage() {
  const fallbackEmail = process.env.NEXT_PUBLIC_SIGNALOPS_PILOT_FALLBACK_EMAIL?.trim();
  return (
    <PublicShell>
      <PublicPageHeading eyebrow="Talk to the builders" title="Bring the lifecycle seams. We will bring the operating model." description="Tell us what your application generates, how provider attempts and retries work, and what decision you cannot make today. We will respond with fit, risks, and the shortest integration path." />
      <section className="grid gap-8 lg:grid-cols-[0.65fr_1.35fr] lg:items-start">
        <aside className="rounded-xl border border-[var(--border)] bg-[var(--surface-mute)] p-6">
          <h2 className="text-lg font-semibold text-[var(--text-strong)]">Useful context</h2>
          <ul className="mt-5 grid gap-4 text-sm leading-6 text-[var(--text-dim)]">
            <li><strong className="block text-[var(--text-strong)]">Operation lifecycle</strong>Where work becomes durable and where it becomes terminal.</li>
            <li><strong className="block text-[var(--text-strong)]">Provider lifecycle</strong>Where retries, fallbacks, probes, and exact upstream models are known.</li>
            <li><strong className="block text-[var(--text-strong)]">Current blind spot</strong>Reliability, latency, cost, classification, or incident response.</li>
            <li><strong className="block text-[var(--text-strong)]">Scale</strong>Approximate operations per month and retention needs.</li>
          </ul>
          <p className="mt-6 text-xs leading-5 text-[var(--mute)]">Do not submit API keys, prompts, media, raw errors, or customer data.</p>
        </aside>
        <ContactForm fallbackEmail={fallbackEmail} />
      </section>
    </PublicShell>
  );
}
