import type { Metadata } from "next";

import { PublicPageHeading, PublicShell } from "@/components/public-shell";

export const metadata: Metadata = {
  title: "Terms · SignalOps",
  description: "SignalOps public-beta terms of use.",
};

const sections = [
  ["Public-beta service", "SignalOps is an evaluation service under active development. Features, limits, interfaces, and availability may change. Beta access is provided without a paid service-level agreement unless a separate written agreement says otherwise."],
  ["Your responsibilities", "You are responsible for your account, workspace members, server credentials, and the applications that send telemetry. Keep ingest credentials out of browser and mobile code, rotate them when exposure is suspected, and use only opaque operational identifiers."],
  ["Prohibited data", "Do not send prompts, model outputs, generated media, personal data, provider secrets, payment data, health data, raw error messages, stack traces, or any content you lack authority to process. The schema blocks many such fields, but you remain responsible for the source adapter."],
  ["Acceptable use", "Do not attempt unauthorized access, disrupt the service, evade limits, probe other tenants, distribute malware, or use SignalOps for unlawful activity. We may suspend access needed to protect the service or other users."],
  ["Customer systems and decisions", "SignalOps observes and analyzes operational telemetry. It does not automatically control customer provider routing. Simulations, SLOs, incident evidence, and recommendations require operator judgment before changes are made in customer systems."],
  ["Intellectual property", "You retain rights to your application and canonical telemetry. SignalOps retains rights to the service, contract implementation, product design, and documentation. Open-source files remain governed by the license included with those files."],
  ["No warranty", "The public beta is provided as available, without warranties to the maximum extent permitted by law. Do not rely on it as the sole system of record for billing, safety-critical decisions, or regulatory compliance."],
  ["Limitation and changes", "Liability and any special commercial terms require a separate written agreement. Material changes to these beta terms will be posted with a new effective date. Continued beta use after a change constitutes acceptance where permitted by law."],
  ["Contact", "Use the contact page for legal, security, or commercial questions. These beta terms should be reviewed by counsel before a paid general-availability launch."],
];

export default function TermsPage() {
  return (
    <PublicShell>
      <PublicPageHeading eyebrow="Effective August 24, 2026" title="Public-beta terms" description="Plain-language operating terms for evaluating SignalOps. A paid launch will require finalized entity, jurisdiction, billing, and liability provisions." />
      <article className="max-w-3xl rounded-xl border border-[var(--border)] bg-white p-7 shadow-sm sm:p-10">
        {sections.map(([title, body]) => <section key={title} className="border-b border-[var(--border)] py-6 first:pt-0 last:border-0 last:pb-0"><h2 className="text-xl font-semibold text-[var(--text-strong)]">{title}</h2><p className="mt-3 text-sm leading-7 text-[var(--text-dim)]">{body}</p></section>)}
      </article>
    </PublicShell>
  );
}
