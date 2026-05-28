"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Cpu,
  Download,
  Gauge,
  GitBranch,
  Loader2,
  RefreshCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { LatencyChart, ThroughputChart } from "@/components/charts";
import { GenerationTable } from "@/components/generation-table";
import { KpiCard } from "@/components/kpi-card";
import {
  fetchOpsSnapshot,
  type Generation,
  type GenerationStatus,
  type Incident,
  type Model,
  type Provider,
  type ProviderId,
} from "@/lib/mock-data";
import { cn, formatCurrency, formatMs, formatNumber } from "@/lib/utils";

const ranges = ["24h", "7d", "30d"] as const;
type Range = (typeof ranges)[number];
type ProviderView = "table" | "risk";
type ModelView = "matrix" | "ranked";
type SavedView = "ops" | "triage" | "cost";
type TriggerMode = "latency" | "failure";

const activeStatuses: GenerationStatus[] = [
  "failed",
  "retrying",
  "blocked",
  "running",
  "queued",
];

const savedViews: Array<{
  id: SavedView;
  name: string;
  detail: string;
}> = [
  {
    id: "ops",
    name: "Ops overview",
    detail: "All providers, live queue, SLO watch",
  },
  {
    id: "triage",
    name: "Provider triage",
    detail: "Incident scope and affected jobs",
  },
  {
    id: "cost",
    name: "Cost review",
    detail: "Spend, retries, heavy users",
  },
];

const providerStatusStyle: Record<Provider["status"], string> = {
  healthy: "bg-[var(--success-soft)] text-[var(--success)]",
  degraded: "bg-[var(--warning-soft)] text-[var(--warning)]",
  incident: "bg-[var(--danger-soft)] text-[var(--danger)]",
};

const severityStyle = {
  info: "bg-[var(--info-soft)] text-[var(--info)]",
  warning: "bg-[var(--warning-soft)] text-[var(--warning)]",
  critical: "bg-[var(--danger-soft)] text-[var(--danger)]",
};

const exportColumns = [
  "section",
  "range",
  "routing_applied",
  "saved_view",
  "generated_at",
  "metric",
  "value",
  "provider_id",
  "provider_name",
  "provider_status",
  "region",
  "p95_ms",
  "failure_rate",
  "spend_usd",
  "volume",
  "incident_id",
  "incident_title",
  "severity",
  "age",
  "job_id",
  "user",
  "model_id",
  "source",
  "status",
  "duration_ms",
  "cost",
  "retry_count",
  "detail",
] as const;

type CsvValue = string | number | boolean | null | undefined;
type CsvRow = Partial<Record<(typeof exportColumns)[number], CsvValue>>;

function escapeCsvValue(value: CsvValue) {
  const rawText = value == null ? "" : String(value);
  const text = /^[=+\-@\t\r]/.test(rawText) ? `'${rawText}` : rawText;

  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

function buildCsv(rows: CsvRow[]) {
  return [
    exportColumns.join(","),
    ...rows.map((row) =>
      exportColumns.map((column) => escapeCsvValue(row[column])).join(","),
    ),
  ].join("\r\n");
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function Dashboard() {
  const [range, setRange] = useState<Range>("24h");
  const [providerView, setProviderView] = useState<ProviderView>("risk");
  const [modelView, setModelView] = useState<ModelView>("matrix");
  const [routingApplied, setRoutingApplied] = useState(false);
  const [savedView, setSavedView] = useState<SavedView>("ops");
  const [selectedIncidentId, setSelectedIncidentId] = useState("inc_411");
  const [queueFocusProviderId, setQueueFocusProviderId] = useState<
    ProviderId | "all"
  >("all");
  const [queueFocusStatus, setQueueFocusStatus] = useState<
    GenerationStatus | "all"
  >("all");
  const [triggerMode, setTriggerMode] = useState<TriggerMode>("latency");
  const [trafficShare, setTrafficShare] = useState(68);
  const [selectedGeneration, setSelectedGeneration] =
    useState<Generation | null>(null);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["ops-snapshot", range],
    queryFn: () => fetchOpsSnapshot(range),
  });

  const effectiveProviders = useMemo(() => {
    if (!data || !routingApplied) {
      return data?.providers ?? [];
    }

    return data.providers.map((provider) => {
      if (provider.id === "alibaba") {
        return {
          ...provider,
          status: "degraded" as const,
          p95Ms: Math.round(provider.p95Ms * 0.62),
          failureRate: Number((provider.failureRate * 0.42).toFixed(1)),
          spend: Number((provider.spend * 0.74).toFixed(2)),
        };
      }

      if (provider.id === "fal") {
        return {
          ...provider,
          p95Ms: Math.round(provider.p95Ms * 0.78),
          failureRate: Number((provider.failureRate * 0.55).toFixed(1)),
          spend: Number((provider.spend * 0.86).toFixed(2)),
        };
      }

      if (provider.id === "google") {
        return {
          ...provider,
          volume: Math.round(provider.volume * 1.18),
        };
      }

      return provider;
    });
  }, [data, routingApplied]);

  const effectiveTimeline = useMemo(() => {
    if (!data || !routingApplied) {
      return data?.timeline ?? [];
    }

    return data.timeline.map((bucket, index) => ({
      ...bucket,
      failures: Math.max(1, Math.round(bucket.failures * 0.48)),
      latency: Math.round(bucket.latency * (index > 16 ? 0.78 : 0.92)),
      spend: Number((bucket.spend * 0.88).toFixed(2)),
    }));
  }, [data, routingApplied]);

  const metrics = useMemo(() => {
    if (!data) {
      return null;
    }

    const totalVolume = data.generations.length;
    const totalProviderVolume = effectiveProviders.reduce(
      (sum, provider) => sum + provider.volume,
      0,
    );
    const totalSpend = effectiveProviders.reduce(
      (sum, provider) => sum + provider.spend,
      0,
    );
    const weightedFailure =
      effectiveProviders.reduce(
        (sum, provider) => sum + provider.failureRate * provider.volume,
        0,
      ) / Math.max(totalProviderVolume, 1);
    const weightedP95 =
      effectiveProviders.reduce(
        (sum, provider) => sum + provider.p95Ms * provider.volume,
        0,
      ) / Math.max(totalProviderVolume, 1);
    const activeJobs = data.generations.filter((job) =>
      ["queued", "running", "retrying"].includes(job.status),
    ).length;

    return {
      totalVolume,
      totalSpend,
      weightedFailure,
      weightedP95,
      activeJobs,
    };
  }, [data, effectiveProviders]);

  const selectedIncident = useMemo(() => {
    if (!data) {
      return null;
    }

    return (
      data.incidents.find((incident) => incident.id === selectedIncidentId) ??
      data.incidents[0]
    );
  }, [data, selectedIncidentId]);

  const selectedProvider = useMemo(() => {
    if (!selectedIncident) {
      return null;
    }

    return (
      effectiveProviders.find(
        (provider) => provider.id === selectedIncident.providerId,
      ) ?? null
    );
  }, [effectiveProviders, selectedIncident]);

  const affectedJobs = useMemo(() => {
    if (!data || !selectedProvider) {
      return [];
    }

    return data.generations.filter(
      (job) =>
        job.providerId === selectedProvider.id &&
        activeStatuses.includes(job.status),
    );
  }, [data, selectedProvider]);

  const ruleImpact = useMemo(() => {
    if (!selectedProvider) {
      return {
        jobs: 0,
        p95Delta: 0,
        failureDelta: 0,
        spendDelta: 0,
      };
    }

    const share = trafficShare / 100;

    return {
      jobs: Math.round(selectedProvider.volume * share),
      p95Delta: Math.round(selectedProvider.p95Ms * 0.34 * share),
      failureDelta: Number((selectedProvider.failureRate * 0.52 * share).toFixed(1)),
      spendDelta: Number((selectedProvider.spend * 0.18 * share).toFixed(2)),
    };
  }, [selectedProvider, trafficShare]);

  function activateSavedView(view: SavedView) {
    setSavedView(view);

    if (view === "ops") {
      setQueueFocusProviderId("all");
      setQueueFocusStatus("all");
      setProviderView("risk");
      setModelView("matrix");
    }

    if (view === "triage") {
      setQueueFocusProviderId(selectedIncident?.providerId ?? "all");
      setQueueFocusStatus("all");
      setProviderView("risk");
      setModelView("ranked");
    }

    if (view === "cost") {
      setQueueFocusProviderId("all");
      setQueueFocusStatus("retrying");
      setProviderView("table");
      setModelView("matrix");
    }
  }

  function handleExport() {
    if (!data || !metrics) {
      return;
    }

    const snapshotRows: CsvRow[] = [
      {
        section: "snapshot",
        range,
        routing_applied: routingApplied,
        saved_view: savedView,
        generated_at: data.generatedAt,
        metric: "generated_at",
        value: data.generatedAt,
        detail: "Current visible SignalOps dashboard snapshot",
      },
      {
        section: "snapshot",
        range,
        routing_applied: routingApplied,
        saved_view: savedView,
        generated_at: data.generatedAt,
        metric: "total_generations",
        value: metrics.totalVolume,
      },
      {
        section: "snapshot",
        range,
        routing_applied: routingApplied,
        saved_view: savedView,
        generated_at: data.generatedAt,
        metric: "provider_spend_usd",
        value: metrics.totalSpend,
      },
      {
        section: "snapshot",
        range,
        routing_applied: routingApplied,
        saved_view: savedView,
        generated_at: data.generatedAt,
        metric: "weighted_failure_rate",
        value: Number(metrics.weightedFailure.toFixed(2)),
      },
      {
        section: "snapshot",
        range,
        routing_applied: routingApplied,
        saved_view: savedView,
        generated_at: data.generatedAt,
        metric: "weighted_p95_ms",
        value: Math.round(metrics.weightedP95),
      },
      {
        section: "snapshot",
        range,
        routing_applied: routingApplied,
        saved_view: savedView,
        generated_at: data.generatedAt,
        metric: "active_jobs",
        value: metrics.activeJobs,
      },
      ...effectiveProviders.map((provider) => ({
        section: "provider",
        range,
        routing_applied: routingApplied,
        saved_view: savedView,
        generated_at: data.generatedAt,
        provider_id: provider.id,
        provider_name: provider.name,
        provider_status: provider.status,
        region: provider.region,
        p95_ms: provider.p95Ms,
        failure_rate: provider.failureRate,
        spend_usd: provider.spend,
        volume: provider.volume,
      })),
      ...data.incidents.map((incident) => {
        const provider = effectiveProviders.find(
          (item) => item.id === incident.providerId,
        );

        return {
          section: "incident",
          range,
          routing_applied: routingApplied,
          saved_view: savedView,
          generated_at: data.generatedAt,
          provider_id: incident.providerId,
          provider_name: provider?.name,
          provider_status: provider?.status,
          incident_id: incident.id,
          incident_title: incident.title,
          severity: incident.severity,
          age: incident.age,
          detail: incident.detail,
        };
      }),
      ...affectedJobs.map((job) => {
        const provider = effectiveProviders.find(
          (item) => item.id === job.providerId,
        );

        return {
          section: "affected_job",
          range,
          routing_applied: routingApplied,
          saved_view: savedView,
          generated_at: data.generatedAt,
          provider_id: job.providerId,
          provider_name: provider?.name,
          provider_status: provider?.status,
          status: job.status,
          incident_id: selectedIncident?.id,
          incident_title: selectedIncident?.title,
          severity: selectedIncident?.severity,
          job_id: job.id,
          user: job.user,
          model_id: job.modelId,
          source: job.source,
          duration_ms: job.durationMs,
          cost: job.cost,
          retry_count: job.retryCount,
          detail: job.prompt,
        };
      }),
    ];

    const timestamp = new Date(data.generatedAt)
      .toISOString()
      .replaceAll(":", "-")
      .replace(/\.\d{3}Z$/, "Z");

    downloadCsv(`signalops-${range}-${timestamp}.csv`, buildCsv(snapshotRows));
  }

  if (isLoading || !data || !metrics) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--background)] text-[var(--text)]">
        <div className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-5 py-4 shadow-[var(--shadow-1)]">
          <Loader2 className="size-5 animate-spin text-[var(--accent)]" />
          <span className="text-sm text-[var(--text-dim)]">Hydrating ops snapshot</span>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[var(--background)] text-[var(--text)]">
      <div className="pointer-events-none fixed inset-0 opacity-70">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(224,224,250,0.78),transparent_28%),linear-gradient(180deg,var(--background)_0%,oklch(0.965_0.006_80)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(31,34,48,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(31,34,48,0.025)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:linear-gradient(to_bottom,black,transparent_84%)]" />
      </div>

      <div className="relative mx-auto flex w-full max-w-[1480px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex min-w-0 flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-1)] lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
              <Activity className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[var(--text)]">SignalOps</h1>
                <span className="hidden rounded-md border border-[var(--border)] bg-[var(--surface-mute)] px-2 py-1 text-[11px] font-medium uppercase tracking-[0.03em] text-[var(--mute)] sm:inline-block">
                  AI Generation Control Plane
                </span>
              </div>
              <p className="mt-1 max-w-2xl text-sm text-[var(--text-dim)]">
                Provider reliability, queue pressure, spend leakage, and model
                performance for image-generation products.
              </p>
              {routingApplied ? (
                <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-[var(--success-soft)] px-3 py-1 text-[12.5px] font-medium text-[var(--success)]">
                  <span className="size-1.5 rounded-full bg-[var(--success)]" />
                  Routing rule active: risky jobs drained from Alibaba and fal.ai.
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid w-full min-w-0 grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
            <div className="col-span-2 flex min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface-mute)] p-1 sm:col-span-1">
              {ranges.map((item) => (
                <button
                  key={item}
                  onClick={() => setRange(item)}
                  className={cn(
                    "h-8 min-w-0 flex-1 rounded-md px-2 text-[12.5px] font-medium text-[var(--mute)] transition-colors sm:flex-none sm:px-3",
                    range === item && "bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-1)]",
                  )}
                >
                  {item}
                </button>
              ))}
            </div>
            <button className="inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-[13px] font-medium text-[var(--text)] shadow-[var(--shadow-1)] hover:bg-[var(--surface-mute)]">
              <RefreshCcw className={cn("size-4", isFetching && "animate-spin")} />
              Refresh
            </button>
            <button
              onClick={handleExport}
              className="inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-[13px] font-medium text-[var(--text)] shadow-[var(--shadow-1)] hover:bg-[var(--surface-mute)]"
            >
              <Download className="size-4" />
              Export
            </button>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            title="Generations"
            value={formatNumber(metrics.totalVolume)}
            delta="+18.4% over previous window"
            icon={Sparkles}
            tone="good"
          />
          <KpiCard
            title="Provider Spend"
            value={formatCurrency(metrics.totalSpend)}
            delta="Cost per success down 6.2%"
            icon={CircleDollarSign}
            tone="neutral"
          />
          <KpiCard
            title="P95 Latency"
            value={formatMs(metrics.weightedP95)}
            delta="Alibaba + fal.ai driving tail"
            icon={Gauge}
            tone="warn"
          />
          <KpiCard
            title="Active Queue"
            value={formatNumber(metrics.activeJobs)}
            delta={`${metrics.weightedFailure.toFixed(1)}% weighted failure rate`}
            icon={Zap}
            tone={metrics.weightedFailure > 5 ? "bad" : "neutral"}
          />
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.35fr_0.9fr]">
          <Panel
            title="Throughput"
            eyebrow="Volume vs failures"
            action={routingApplied ? "Rule applied" : "Alert threshold: 8%"}
          >
            <ThroughputChart data={effectiveTimeline} />
          </Panel>
          <Panel title="Latency Tail" eyebrow="p95 by hour" action={routingApplied ? "Tail reduced" : "SLO: 12s"}>
            <LatencyChart data={effectiveTimeline} />
          </Panel>
        </section>

        <SavedViewBar
          activeView={savedView}
          onSelect={activateSavedView}
        />

        {selectedIncident && selectedProvider ? (
          <InvestigationWorkbench
            affectedJobs={affectedJobs}
            incidents={data.incidents}
            onApplyRule={() => setRoutingApplied(true)}
            onFocusQueue={() => {
              setSavedView("triage");
              setQueueFocusProviderId(selectedProvider.id);
              setQueueFocusStatus("all");
            }}
            onIncidentSelect={(incidentId) => {
              const incident = data.incidents.find(
                (item) => item.id === incidentId,
              );

              setSelectedIncidentId(incidentId);
              setSelectedGeneration(null);
              if (savedView === "triage" && incident) {
                setQueueFocusProviderId(incident.providerId);
              }
            }}
            onJobSelect={setSelectedGeneration}
            provider={selectedProvider}
            routingApplied={routingApplied}
            ruleImpact={ruleImpact}
            selectedGeneration={selectedGeneration}
            selectedIncident={selectedIncident}
            trafficShare={trafficShare}
            triggerMode={triggerMode}
            onTrafficShareChange={setTrafficShare}
            onTriggerModeChange={setTriggerMode}
          />
        ) : null}

        <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr_0.9fr]">
          <Panel
            title="Provider Health"
            eyebrow="Live routing inputs"
            action={
              <ToggleGroup
                options={["risk", "table"]}
                value={providerView}
                onChange={(value) => setProviderView(value as ProviderView)}
              />
            }
          >
            {providerView === "risk" ? (
              <ProviderRiskMap providers={effectiveProviders} />
            ) : (
              <ProviderTable providers={effectiveProviders} />
            )}
          </Panel>

          <Panel
            title="Model Matrix"
            eyebrow="Speed, cost, success"
            action={
              <ToggleGroup
                options={["matrix", "ranked"]}
                value={modelView}
                onChange={(value) => setModelView(value as ModelView)}
              />
            }
          >
            {modelView === "matrix" ? (
              <ModelMatrix models={data.models} providers={data.providers} />
            ) : (
              <ModelRankedList models={data.models} providers={data.providers} />
            )}
          </Panel>

          <Panel title="Incident Feed" eyebrow="Routing recommendations">
            <div className="space-y-3">
              {data.incidents.map((incident) => (
                <Link
                  key={incident.id}
                  href={`/incidents/${incident.id}`}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex gap-3">
                      <span className="grid size-6 shrink-0 place-items-center rounded-md bg-[var(--warning-soft)] text-[var(--warning)]">
                        <AlertTriangle className="size-3.5" />
                      </span>
                      <div>
                        <h3 className="text-[13.5px] font-semibold text-[var(--text)]">
                          {incident.title}
                        </h3>
                        <p className="mt-1 text-xs leading-5 text-[var(--text-dim)]">
                          {incident.detail}
                        </p>
                      </div>
                    </div>
                    <span
                      className={cn(
                        "rounded-md px-2 py-1 text-xs font-medium",
                        severityStyle[incident.severity],
                      )}
                    >
                      {incident.age}
                    </span>
                  </div>
                </Link>
              ))}
              <button
                onClick={() => setRoutingApplied(true)}
                disabled={routingApplied}
                className={cn(
                  "inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[var(--border)] text-sm font-medium shadow-[var(--shadow-1)]",
                  routingApplied
                    ? "bg-[var(--success-soft)] text-[var(--success)]"
                    : "bg-[var(--accent)] [color:white] hover:bg-[var(--accent-hover)]",
                )}
              >
                <GitBranch className="size-4" />
                {routingApplied ? "Routing rule active" : "Apply routing rule"}
              </button>
            </div>
          </Panel>
        </section>

        <section className="grid gap-4 xl:grid-cols-[0.85fr_1.45fr]">
          <Panel title="Top Consumers" eyebrow="Credit burn and reliability">
            <div className="space-y-3">
              {data.consumers.map((consumer, index) => (
                <div
                  key={consumer.id}
                  className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
                >
                  <div className="grid size-9 place-items-center rounded-md border border-[var(--border)] bg-[var(--surface-mute)] font-mono text-sm font-semibold text-[var(--text)]">
                    {index + 1}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--text)]">
                      {consumer.name}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-[var(--mute)]">
                      <span>{consumer.plan}</span>
                      <span>{formatNumber(consumer.generations)} generations</span>
                      <span>{consumer.failureRate}% fail</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-[var(--text)]">
                      {formatCurrency(consumer.spend)}
                    </div>
                    <div className="text-xs text-[var(--mute)]">
                      {formatNumber(consumer.credits)} credits
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <section className="grid gap-4 md:grid-cols-3">
            <MiniBrief
              icon={ShieldCheck}
              title="SLO Guard"
              value="98.1%"
              text="Success rate stays acceptable, but Alibaba should be drained."
            />
            <MiniBrief
              icon={Cpu}
              title="Model Router"
              value="2 rules"
              text="Move photo-me traffic to Nano Banana 2 until fal.ai recovers."
            />
            <MiniBrief
              icon={ArrowUpRight}
              title="Revenue Signal"
              value="+14%"
              text="Studio users are driving high-intent template runs."
            />
          </section>
        </section>

        <GenerationTable
          rows={data.generations}
          providers={data.providers}
          models={data.models}
          focusProviderId={queueFocusProviderId}
          focusStatus={queueFocusStatus}
          selectedRowId={selectedGeneration?.id}
          onRowSelect={setSelectedGeneration}
        />
      </div>
    </main>
  );
}

function SavedViewBar({
  activeView,
  onSelect,
}: {
  activeView: SavedView;
  onSelect: (view: SavedView) => void;
}) {
  return (
    <section className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-1)] md:grid-cols-3">
      {savedViews.map((view) => (
        <button
          key={view.id}
          onClick={() => onSelect(view.id)}
          className={cn(
            "rounded-lg border p-3 text-left transition-colors",
            activeView === view.id
              ? "border-[var(--accent)] bg-[var(--accent-soft)]"
              : "border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-mute)]",
          )}
        >
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "grid size-6 place-items-center rounded-md text-xs font-semibold",
                activeView === view.id
                  ? "bg-[var(--accent)] [color:white]"
                  : "bg-[var(--surface-mute)] text-[var(--mute)]",
              )}
            >
              {view.id === "ops" ? "1" : view.id === "triage" ? "2" : "3"}
            </span>
            <span className="text-sm font-semibold text-[var(--text)]">
              {view.name}
            </span>
          </div>
          <p className="mt-2 text-xs leading-5 text-[var(--text-dim)]">
            {view.detail}
          </p>
        </button>
      ))}
    </section>
  );
}

function InvestigationWorkbench({
  affectedJobs,
  incidents,
  onApplyRule,
  onFocusQueue,
  onIncidentSelect,
  onJobSelect,
  provider,
  routingApplied,
  ruleImpact,
  selectedGeneration,
  selectedIncident,
  trafficShare,
  triggerMode,
  onTrafficShareChange,
  onTriggerModeChange,
}: {
  affectedJobs: Generation[];
  incidents: Incident[];
  onApplyRule: () => void;
  onFocusQueue: () => void;
  onIncidentSelect: (incidentId: string) => void;
  onJobSelect: (job: Generation) => void;
  provider: Provider;
  routingApplied: boolean;
  ruleImpact: {
    jobs: number;
    p95Delta: number;
    failureDelta: number;
    spendDelta: number;
  };
  selectedGeneration: Generation | null;
  selectedIncident: Incident;
  trafficShare: number;
  triggerMode: TriggerMode;
  onTrafficShareChange: (value: number) => void;
  onTriggerModeChange: (value: TriggerMode) => void;
}) {
  return (
    <section className="grid gap-4 xl:grid-cols-[0.95fr_1.15fr_1fr]">
      <Panel title="Incident Triage" eyebrow="Selectable investigation">
        <div className="space-y-2">
          {incidents.map((incident) => (
            <div
              key={incident.id}
              className={cn(
                "rounded-lg border transition-colors",
                selectedIncident.id === incident.id
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-mute)]",
              )}
            >
              <button
                onClick={() => onIncidentSelect(incident.id)}
                className="w-full p-3 text-left"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--text)]">
                      {incident.title}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[var(--text-dim)]">
                      {incident.detail}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-md px-2 py-1 text-xs font-medium",
                      severityStyle[incident.severity],
                    )}
                  >
                    {incident.age}
                  </span>
                </div>
              </button>
              <Link
                href={`/incidents/${incident.id}`}
                className="mx-3 mb-3 inline-flex text-xs font-semibold text-[var(--accent)] hover:underline"
              >
                Open incident detail
              </Link>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title={provider.name}
        eyebrow="Drill-down scope"
        action={`${affectedJobs.length} affected jobs`}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricTile label="p95 latency" value={formatMs(provider.p95Ms)} />
          <MetricTile label="failure rate" value={`${provider.failureRate}%`} />
          <MetricTile label="spend" value={formatCurrency(provider.spend)} />
        </div>

        <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-mute)] p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
            <Target className="size-4 text-[var(--accent)]" />
            Suggested action
          </div>
          <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">
            Drain high-risk {provider.name} jobs into Google AI until the next
            healthy probe. Keep low-cost retryable jobs on the current provider.
          </p>
        </div>

        <div className="mt-4 space-y-2">
          {affectedJobs.slice(0, 4).map((job) => (
            <button
              key={job.id}
              onClick={() => onJobSelect(job)}
              className={cn(
                "grid w-full grid-cols-[1fr_auto] items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                selectedGeneration?.id === job.id
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-mute)]",
              )}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-[var(--text)]">
                  {job.prompt}
                </div>
                <div className="mt-1 text-xs text-[var(--mute)]">
                  {job.status} · {job.user}
                </div>
              </div>
              <span className="font-mono text-sm text-[var(--text)]">
                {formatMs(job.durationMs)}
              </span>
            </button>
          ))}
        </div>

        <button
          onClick={onFocusQueue}
          className="mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm font-medium text-[var(--text)] shadow-[var(--shadow-1)] hover:bg-[var(--surface-mute)]"
        >
          <SlidersHorizontal className="size-4" />
          Focus queue on this provider
        </button>
      </Panel>

      <Panel title="Routing Rule Builder" eyebrow="Draft and preview">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-mute)] p-3">
          <div className="text-xs font-medium uppercase tracking-[0.03em] text-[var(--mute)]">
            If
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--text)]">
            <RuleChip>{provider.name}</RuleChip>
            <RuleChip>
              {triggerMode === "latency" ? "p95 > 12s" : "failures > 5%"}
            </RuleChip>
            <RuleChip>{trafficShare}% traffic</RuleChip>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            onClick={() => onTriggerModeChange("latency")}
            className={cn(
              "rounded-lg border px-3 py-2 text-sm font-medium",
              triggerMode === "latency"
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                : "border-[var(--border)] text-[var(--text-dim)]",
            )}
          >
            Latency guard
          </button>
          <button
            onClick={() => onTriggerModeChange("failure")}
            className={cn(
              "rounded-lg border px-3 py-2 text-sm font-medium",
              triggerMode === "failure"
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                : "border-[var(--border)] text-[var(--text-dim)]",
            )}
          >
            Failure guard
          </button>
        </div>

        <label className="mt-4 block">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-[var(--text)]">Traffic drain</span>
            <span className="font-mono text-[var(--text-dim)]">
              {trafficShare}%
            </span>
          </div>
          <input
            min={20}
            max={90}
            step={1}
            type="range"
            value={trafficShare}
            onChange={(event) => onTrafficShareChange(Number(event.target.value))}
            className="mt-3 w-full accent-[var(--accent)]"
          />
        </label>

        <div className="mt-4 grid gap-2 sm:grid-cols-4">
          <MetricTile label="jobs moved" value={formatNumber(ruleImpact.jobs)} />
          <MetricTile label="p95 saved" value={formatMs(ruleImpact.p95Delta)} />
          <MetricTile label="fail cut" value={`${ruleImpact.failureDelta}%`} />
          <MetricTile label="cost saved" value={formatCurrency(ruleImpact.spendDelta)} />
        </div>

        <button
          onClick={onApplyRule}
          disabled={routingApplied}
          className={cn(
            "mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border text-sm font-medium shadow-[var(--shadow-1)]",
            routingApplied
              ? "border-[var(--border)] bg-[var(--success-soft)] text-[var(--success)]"
              : "border-[var(--accent)] bg-[var(--accent)] [color:white] hover:bg-[var(--accent-hover)]",
          )}
        >
          {routingApplied ? (
            <CheckCircle2 className="size-4" />
          ) : (
            <GitBranch className="size-4" />
          )}
          {routingApplied ? "Rule simulated" : "Simulate rule impact"}
        </button>

        {selectedGeneration ? (
          <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.03em] text-[var(--mute)]">
              <Clock3 className="size-3.5" />
              Selected job
            </div>
            <p className="mt-2 line-clamp-2 text-sm font-medium text-[var(--text)]">
              {selectedGeneration.prompt}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--mute)]">
              <span>{selectedGeneration.id}</span>
              <span>{selectedGeneration.status}</span>
              <span>{formatCurrency(selectedGeneration.cost)}</span>
            </div>
          </div>
        ) : null}
      </Panel>
    </section>
  );
}

function RuleChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-medium">
      {children}
    </span>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="text-[10px] font-medium uppercase tracking-[0.03em] text-[var(--mute)]">
        {label}
      </div>
      <div className="mt-2 text-lg font-semibold tracking-[-0.015em] text-[var(--text)] [font-variant-numeric:tabular-nums]">
        {value}
      </div>
    </div>
  );
}

function Panel({
  title,
  eyebrow,
  action,
  children,
}: {
  title: string;
  eyebrow: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-1)]">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.03em] text-[var(--mute)]">{eyebrow}</p>
          <h2 className="mt-1 text-[17px] font-semibold tracking-[-0.015em] text-[var(--text)]">{title}</h2>
        </div>
        {action ? (
          <span className="hidden text-xs text-[var(--mute)] sm:inline-block">
            {action}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function ToggleGroup({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <span className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface-mute)] p-1">
      {options.map((option) => (
        <button
          key={option}
          onClick={() => onChange(option)}
          className={cn(
            "h-7 rounded-md px-3 text-[12.5px] font-medium capitalize text-[var(--mute)] transition-colors",
            value === option && "bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-1)]",
          )}
        >
          {option}
        </button>
      ))}
    </span>
  );
}

function ProviderRiskMap({ providers }: { providers: Provider[] }) {
  const maxSpend = Math.max(...providers.map((provider) => provider.spend));
  const maxVolume = Math.max(...providers.map((provider) => provider.volume));
  const metrics = [
    { key: "p95", label: "p95", danger: 20_000 },
    { key: "fail", label: "fail", danger: 10 },
    { key: "spend", label: "spend", danger: maxSpend },
    { key: "volume", label: "vol", danger: maxVolume },
  ] as const;

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
      <div className="min-w-[440px]">
      <div className="grid grid-cols-[1.15fr_repeat(4,minmax(58px,1fr))] border-b border-[var(--border)] bg-[var(--surface-mute)] text-[10px] font-medium uppercase tracking-[0.02em] text-[var(--mute)]">
        <div className="px-3 py-2">provider</div>
        {metrics.map((metric) => (
          <div key={metric.key} className="px-2 py-2 text-right">
            {metric.label}
          </div>
        ))}
      </div>
      {providers.map((provider) => (
        <div
          key={provider.id}
          className="grid grid-cols-[1.15fr_repeat(4,minmax(58px,1fr))] items-stretch border-b border-[var(--border-soft)] last:border-b-0"
        >
          <div className="flex min-w-0 items-center gap-2 px-3 py-3">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: provider.color }}
            />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-[var(--text)]">
                {provider.name}
              </div>
              <div className="mt-0.5 truncate text-xs text-[var(--mute)]">
                {provider.region}
              </div>
            </div>
          </div>
          <HeatCell
            value={provider.p95Ms}
            max={20_000}
            label={formatMs(provider.p95Ms)}
          />
          <HeatCell
            value={provider.failureRate}
            max={10}
            label={`${provider.failureRate}%`}
          />
          <HeatCell
            value={provider.spend}
            max={maxSpend}
            label={formatCurrency(provider.spend)}
          />
          <HeatCell
            value={provider.volume}
            max={maxVolume}
            label={formatNumber(provider.volume)}
          />
        </div>
      ))}
      </div>
    </div>
  );
}

function ProviderTable({ providers }: { providers: Provider[] }) {
  return (
    <div className="space-y-2">
      {providers.map((provider) => (
        <div
          key={provider.id}
          className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: provider.color }}
              />
              <h3 className="truncate text-sm font-semibold text-[var(--text)]">
                {provider.name}
              </h3>
              <span
                className={cn(
                  "rounded-full px-2 py-1 text-[11px] font-medium",
                  providerStatusStyle[provider.status],
                )}
              >
                {provider.status}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--mute)]">{provider.region}</p>
          </div>
          <div className="grid min-w-48 grid-cols-3 gap-3 text-right">
            <Metric label="p95" value={formatMs(provider.p95Ms)} />
            <Metric label="fail" value={`${provider.failureRate}%`} />
            <Metric label="spend" value={formatCurrency(provider.spend)} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ModelMatrix({
  models,
  providers,
}: {
  models: Model[];
  providers: Provider[];
}) {
  const maxLatency = Math.max(...models.map((model) => model.p95Ms));
  const maxCost = Math.max(...models.map((model) => model.costPerImage));
  const maxVolume = Math.max(...models.map((model) => model.volume));

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
      <div className="min-w-[360px]">
      <div className="grid grid-cols-[1.35fr_0.65fr_0.65fr_0.65fr] border-b border-[var(--border)] bg-[var(--surface-mute)] text-[10px] font-medium uppercase tracking-[0.02em] text-[var(--mute)]">
        <div className="px-3 py-2">model</div>
        <div className="px-3 py-2">latency</div>
        <div className="px-3 py-2">cost</div>
        <div className="px-3 py-2">success</div>
      </div>
      {models.map((model) => {
        const provider = providers.find((item) => item.id === model.providerId);

        return (
          <div
            key={model.id}
            className="grid grid-cols-[1.35fr_0.65fr_0.65fr_0.65fr] items-center border-b border-[var(--border-soft)] last:border-b-0"
          >
            <div className="min-w-0 px-3 py-3">
              <div className="truncate text-[13px] font-semibold text-[var(--text)]">
                {model.name}
              </div>
              <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-[var(--mute)]">
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: provider?.color }}
                />
                <span className="truncate">{provider?.name}</span>
                <span className="shrink-0">{formatNumber(model.volume)} jobs</span>
              </div>
            </div>
            <MetricBar
              label={formatMs(model.medianMs)}
              value={model.p95Ms}
              max={maxLatency}
              tone="amber"
            />
            <MetricBar
              label={formatCurrency(model.costPerImage)}
              value={model.costPerImage}
              max={maxCost}
              tone="cyan"
            />
            <MetricBar
              label={`${model.successRate}%`}
              value={model.successRate}
              max={100}
              tone="emerald"
            />
          </div>
        );
      })}
      <div className="grid grid-cols-[1fr_auto] border-t border-[var(--border)] bg-[var(--surface-mute)] px-3 py-2 text-xs text-[var(--mute)]">
        <span>routing weight reference</span>
        <span className="font-mono">{formatNumber(maxVolume)} peak jobs</span>
      </div>
      </div>
    </div>
  );
}

function ModelRankedList({
  models,
  providers,
}: {
  models: Model[];
  providers: Provider[];
}) {
  const ranked = [...models].sort((a, b) => scoreModel(b) - scoreModel(a));

  return (
    <div className="space-y-2">
      {ranked.map((model, index) => {
        const provider = providers.find((item) => item.id === model.providerId);
        const score = scoreModel(model);

        return (
          <div key={model.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-[var(--mute)]">
                    #{index + 1}
                  </span>
                  <span className="truncate text-sm font-semibold text-[var(--text)]">
                    {model.name}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-[var(--mute)]">
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: provider?.color }}
                  />
                  {provider?.name}
                </div>
              </div>
              <span className="font-mono text-lg font-semibold text-[var(--text)]">
                {score}
              </span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--accent-soft)]">
              <div
                className="h-full bg-[var(--accent)]"
                style={{ width: `${score}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HeatCell({
  value,
  max,
  label,
}: {
  value: number;
  max: number;
  label: string;
}) {
  const intensity = Math.min(value / Math.max(max, 1), 1);
  const color =
    intensity > 0.7
      ? `color-mix(in oklch, var(--danger-soft) ${Math.round(44 + intensity * 44)}%, var(--surface))`
      : intensity > 0.42
        ? `color-mix(in oklch, var(--warning-soft) ${Math.round(42 + intensity * 38)}%, var(--surface))`
        : `color-mix(in oklch, var(--success-soft) ${Math.round(36 + intensity * 34)}%, var(--surface))`;

  return (
    <div
      className="border-l border-[var(--border-soft)] px-2 py-3 text-right font-mono text-[13px] text-[var(--text)]"
      style={{ backgroundColor: color }}
    >
      {label}
    </div>
  );
}

function MetricBar({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: "amber" | "cyan" | "emerald";
}) {
  return (
    <div className="px-3 py-3">
      <div className="font-mono text-[13px] leading-none text-[var(--text)]">
        {label}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-mute)]">
        <div
          className={cn(
            "h-full",
            tone === "amber" && "bg-[var(--warning)]",
            tone === "cyan" && "bg-[var(--accent)]",
            tone === "emerald" && "bg-[var(--success)]",
          )}
          style={{ width: `${Math.min((value / Math.max(max, 1)) * 100, 100)}%` }}
        />
      </div>
    </div>
  );
}

function scoreModel(model: Model) {
  const latencyPenalty = Math.min(model.p95Ms / 22_000, 1) * 28;
  const costPenalty = Math.min(model.costPerImage / 0.12, 1) * 18;
  const score = model.successRate - latencyPenalty - costPenalty + 14;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-[0.02em] text-[var(--mute)]">{label}</div>
      <div className="mt-1 font-mono text-[13px] font-medium leading-none text-[var(--text)]">{value}</div>
    </div>
  );
}

function MiniBrief({
  icon: Icon,
  title,
  value,
  text,
}: {
  icon: React.ElementType;
  title: string;
  value: string;
  text: string;
}) {
  return (
    <section className="min-h-[188px] min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-1)]">
      <div className="flex items-center justify-between gap-3">
        <div className="grid size-10 place-items-center rounded-lg bg-[var(--success-soft)] text-[var(--success)]">
          <Icon className="size-4" />
        </div>
        <span className="text-2xl font-semibold tracking-[-0.02em] text-[var(--text)] [font-variant-numeric:tabular-nums]">{value}</span>
      </div>
      <h3 className="mt-5 text-sm font-semibold text-[var(--text)]">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">{text}</p>
    </section>
  );
}
