"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Download,
  Gauge,
  Link2,
  Sparkles,
  SlidersHorizontal,
  Target,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import type { GenerationStatus, ProviderId } from "@/lib/mock-data";
import { cn, formatCurrency, formatMs, formatNumber } from "@/lib/utils";

export type SavedView = "ops" | "triage" | "cost";
export type TriggerMode = "latency" | "failure";
export type ProviderView = "table" | "risk";
export type ModelView = "matrix" | "ranked";

// Every replay step resolves to a concrete dashboard state, so advancing the
// rail visibly drives the same controls a user could operate by hand.
export type ReplayState = {
  selectedIncidentId: string;
  savedView: SavedView;
  providerView: ProviderView;
  modelView: ModelView;
  queueFocusProviderId: ProviderId | "all";
  queueFocusStatus: GenerationStatus | "all";
  triggerMode: TriggerMode;
  trafficShare: number;
  routingApplied: boolean;
};

export type ReplayStep = {
  id: string;
  label: string;
  title: string;
  icon: LucideIcon;
  narrative: string;
  proof: string;
  scrollTo: string;
  state: ReplayState;
};

export type ReplayScenario = {
  id: string;
  name: string;
  tagline: string;
  providerId: ProviderId;
  steps: ReplayStep[];
};

export type ReplayImpact = {
  jobs: number;
  p95Delta: number;
  failureDelta: number;
  spendDelta: number;
};

// Tech-proof copy lives on the blueprint because it describes the
// implementation (TanStack Query/Table/Virtual, derived memos), not the
// scenario. Narratives below are per-scenario.
const STEP_BLUEPRINT: Array<{
  id: string;
  label: string;
  title: string;
  icon: LucideIcon;
  scrollTo: string;
  proof: string;
}> = [
  {
    id: "signal",
    label: "Signal",
    title: "Signal detected",
    icon: AlertTriangle,
    scrollTo: "replay-investigation",
    proof:
      "TanStack Query hydrates the ops snapshot; the selected incident is React state, not a static page.",
  },
  {
    id: "affected",
    label: "Affected jobs",
    title: "Affected jobs",
    icon: Target,
    scrollTo: "replay-queue",
    proof:
      "TanStack Table + Virtual filter 10,000 synthetic jobs to the impacted provider with only visible rows mounted.",
  },
  {
    id: "mitigation",
    label: "Mitigation",
    title: "Draft mitigation",
    icon: SlidersHorizontal,
    scrollTo: "replay-investigation",
    proof:
      "The routing rule builder is fully controlled state — trigger mode and the traffic-drain slider recompute impact live.",
  },
  {
    id: "kpi",
    label: "KPI delta",
    title: "Projected KPI delta",
    icon: Gauge,
    scrollTo: "replay-kpis",
    proof:
      "Applying the rule rewrites derived provider/timeline memos, so KPI cards and every chart re-render from one source.",
  },
  {
    id: "export",
    label: "Export",
    title: "Export & handoff",
    icon: Download,
    scrollTo: "replay-header",
    proof:
      "Export serializes the exact visible snapshot — range, saved view, routing state, affected jobs — to a CSV handoff.",
  },
];

type ScenarioConfig = {
  id: string;
  name: string;
  tagline: string;
  providerId: ProviderId;
  incidentId: string;
  triggerMode: TriggerMode;
  baseShare: number;
  mitigationShare: number;
  costView: boolean;
  narratives: [string, string, string, string, string];
};

const SCENARIO_CONFIG: ScenarioConfig[] = [
  {
    id: "alibaba-p95",
    name: "Alibaba p95 spike",
    tagline: "Critical latency tail on Qwen Image",
    providerId: "alibaba",
    incidentId: "inc_411",
    triggerMode: "latency",
    baseShare: 68,
    mitigationShare: 78,
    costView: false,
    narratives: [
      "Alibaba's Qwen Image cluster tripped a critical incident — p95 crossed 18s after regional queue saturation.",
      "Triage narrows the live queue to Alibaba's active jobs so you can see exactly which generations are stalling.",
      "Draft a latency guard that drains 78% of Alibaba traffic to Google AI while keeping cheap retryable jobs in place.",
      "Simulating the rule cuts the p95 tail, failure rate, and spend — KPI cards and charts update from the same memo.",
      "Hand it off: export the post-mitigation snapshot as a CSV for the on-call channel.",
    ],
  },
  {
    id: "flux-retry",
    name: "FLUX retry storm",
    tagline: "Elevated retries on fal.ai image-to-image",
    providerId: "fal",
    incidentId: "inc_409",
    triggerMode: "failure",
    baseShare: 60,
    mitigationShare: 64,
    costView: false,
    narratives: [
      "fal.ai is degraded — FLUX retry pressure is climbing on image-to-image jobs and inflating failure rate.",
      "Triage focuses the queue on fal.ai so the retrying and failed jobs surface against 10k rows.",
      "Draft a failure guard that peels 64% of fal.ai traffic off until the next healthy probe.",
      "The simulated rule trims retries and the failure rate, and the throughput/latency charts redraw in step.",
      "Export the mitigated snapshot so the provider escalation has the exact numbers you just saw.",
    ],
  },
  {
    id: "template-cost",
    name: "Qwen cost bleed",
    tagline: "Latency retries quietly burning credits",
    providerId: "alibaba",
    incidentId: "inc_411",
    triggerMode: "failure",
    baseShare: 45,
    mitigationShare: 52,
    costView: true,
    narratives: [
      "Qwen Image latency is now causing retry spend — the same incident is visible through a finance lens.",
      "The Cost review saved view filters Alibaba to retrying jobs, where wasted credits concentrate.",
      "Draft a failure guard that drains 52% of risky Alibaba traffic into Google AI before retries compound.",
      "The simulated rule shows credits saved and the spend distribution shifting across providers.",
      "Export the cost snapshot for the finance/ops handoff before the next billing window.",
    ],
  },
];

function buildScenario(config: ScenarioConfig): ReplayScenario {
  const mitigationView: SavedView = config.costView ? "cost" : "triage";
  const providerView: ProviderView = config.costView ? "table" : "risk";
  const modelView: ModelView = "ranked";
  const focusStatus: GenerationStatus | "all" = config.costView
    ? "retrying"
    : "all";

  const states: ReplayState[] = [
    {
      selectedIncidentId: config.incidentId,
      savedView: "ops",
      providerView: "risk",
      modelView: "matrix",
      queueFocusProviderId: "all",
      queueFocusStatus: "all",
      triggerMode: config.triggerMode,
      trafficShare: config.baseShare,
      routingApplied: false,
    },
    {
      selectedIncidentId: config.incidentId,
      savedView: mitigationView,
      providerView,
      modelView,
      queueFocusProviderId: config.providerId,
      queueFocusStatus: focusStatus,
      triggerMode: config.triggerMode,
      trafficShare: config.baseShare,
      routingApplied: false,
    },
    {
      selectedIncidentId: config.incidentId,
      savedView: mitigationView,
      providerView,
      modelView,
      queueFocusProviderId: config.providerId,
      queueFocusStatus: focusStatus,
      triggerMode: config.triggerMode,
      trafficShare: config.mitigationShare,
      routingApplied: false,
    },
    {
      selectedIncidentId: config.incidentId,
      savedView: mitigationView,
      providerView,
      modelView,
      queueFocusProviderId: config.providerId,
      queueFocusStatus: focusStatus,
      triggerMode: config.triggerMode,
      trafficShare: config.mitigationShare,
      routingApplied: true,
    },
    {
      selectedIncidentId: config.incidentId,
      savedView: mitigationView,
      providerView,
      modelView,
      queueFocusProviderId: config.providerId,
      queueFocusStatus: focusStatus,
      triggerMode: config.triggerMode,
      trafficShare: config.mitigationShare,
      routingApplied: true,
    },
  ];

  return {
    id: config.id,
    name: config.name,
    tagline: config.tagline,
    providerId: config.providerId,
    steps: STEP_BLUEPRINT.map((blueprint, index) => ({
      ...blueprint,
      narrative: config.narratives[index],
      state: states[index],
    })),
  };
}

export const replayScenarios: ReplayScenario[] = SCENARIO_CONFIG.map(buildScenario);

// The clean baseline restored on exit — matches the Dashboard's initial state.
export const replayBaseline: ReplayState = {
  selectedIncidentId: "inc_411",
  savedView: "ops",
  providerView: "risk",
  modelView: "matrix",
  queueFocusProviderId: "all",
  queueFocusStatus: "all",
  triggerMode: "latency",
  trafficShare: 68,
  routingApplied: false,
};

export function IncidentReplay({
  scenarios,
  activeScenarioId,
  stepIndex,
  liveImpact,
  onStart,
  onStep,
  onExit,
}: {
  scenarios: ReplayScenario[];
  activeScenarioId: string | null;
  stepIndex: number;
  liveImpact: ReplayImpact | null;
  onStart: (scenarioId: string) => void;
  onStep: (index: number) => void;
  onExit: () => void;
}) {
  const activeScenario =
    scenarios.find((scenario) => scenario.id === activeScenarioId) ?? null;

  return (
    <section className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-1)] sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
            <Sparkles className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[16px] font-semibold tracking-[-0.015em] text-[var(--text)]">
                Guided incident replay
              </h2>
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface-mute)] px-2 py-0.5 text-[11px] font-medium text-[var(--mute)]">
                <Clock3 className="size-3" />
                ~90s · 5 steps
              </span>
            </div>
            <p className="mt-1 max-w-xl text-[13px] leading-5 text-[var(--text-dim)]">
              Follow one incident end to end: signal → affected jobs → mitigation
              → projected KPI delta → export handoff.
            </p>
          </div>
        </div>
        {activeScenario ? (
          <button
            onClick={onExit}
            className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-[12.5px] font-medium text-[var(--text-dim)] transition-colors hover:bg-[var(--surface-mute)]"
          >
            Exit replay
          </button>
        ) : null}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {activeScenario ? (
          <ReplayPlayer
            key="player"
            scenario={activeScenario}
            stepIndex={stepIndex}
            liveImpact={liveImpact}
            onStep={onStep}
            onExit={onExit}
          />
        ) : (
          <ScenarioLauncher key="launcher" scenarios={scenarios} onStart={onStart} />
        )}
      </AnimatePresence>
    </section>
  );
}

function ScenarioLauncher({
  scenarios,
  onStart,
}: {
  scenarios: ReplayScenario[];
  onStart: (scenarioId: string) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="mt-4 grid gap-2 md:grid-cols-3"
    >
      {scenarios.map((scenario) => (
        <button
          key={scenario.id}
          onClick={() => onStart(scenario.id)}
          className="group flex cursor-pointer flex-col items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-mute)] p-3 text-left transition-all hover:border-[var(--accent)] hover:bg-[var(--surface)] hover:shadow-[var(--shadow-1)]"
        >
          <div className="flex w-full items-center justify-between gap-2">
            <span className="text-[13.5px] font-semibold text-[var(--text)]">
              {scenario.name}
            </span>
            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-[var(--accent-soft)] text-[var(--accent)] transition-colors group-hover:bg-[var(--accent)] group-hover:text-white">
              <Sparkles className="size-3.5" />
            </span>
          </div>
          <p className="text-xs leading-5 text-[var(--text-dim)]">
            {scenario.tagline}
          </p>
          <span className="mt-1 text-[11px] font-medium uppercase tracking-[0.03em] text-[var(--accent)]">
            Start replay
          </span>
        </button>
      ))}
    </motion.div>
  );
}

function CopyLinkButton() {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    if (typeof window === "undefined" || !navigator.clipboard) {
      return;
    }

    try {
      // The dashboard keeps window.location in sync with the active step, so
      // the current URL is already the exact shareable beat to hand off.
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
      }
      resetTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (permissions/unsupported); ignore silently.
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Copy a shareable link to this replay step"
      className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-[11.5px] font-medium text-[var(--text-dim)] transition-colors hover:bg-[var(--surface-mute)]"
    >
      {copied ? (
        <CheckCircle2 className="size-3.5 text-[var(--success)]" />
      ) : (
        <Link2 className="size-3.5" />
      )}
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}

function ReplayPlayer({
  scenario,
  stepIndex,
  liveImpact,
  onStep,
  onExit,
}: {
  scenario: ReplayScenario;
  stepIndex: number;
  liveImpact: ReplayImpact | null;
  onStep: (index: number) => void;
  onExit: () => void;
}) {
  const total = scenario.steps.length;
  const step = scenario.steps[stepIndex];
  const StepIcon = step.icon;
  const isLast = stepIndex === total - 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="mt-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] font-semibold text-[var(--text)]">
          {scenario.name}
        </span>
        <div className="flex items-center gap-2">
          <CopyLinkButton />
          <span className="font-mono text-xs text-[var(--mute)]">
            Step {stepIndex + 1} of {total}
          </span>
        </div>
      </div>

      <ol className="mt-3 grid grid-cols-5 gap-1.5">
        {scenario.steps.map((item, index) => {
          const isActive = index === stepIndex;
          const isDone = index < stepIndex;
          const ItemIcon = item.icon;

          return (
            <li key={item.id}>
              <button
                onClick={() => onStep(index)}
                aria-current={isActive ? "step" : undefined}
                className={cn(
                  "flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-lg border px-1 py-2 text-center transition-colors",
                  isActive
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                    : isDone
                      ? "border-[var(--border)] bg-[var(--success-soft)]"
                      : "border-[var(--border)] bg-[var(--surface-mute)] hover:bg-[var(--surface)]",
                )}
              >
                <span
                  className={cn(
                    "grid size-6 place-items-center rounded-md transition-colors",
                    isActive
                      ? "bg-[var(--accent)] text-white"
                      : isDone
                        ? "bg-[var(--success)] text-white"
                        : "bg-[var(--surface)] text-[var(--mute)]",
                  )}
                >
                  {isDone ? (
                    <CheckCircle2 className="size-3.5" />
                  ) : (
                    <ItemIcon className="size-3.5" />
                  )}
                </span>
                <span
                  className={cn(
                    "hidden text-[10.5px] font-medium leading-tight sm:block",
                    isActive ? "text-[var(--accent)]" : "text-[var(--mute)]",
                  )}
                >
                  {item.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <AnimatePresence mode="wait">
        <motion.div
          key={step.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
          className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-mute)] p-3.5"
        >
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-md bg-[var(--accent-soft)] text-[var(--accent)]">
              <StepIcon className="size-4" />
            </span>
            <h3 className="text-sm font-semibold text-[var(--text)]">
              {step.title}
            </h3>
          </div>
          <p className="mt-2 text-[13px] leading-6 text-[var(--text-dim)]">
            {step.narrative}
          </p>

          {step.id === "kpi" && liveImpact ? (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <ImpactStat label="jobs moved" value={formatNumber(liveImpact.jobs)} />
              <ImpactStat label="p95 saved" value={formatMs(liveImpact.p95Delta)} />
              <ImpactStat
                label="fail cut"
                value={`${liveImpact.failureDelta}%`}
              />
              <ImpactStat
                label="cost saved"
                value={formatCurrency(liveImpact.spendDelta)}
              />
            </div>
          ) : null}

          <div className="mt-3 flex items-start gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2">
            <ShieldGlyph />
            <p className="text-[11.5px] leading-5 text-[var(--mute)]">
              <span className="font-semibold text-[var(--text-dim)]">
                Technical proof:{" "}
              </span>
              {step.proof}
            </p>
          </div>
        </motion.div>
      </AnimatePresence>

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          onClick={() => onStep(stepIndex - 1)}
          disabled={stepIndex === 0}
          className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-[12.5px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-mute)] disabled:cursor-not-allowed disabled:opacity-45"
        >
          <ArrowLeft className="size-4" />
          Back
        </button>
        {isLast ? (
          <button
            onClick={onExit}
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--accent)] bg-[var(--accent)] px-4 text-[12.5px] font-semibold text-white shadow-[var(--shadow-1)] transition-colors hover:bg-[var(--accent-hover)]"
          >
            <CheckCircle2 className="size-4" />
            Finish replay
          </button>
        ) : (
          <button
            onClick={() => onStep(stepIndex + 1)}
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--accent)] bg-[var(--accent)] px-4 text-[12.5px] font-semibold text-white shadow-[var(--shadow-1)] transition-colors hover:bg-[var(--accent-hover)]"
          >
            Next step
            <ArrowLeft className="size-4 rotate-180" />
          </button>
        )}
      </div>
    </motion.div>
  );
}

function ImpactStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2">
      <div className="text-[10px] font-medium uppercase tracking-[0.03em] text-[var(--mute)]">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold tracking-[-0.01em] text-[var(--text)] [font-variant-numeric:tabular-nums]">
        {value}
      </div>
    </div>
  );
}

function ShieldGlyph() {
  return (
    <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-sm bg-[var(--accent-soft)] text-[var(--accent)]">
      <CheckCircle2 className="size-3" />
    </span>
  );
}
