type ProviderEscalationInput = {
  incident: {
    id: string;
    title: string;
    severity: "info" | "warning" | "critical";
  };
  provider: {
    name: string;
    region: string;
    p95Ms: number;
    failureRate: number;
  };
  affectedJobCount: number;
  guard: "latency" | "failure";
  trafficShare: number;
  decisionState: "proposed" | "simulated" | "applied";
  appliedAt?: string;
  projected: {
    movedJobs: number;
    p95Ms: number;
    failureRate: number;
  };
  canonicalUrl: string;
};

export function buildProviderEscalation({
  incident,
  provider,
  affectedJobCount,
  guard,
  trafficShare,
  decisionState,
  appliedAt,
  projected,
  canonicalUrl,
}: ProviderEscalationInput) {
  const condition = guard === "latency" ? "p95 latency" : "failure rate";
  const routingStatus =
    decisionState === "applied"
      ? `ACTIVE — we drained ${trafficShare}% of matching traffic at ${appliedAt ?? "the current snapshot time"}.`
      : decisionState === "simulated"
        ? `PREVIEW ONLY — we simulated draining ${trafficShare}% of matching traffic; no production routing change has been applied.`
        : `DRAFT ONLY — we are evaluating a ${trafficShare}% traffic drain and have not changed production routing.`;

  return [
    `Subject: [${incident.severity.toUpperCase()}] ${provider.name} assistance requested — ${incident.id}`,
    "",
    `Hello ${provider.name} support,`,
    "",
    `We are investigating ${incident.title} (${incident.id}) in ${provider.region}.`,
    `Current signal: p95 ${(provider.p95Ms / 1000).toFixed(1)}s · failure rate ${provider.failureRate.toFixed(1)}% · ${affectedJobCount} affected jobs.`,
    `Mitigation condition: ${condition}.`,
    `Routing status: ${routingStatus}`,
    `Projected after mitigation: ${projected.movedJobs} jobs moved · p95 ${(projected.p95Ms / 1000).toFixed(1)}s · failure rate ${projected.failureRate.toFixed(1)}%.`,
    "",
    "Please confirm current regional status, any known degradation, and an expected recovery window.",
    `Incident reference: ${canonicalUrl}`,
  ].join("\n");
}
