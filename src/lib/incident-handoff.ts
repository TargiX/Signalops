type IncidentHandoffInput = {
  incident: {
    id: string;
    title: string;
    severity: "info" | "warning" | "critical";
  };
  provider: {
    name: string;
    region: string;
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

const SIGNALOPS_ORIGIN = "https://signalops.ilyamoskovkin.com";

export function buildCanonicalIncidentUrl(incidentId: string) {
  return new URL(
    `/incidents/${encodeURIComponent(incidentId)}#handoff`,
    SIGNALOPS_ORIGIN,
  ).toString();
}

export function buildIncidentHandoff({
  incident,
  provider,
  affectedJobCount,
  guard,
  trafficShare,
  decisionState,
  appliedAt,
  projected,
  canonicalUrl,
}: IncidentHandoffInput) {
  const condition = guard === "latency" ? "p95 > 12s" : "failure > 5%";
  const state =
    decisionState === "applied"
      ? `ACTIVE — applied at ${appliedAt ?? "an unknown time"} in the current 24h snapshot`
      : decisionState === "simulated"
        ? "PREVIEW ONLY — no routing change has been applied"
        : "DRAFT ONLY — run the simulation before review";

  return [
    `# Incident handoff — ${incident.id}`,
    "",
    `**${incident.title}** · ${incident.severity.toUpperCase()}`,
    `Scope: ${affectedJobCount} affected jobs on ${provider.name} (${provider.region})`,
    `Decision: ${decisionState.toUpperCase()} — drain ${trafficShare}% of ${provider.name} traffic when ${condition}`,
    `Projected: ${projected.movedJobs} jobs moved · p95 ${(projected.p95Ms / 1000).toFixed(1)}s · failure rate ${projected.failureRate.toFixed(1)}%`,
    `State: ${state}`,
    `Canonical incident: ${canonicalUrl}`,
  ].join("\n");
}
