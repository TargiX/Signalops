"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Copy,
  FileText,
  GitBranch,
  Loader2,
  ShieldCheck,
  SlidersHorizontal,
  Target,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { LatencyChart, ThroughputChart } from "@/components/charts";
import { GenerationTable } from "@/components/generation-table";
import {
  buildCanonicalIncidentUrl,
  buildIncidentHandoff,
} from "@/lib/incident-handoff";
import {
  fetchOpsSnapshot,
  type Generation,
  type GenerationStatus,
  type Provider,
} from "@/lib/mock-data";
import { cn, formatCurrency, formatMs, formatNumber } from "@/lib/utils";

const activeStatuses: GenerationStatus[] = [
  "failed",
  "retrying",
  "blocked",
  "running",
  "queued",
];

type Guard = "latency" | "failure";
type DecisionState = "proposed" | "simulated" | "applied";

export function IncidentDetail({ incidentId }: { incidentId: string }) {
  const [guard, setGuard] = useState<Guard>("latency");
  const [trafficShare, setTrafficShare] = useState(68);
  const [simulatedRuleKey, setSimulatedRuleKey] = useState<string | null>(null);
  const [selectedGeneration, setSelectedGeneration] =
    useState<Generation | null>(null);
  const handoffScrollHandled = useRef(false);
  const draftRuleKey = `${incidentId}:${guard}:${trafficShare}`;
  const simulated = simulatedRuleKey === draftRuleKey;

  const { data, isLoading } = useQuery({
    queryKey: ["ops-snapshot", "24h"],
    queryFn: () => fetchOpsSnapshot("24h"),
  });

  const incident = data?.incidents.find((item) => item.id === incidentId);
  const provider = data?.providers.find(
    (item) => item.id === incident?.providerId,
  );

  useEffect(() => {
    if (
      handoffScrollHandled.current ||
      !incident ||
      window.location.hash !== "#handoff"
    ) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      const handoffSection = document.getElementById("handoff");
      if (!handoffSection) {
        return;
      }

      handoffSection.scrollIntoView({ block: "start" });
      handoffScrollHandled.current = true;
    });

    return () => cancelAnimationFrame(frame);
  }, [incident]);

  const affectedJobs = useMemo(() => {
    if (!data || !provider) {
      return [];
    }

    return data.generations.filter(
      (job) =>
        job.providerId === provider.id && activeStatuses.includes(job.status),
    );
  }, [data, provider]);

  const impacted = useMemo(() => {
    if (!provider) {
      return null;
    }

    const share = trafficShare / 100;

    return {
      jobs: Math.round(provider.volume * share),
      p95: Math.round(provider.p95Ms * (1 - 0.34 * share)),
      failures: Number(
        (provider.failureRate * (1 - 0.52 * share)).toFixed(1),
      ),
      spend: Number((provider.spend * (1 - 0.18 * share)).toFixed(2)),
      saved: Number((provider.spend * 0.18 * share).toFixed(2)),
    };
  }, [provider, trafficShare]);

  if (isLoading || !data) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--background)] text-[var(--text)]">
        <div className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-5 py-4 shadow-[var(--shadow-1)]">
          <Loader2 className="size-5 animate-spin text-[var(--accent)]" />
          <span className="text-sm text-[var(--text-dim)]">
            Loading incident detail
          </span>
        </div>
      </main>
    );
  }

  if (!incident || !provider || !impacted) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--background)] px-4 text-[var(--text)]">
        <div className="max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center shadow-[var(--shadow-1)]">
          <AlertTriangle className="mx-auto size-8 text-[var(--warning)]" />
          <h1 className="mt-4 text-xl font-semibold">Incident not found</h1>
          <Link
            href="/cockpit"
            className="mt-4 inline-flex text-sm font-semibold text-[var(--accent)] hover:underline"
          >
            Back to cockpit
          </Link>
        </div>
      </main>
    );
  }

  const activeIncidentRule =
    data.activeRoutingRule?.status === "active" &&
    data.activeRoutingRule.incidentId === incident.id &&
    data.activeRoutingRule.providerId === provider.id
      ? data.activeRoutingRule
      : null;
  const decisionState: DecisionState = activeIncidentRule
    ? "applied"
    : simulated
      ? "simulated"
      : "proposed";
  const decisionGuard = activeIncidentRule?.guard ?? guard;
  const decisionTrafficShare =
    activeIncidentRule?.trafficShare ?? trafficShare;
  const decisionProjection = activeIncidentRule
    ? {
        movedJobs: activeIncidentRule.movedJobs,
        p95Ms: Math.max(900, provider.p95Ms - activeIncidentRule.p95Delta),
        failureRate: Number(
          Math.max(
            0.1,
            provider.failureRate - activeIncidentRule.failureDelta,
          ).toFixed(1),
        ),
        saved: activeIncidentRule.spendDelta,
      }
    : {
        movedJobs: impacted.jobs,
        p95Ms: impacted.p95,
        failureRate: impacted.failures,
        saved: impacted.saved,
      };
  const decisionComplete = decisionState !== "proposed";
  const timeline = buildIncidentTimeline(provider, decisionState);
  const canonicalUrl = buildCanonicalIncidentUrl(incident.id);
  const handoff = buildIncidentHandoff({
    incident,
    provider,
    affectedJobCount: affectedJobs.length,
    guard: decisionGuard,
    trafficShare: decisionTrafficShare,
    decisionState,
    appliedAt: activeIncidentRule?.appliedAt,
    projected: decisionProjection,
    canonicalUrl,
  });

  return (
    <main className="min-h-screen overflow-x-hidden bg-[var(--background)] text-[var(--text)]">
      <div className="pointer-events-none fixed inset-0 opacity-70">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(224,224,250,0.7),transparent_30%),linear-gradient(180deg,var(--background)_0%,oklch(0.965_0.006_80)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(31,34,48,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(31,34,48,0.025)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:linear-gradient(to_bottom,black,transparent_84%)]" />
      </div>

      <div className="relative mx-auto flex w-full max-w-[1480px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-1)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <Link
                href="/cockpit"
                className="inline-flex items-center gap-2 text-sm font-medium text-[var(--text-dim)] hover:text-[var(--text)]"
              >
                <ArrowLeft className="size-4" />
                Back to cockpit
              </Link>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-md px-2 py-1 text-xs font-semibold",
                    incident.severity === "critical"
                      ? "bg-[var(--danger-soft)] text-[var(--danger)]"
                      : incident.severity === "warning"
                        ? "bg-[var(--warning-soft)] text-[var(--warning)]"
                        : "bg-[var(--info-soft)] text-[var(--info)]",
                  )}
                >
                  {incident.severity}
                </span>
                <span className="rounded-md border border-[var(--border)] bg-[var(--surface-mute)] px-2 py-1 text-xs font-medium text-[var(--mute)]">
                  {incident.id}
                </span>
                <span className="text-xs font-medium text-[var(--mute)]">
                  opened {incident.age} ago
                </span>
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em]">
                {incident.title}
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-dim)]">
                {incident.detail} This route turns the dashboard signal into a
                concrete investigation: inspect affected jobs, draft a routing
                rule, and preview operational impact before applying it.
              </p>
            </div>

            <div className="grid min-w-[280px] gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-mute)] p-3 sm:grid-cols-3">
              <Stat label="provider" value={provider.name} />
              <Stat label="p95" value={formatMs(provider.p95Ms)} />
              <Stat label="affected" value={formatNumber(affectedJobs.length)} />
            </div>
          </div>
        </header>

        <section className="grid gap-4 xl:grid-cols-[0.9fr_1.25fr_1fr]">
          <Panel title="Incident Timeline" eyebrow="Event sequence">
            <div className="space-y-3">
              {timeline.map((event, index) => (
                <div
                  key={event.title}
                  className="grid grid-cols-[auto_1fr] gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
                >
                  <span
                    className={cn(
                      "grid size-7 place-items-center rounded-md text-xs font-semibold",
                      (index === timeline.length - 1 &&
                        decisionState !== "proposed")
                        ? "bg-[var(--success-soft)] text-[var(--success)]"
                        : "bg-[var(--surface-mute)] text-[var(--text-dim)]",
                    )}
                  >
                    {index + 1}
                  </span>
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-sm font-semibold">{event.title}</h2>
                      <span className="font-mono text-xs text-[var(--mute)]">
                        {event.time}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[var(--text-dim)]">
                      {event.detail}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Affected Job Scope" eyebrow="Virtualized inspection">
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="jobs" value={formatNumber(affectedJobs.length)} />
              <Stat label="failed/retry" value={formatNumber(countRiskJobs(affectedJobs))} />
              <Stat label="current p95" value={formatMs(provider.p95Ms)} />
              <Stat label="spend" value={formatCurrency(provider.spend)} />
            </div>

            <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-mute)] p-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Target className="size-4 text-[var(--accent)]" />
                Working hypothesis
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">
                {provider.name} is creating the operational tail. The highest
                risk jobs share retry pressure and long p95 latency, so the
                mitigation should move only traffic that matches the guard.
              </p>
            </div>

            {selectedGeneration ? (
              <div className="mt-4 rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] p-3">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.03em] text-[var(--accent)]">
                  <Clock3 className="size-3.5" />
                  Selected generation
                </div>
                <p className="mt-2 line-clamp-2 text-sm font-semibold">
                  {selectedGeneration.prompt}
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--text-dim)]">
                  <span>{selectedGeneration.id}</span>
                  <span>{selectedGeneration.status}</span>
                  <span>{formatMs(selectedGeneration.durationMs)}</span>
                  <span>{formatCurrency(selectedGeneration.cost)}</span>
                </div>
              </div>
            ) : null}
          </Panel>

          <Panel
            title="Routing Rule"
            eyebrow={
              activeIncidentRule
                ? "Applied routing snapshot"
                : "Draft, simulate, audit"
            }
          >
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-mute)] p-3">
              <div className="text-xs font-medium uppercase tracking-[0.03em] text-[var(--mute)]">
                Rule condition
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-sm">
                <Chip>{provider.name}</Chip>
                <Chip>
                  {decisionGuard === "latency" ? "p95 > 12s" : "failure > 5%"}
                </Chip>
                <Chip>{decisionTrafficShare}% drain</Chip>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <GuardButton
                active={decisionGuard === "latency"}
                disabled={Boolean(activeIncidentRule)}
                onClick={() => setGuard("latency")}
              >
                Latency guard
              </GuardButton>
              <GuardButton
                active={decisionGuard === "failure"}
                disabled={Boolean(activeIncidentRule)}
                onClick={() => setGuard("failure")}
              >
                Failure guard
              </GuardButton>
            </div>

            <label className="mt-4 block">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Traffic drain</span>
                <span className="font-mono text-[var(--text-dim)]">
                  {decisionTrafficShare}%
                </span>
              </div>
              <input
                min={20}
                max={90}
                value={decisionTrafficShare}
                disabled={Boolean(activeIncidentRule)}
                onChange={(event) => setTrafficShare(Number(event.target.value))}
                type="range"
                className="mt-3 w-full accent-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <Stat
                label="jobs moved"
                value={formatNumber(decisionProjection.movedJobs)}
              />
              <Stat
                label="projected p95"
                value={formatMs(decisionProjection.p95Ms)}
              />
              <Stat
                label="failure rate"
                value={`${decisionProjection.failureRate}%`}
              />
              <Stat
                label="cost saved"
                value={formatCurrency(decisionProjection.saved)}
              />
            </div>

            <button
              onClick={() => setSimulatedRuleKey(draftRuleKey)}
              disabled={decisionComplete}
              className={cn(
                "mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border text-sm font-medium shadow-[var(--shadow-1)]",
                decisionComplete
                  ? "border-[var(--border)] bg-[var(--success-soft)] text-[var(--success)]"
                  : "border-[var(--accent)] bg-[var(--accent)] [color:white] hover:bg-[var(--accent-hover)]",
              )}
            >
              {decisionComplete ? (
                <CheckCircle2 className="size-4" />
              ) : (
                <GitBranch className="size-4" />
              )}
              {activeIncidentRule
                ? "Rule applied"
                : simulated
                  ? "Impact simulated"
                  : "Simulate rule impact"}
            </button>
          </Panel>
        </section>

        <IncidentHandoff
          content={handoff}
          canonicalUrl={canonicalUrl}
          decisionState={decisionState}
        />

        <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <Panel title="Before / After" eyebrow="Mitigation preview">
            <div className="grid gap-4 lg:grid-cols-2">
              <ComparisonBars
                before={provider.p95Ms}
                after={decisionProjection.p95Ms}
                label="p95 latency"
                format={formatMs}
                hasDecisionImpact={decisionComplete}
              />
              <ComparisonBars
                before={provider.failureRate}
                after={decisionProjection.failureRate}
                label="failure rate"
                format={(value) => `${value.toFixed(1)}%`}
                hasDecisionImpact={decisionComplete}
              />
            </div>
          </Panel>

          <Panel title="Review Trail" eyebrow="Operational audit">
            <div className="space-y-3">
              {[
                ["Incident opened", `${incident.title} assigned to provider ops.`],
                ["Affected scope calculated", `${affectedJobs.length} risky jobs matched the guard.`],
                [
                  decisionState === "applied"
                    ? "Routing rule applied"
                    : decisionState === "simulated"
                      ? "Impact simulated"
                      : "Rule draft pending",
                  decisionState === "applied"
                    ? `${decisionProjection.movedJobs} jobs are routed away from ${provider.name} in the current snapshot.`
                    : decisionState === "simulated"
                      ? `${impacted.jobs} jobs would be moved from ${provider.name}.`
                      : "Run the simulation to produce a reviewable audit event.",
                ],
              ].map(([title, detail], index) => (
                <div
                  key={title}
                  className="grid grid-cols-[auto_1fr] gap-3 rounded-lg border border-[var(--border)] p-3"
                >
                  <span className="grid size-7 place-items-center rounded-md bg-[var(--success-soft)] text-[var(--success)]">
                    {index === 2 && decisionState === "proposed" ? (
                      <SlidersHorizontal className="size-3.5" />
                    ) : (
                      <ShieldCheck className="size-3.5" />
                    )}
                  </span>
                  <div>
                    <div className="text-sm font-semibold">{title}</div>
                    <p className="mt-1 text-xs leading-5 text-[var(--text-dim)]">
                      {detail}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.35fr_0.9fr]">
          <Panel title="Throughput During Incident" eyebrow="Volume and failures">
            <ThroughputChart data={data.timeline} />
          </Panel>
          <Panel title="Latency During Incident" eyebrow="p95 by hour">
            <LatencyChart data={data.timeline} />
          </Panel>
        </section>

        <GenerationTable
          rows={affectedJobs}
          providers={data.providers}
          models={data.models}
          selectedRowId={selectedGeneration?.id}
          onRowSelect={setSelectedGeneration}
          subtitle={`${affectedJobs.length} affected jobs scoped to ${provider.name}; virtualized for investigation.`}
        />
      </div>
    </main>
  );
}

function IncidentHandoff({
  content,
  canonicalUrl,
  decisionState,
}: {
  content: string;
  canonicalUrl: string;
  decisionState: DecisionState;
}) {
  const [copyState, setCopyState] = useState<{
    status: "idle" | "copied" | "failed";
    content: string;
  }>({ status: "idle", content });
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyAttempt = useRef(0);
  const visibleCopyState =
    copyState.content === content ? copyState.status : "idle";

  useEffect(() => {
    return () => {
      copyAttempt.current += 1;
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
      }
    };
  }, []);

  async function copyHandoff() {
    const attempt = ++copyAttempt.current;
    const copiedContent = content;

    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }
    setCopyState({ status: "idle", content: copiedContent });

    try {
      await navigator.clipboard.writeText(copiedContent);

      if (copyAttempt.current !== attempt) {
        return;
      }

      setCopyState({ status: "copied", content: copiedContent });
    } catch {
      if (copyAttempt.current !== attempt) {
        return;
      }

      setCopyState({ status: "failed", content: copiedContent });
    }

    resetTimer.current = setTimeout(() => {
      if (copyAttempt.current === attempt) {
        setCopyState({ status: "idle", content: copiedContent });
      }
    }, 2200);
  }

  return (
    <section
      id="handoff"
      aria-labelledby="handoff-title"
      className="scroll-mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-1)]"
    >
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:items-start">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.03em] text-[var(--mute)]">
            <FileText className="size-3.5" />
            Operator handoff
          </div>
          <h2
            id="handoff-title"
            className="mt-2 text-xl font-semibold tracking-[-0.02em]"
          >
            Decision, scope, canonical incident
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--text-dim)]">
            A deterministic incident brief from the loaded snapshot and the
            state above. It separates draft, previewed, and applied routing
            decisions without inventing production state.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={copyHandoff}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[var(--accent)] bg-[var(--accent)] px-4 text-sm font-semibold text-white shadow-[var(--shadow-1)] transition-colors hover:bg-[var(--accent-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] focus-visible:outline-none"
            >
              <Copy className="size-4" />
              Copy handoff
            </button>
            <span
              role="status"
              aria-live="polite"
              className={cn(
                "text-xs font-medium",
                visibleCopyState === "failed"
                  ? "text-[var(--danger)]"
                  : "text-[var(--success)]",
              )}
            >
              {visibleCopyState === "copied"
                ? "Copied to clipboard"
                : visibleCopyState === "failed"
                  ? "Clipboard unavailable"
                  : ""}
            </span>
          </div>
          <a
            href={canonicalUrl}
            className="mt-3 inline-flex break-all text-xs font-semibold text-[var(--accent)] underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] focus-visible:outline-none"
          >
            {canonicalUrl}
          </a>
        </div>

        <div className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface-mute)] p-3 sm:p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--mute)]">
              Markdown · ready to paste
            </span>
            <span
              data-handoff-status={decisionState}
              className={cn(
                "rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.04em]",
                decisionState === "applied"
                  ? "bg-[var(--info-soft)] text-[var(--info)]"
                  : decisionState === "simulated"
                  ? "bg-[var(--success-soft)] text-[var(--success)]"
                  : "bg-[var(--warning-soft)] text-[var(--warning)]",
              )}
            >
              {decisionState === "applied"
                ? "applied · current snapshot"
                : decisionState === "simulated"
                  ? "simulated · not applied"
                  : "proposed"}
            </span>
          </div>
          <pre className="max-w-full whitespace-pre-wrap break-words font-mono text-[12px] leading-6 text-[var(--text-dim)] [overflow-wrap:anywhere]">
            {content}
          </pre>
        </div>
      </div>
    </section>
  );
}

function Panel({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-1)]">
      <p className="text-[11px] font-medium uppercase tracking-[0.03em] text-[var(--mute)]">
        {eyebrow}
      </p>
      <h2 className="mt-1 text-[17px] font-semibold tracking-[-0.015em]">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="text-[10px] font-medium uppercase tracking-[0.03em] text-[var(--mute)]">
        {label}
      </div>
      <div className="mt-2 text-lg font-semibold tracking-[-0.015em] [font-variant-numeric:tabular-nums]">
        {value}
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-medium">
      {children}
    </span>
  );
}

function GuardButton({
  active,
  children,
  disabled,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60",
        active
          ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
          : "border-[var(--border)] text-[var(--text-dim)]",
      )}
    >
      {children}
    </button>
  );
}

function ComparisonBars({
  before,
  after,
  label,
  format,
  hasDecisionImpact,
}: {
  before: number;
  after: number;
  label: string;
  format: (value: number) => string;
  hasDecisionImpact: boolean;
}) {
  const max = Math.max(before, after, 1);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-mute)] p-4">
      <div className="text-sm font-semibold">{label}</div>
      <div className="mt-4 space-y-3">
        {[
          ["before", before, "bg-[var(--warning)]"],
          [
            "after",
            hasDecisionImpact ? after : before,
            "bg-[var(--success)]",
          ],
        ].map(([name, value, color]) => (
          <div key={name as string}>
            <div className="mb-1 flex justify-between text-xs text-[var(--text-dim)]">
              <span>{name}</span>
              <span className="font-mono">{format(value as number)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--surface)]">
              <div
                className={cn("h-full rounded-full", color as string)}
                style={{ width: `${((value as number) / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function countRiskJobs(jobs: Generation[]) {
  return jobs.filter((job) =>
    ["failed", "retrying", "blocked"].includes(job.status),
  ).length;
}

function buildIncidentTimeline(
  provider: Provider,
  decisionState: DecisionState,
) {
  return [
    {
      time: "T-42m",
      title: "Latency tail opens",
      detail: `${provider.name} p95 begins drifting above the normal routing band.`,
    },
    {
      time: "T-28m",
      title: "Retry pressure detected",
      detail: "The virtualized queue shows concentrated retry and blocked jobs.",
    },
    {
      time: "T-18m",
      title: "Incident promoted",
      detail: "Provider ops marks the cluster as actionable and scopes affected jobs.",
    },
    {
      time:
        decisionState === "applied"
          ? "active"
          : decisionState === "simulated"
            ? "now"
            : "draft",
      title:
        decisionState === "applied"
          ? "Mitigation applied"
          : decisionState === "simulated"
            ? "Mitigation previewed"
            : "Routing rule drafted",
      detail:
        decisionState === "applied"
          ? "The current snapshot reports this routing rule as active."
          : decisionState === "simulated"
            ? "The routing rule has projected impact and is ready for review."
            : "A guard can be simulated before any production routing change.",
    },
  ];
}
