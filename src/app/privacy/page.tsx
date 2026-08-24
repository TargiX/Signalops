import type { Metadata } from "next";

import { PublicPageHeading, PublicShell } from "@/components/public-shell";

export const metadata: Metadata = {
  title: "Privacy · SignalOps",
  description: "SignalOps public-beta privacy notice.",
};

export default function PrivacyPage() {
  return (
    <PublicShell>
      <PublicPageHeading eyebrow="Effective August 24, 2026" title="Privacy notice" description="This notice explains the information SignalOps processes during the public beta and the product boundaries designed to minimize it." />
      <LegalSections sections={[
        ["Account and workspace data", "SignalOps processes authentication identifiers supplied by the configured identity provider, workspace names, memberships, roles, and credential metadata. Managed ingest secrets are displayed once and stored only as cryptographic digests plus a non-secret prefix."],
        ["Operational telemetry", "SignalOps stores canonical lifecycle events: opaque operation and attempt identifiers, timestamps, environment and service keys, provider-route metadata, normalized outcomes, bounded metrics, cost evidence, and failure taxonomy. The contract is designed to reject prompts, generated content, media, credentials, customer identities, raw errors, and arbitrary nested metadata."],
        ["Product analytics", "SignalOps uses PostHog through a first-party ingestion path to understand signup, activation, cockpit use, and product reliability. Authenticated analytics use an opaque account subject and workspace group. We do not intentionally send email addresses, prompts, media, ingest secrets, raw operation IDs, or free-form search text to product analytics. Page text and element attributes are masked for analytics collection."],
        ["Contact requests", "When you request beta access, we process the email, company, role, usage band, category, and message you submit so we can respond. Free-form contact text is delivered through the configured request channel and is not attached to product analytics."],
        ["Retention", "Production deployments configure separate retention windows for raw events, conflicts, audit records, and rate-limit data. Public-beta defaults are operational settings rather than a contractual retention commitment. Contact us before sending production telemetry if your organization requires a specific deletion schedule."],
        ["Processors and access", "SignalOps may rely on configured infrastructure providers for hosting, database and authentication, email or webhook delivery, and product analytics. Access is limited by service credentials and operator membership. Browser roles do not receive direct database grants."],
        ["Your choices", "You may stop telemetry at any time by revoking an ingest credential. You may request account or workspace deletion through the contact channel. Some audit and security records may need to be retained for a bounded period to protect the service."],
        ["Contact", "Use the SignalOps contact page for privacy questions or deletion requests. Do not send secrets or customer content in the request."],
      ]} />
    </PublicShell>
  );
}

function LegalSections({ sections }: { sections: string[][] }) {
  return <article className="max-w-3xl rounded-xl border border-[var(--border)] bg-white p-7 shadow-sm sm:p-10">{sections.map(([title, body]) => <section key={title} className="border-b border-[var(--border)] py-6 first:pt-0 last:border-0 last:pb-0"><h2 className="text-xl font-semibold text-[var(--text-strong)]">{title}</h2><p className="mt-3 text-sm leading-7 text-[var(--text-dim)]">{body}</p></section>)}</article>;
}
