import type { Metadata } from "next";

import { PublicPageHeading, PublicShell } from "@/components/public-shell";
import { ServiceStatus } from "@/components/service-status";

export const metadata: Metadata = {
  title: "Status · SignalOps",
  description: "Live SignalOps deployment readiness checks.",
};

export default function StatusPage() {
  return (
    <PublicShell>
      <PublicPageHeading eyebrow="Live deployment evidence" title="Service status" description="A direct view of storage, identity, ingest, incident delivery, public onboarding, and beta-request delivery. Public beta does not yet include a contractual uptime SLA." />
      <ServiceStatus />
    </PublicShell>
  );
}
