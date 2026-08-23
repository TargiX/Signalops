"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clipboard,
  ClipboardCheck,
  CircleDollarSign,
  Loader2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { fetchOpsSnapshot } from "@/lib/mock-data";
import {
  captureProductEvent,
  captureProductException,
} from "@/lib/product-analytics";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

type GuardState = "draft" | "simulated" | "active";

type CopyState = { content: string; status: "copied" | "error"; error?: string } | null;

const previewGuardParam = "preview";

function normalizeCeiling(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function readPreviewCeilingFromLocation() {
  if (typeof window === "undefined") {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const rawCeiling = params.get("ceiling");
  if (params.get("guard") !== previewGuardParam || rawCeiling === null || rawCeiling.trim() === "") {
    return null;
  }

  const ceiling = Number(rawCeiling);
  return Number.isFinite(ceiling) && ceiling >= 0 ? ceiling : null;
}

function buildPreviewGuardUrl(ceiling: number) {
  const url = new URL(window.location.href);
  url.searchParams.set("ceiling", String(normalizeCeiling(ceiling)));
  url.searchParams.set("guard", previewGuardParam);
  url.hash = "";
  return url.toString();
}

function syncPreviewGuardUrl(ceiling: number) {
  const url = buildPreviewGuardUrl(ceiling);
  window.history.replaceState(null, "", url);
  return url;
}

function clearPreviewGuardUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("ceiling");
  url.searchParams.delete("guard");
  window.history.replaceState(null, "", url);
}

function projectConsumerGuard(
  consumer: { spend: number; generations: number; credits: number },
  ceiling: number,
) {
  const normalizedCeiling = normalizeCeiling(ceiling);
  const overage = Math.max(0, consumer.spend - normalizedCeiling);
  const affectedShare = consumer.spend === 0 ? 0 : overage / consumer.spend;

  return {
    overage,
    affectedGenerations: Math.min(consumer.generations, Math.ceil(consumer.generations * affectedShare)),
    remainingCredits: Math.max(0, consumer.credits - Math.round(consumer.credits * affectedShare)),
  };
}

function formatSessionGuardHandoff({
  consumer,
  ceiling,
  projection,
}: {
  consumer: { id: string; name: string; plan: string; spend: number; generations: number };
  ceiling: number;
  projection: { overage: number; affectedGenerations: number; remainingCredits: number };
}) {
  return [
    `# Session guard handoff — ${consumer.name}`,
    "",
    `Account: ${consumer.plan} · ${formatNumber(consumer.generations)} generations in the current 24-hour snapshot`,
    `Decision: ACTIVE — hold requests after account spend reaches ${formatCurrency(ceiling)}`,
    `Current spend: ${formatCurrency(consumer.spend)} · over ceiling: ${formatCurrency(projection.overage)}`,
    `Projected impact: ${formatNumber(projection.affectedGenerations)} generation requests held · ${formatNumber(projection.remainingCredits)} credits remain outside the held share`,
    "State: SESSION ONLY — no billing, credits, or server-side policy changed",
    `Account route: /consumers/${consumer.id}`,
  ].join("\n");
}

export function ConsumerDetail({ consumerId }: { consumerId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["ops-snapshot", "24h"],
    queryFn: () => fetchOpsSnapshot("24h"),
  });
  const consumer = data?.consumers.find((item) => item.id === consumerId);
  const [ceilingOverride, setCeilingOverride] = useState<number | null>(null);
  const [simulatedCeiling, setSimulatedCeiling] = useState<number | null>(null);
  const [activeCeiling, setActiveCeiling] = useState<number | null>(null);
  const [copyState, setCopyState] = useState<CopyState>(null);
  const [previewUrlError, setPreviewUrlError] = useState<string | null>(null);
  const copyAttempt = useRef(0);
  const previewHydrated = useRef(false);
  const ceiling = normalizeCeiling(ceilingOverride ?? (consumer ? Math.max(1, Math.floor(consumer.spend * 0.8)) : 0));

  const projection = useMemo(() => {
    if (!consumer) {
      return null;
    }

    return projectConsumerGuard(consumer, ceiling);
  }, [ceiling, consumer]);

  const guardState: GuardState = activeCeiling !== null ? "active" : simulatedCeiling === ceiling ? "simulated" : "draft";

  useEffect(() => {
    if (previewHydrated.current) {
      return;
    }

    previewHydrated.current = true;
    const previewCeiling = readPreviewCeilingFromLocation();
    if (previewCeiling === null) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setCeilingOverride(previewCeiling);
      setSimulatedCeiling(previewCeiling);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  if (isLoading || !data) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--background)] text-[var(--text)]">
        <div className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-5 py-4 shadow-[var(--shadow-1)]">
          <Loader2 className="size-5 animate-spin text-[var(--accent)]" />
          <span className="text-sm text-[var(--text-dim)]">Loading consumer account</span>
        </div>
      </main>
    );
  }

  if (!consumer || !projection) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--background)] px-4 text-[var(--text)]">
        <div className="max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center shadow-[var(--shadow-1)]">
          <AlertTriangle className="mx-auto size-8 text-[var(--warning)]" />
          <h1 className="mt-4 text-xl font-semibold">Consumer account not found</h1>
          <Link href="/cockpit" className="mt-4 inline-flex text-sm font-semibold text-[var(--accent)] hover:underline">
            Back to cockpit
          </Link>
        </div>
      </main>
    );
  }

  const inputChanged = activeCeiling === null && simulatedCeiling !== ceiling;
  const activeProjection = activeCeiling === null ? null : projectConsumerGuard(consumer, activeCeiling);
  const activeHandoff =
    activeCeiling === null || activeProjection === null
      ? null
      : formatSessionGuardHandoff({ consumer, ceiling: activeCeiling, projection: activeProjection });

  async function copySessionGuardHandoff() {
    if (!activeHandoff) {
      return;
    }

    const attempt = ++copyAttempt.current;
    try {
      await navigator.clipboard.writeText(activeHandoff);
      captureProductEvent("session_guard_handoff_copied", {
        consumer_id: consumerId,
        ceiling: activeCeiling,
      });
      if (copyAttempt.current === attempt) {
        setCopyState({ content: activeHandoff, status: "copied" });
      }
    } catch (copyError) {
      captureProductException(copyError, { flow: "copy_session_guard_handoff" });
      if (copyAttempt.current === attempt) {
        setCopyState({
          content: activeHandoff,
          status: "error",
          error: copyError instanceof Error ? copyError.message : "Copy failed. Try again.",
        });
      }
    }
  }

  async function copyPreviewLink() {
    const link = buildPreviewGuardUrl(ceiling);
    const attempt = ++copyAttempt.current;
    try {
      await navigator.clipboard.writeText(link);
      captureProductEvent("session_guard_preview_link_copied", {
        consumer_id: consumerId,
        ceiling,
      });
      if (copyAttempt.current === attempt) {
        setCopyState({ content: link, status: "copied" });
      }
    } catch (copyError) {
      captureProductException(copyError, { flow: "copy_session_guard_preview" });
      if (copyAttempt.current === attempt) {
        setCopyState({
          content: link,
          status: "error",
          error: copyError instanceof Error ? copyError.message : "Copy failed. Try again.",
        });
      }
    }
  }

  function syncPreviewLink() {
    try {
      syncPreviewGuardUrl(ceiling);
      setPreviewUrlError(null);
      captureProductEvent("session_guard_preview_link_synced", {
        consumer_id: consumerId,
        ceiling,
      });
    } catch {
      setPreviewUrlError("Preview is ready, but the shareable link could not be updated. Retry link sync to keep the address bar accurate.");
    }
  }

  function clearPreviewLink() {
    try {
      clearPreviewGuardUrl();
      setPreviewUrlError(null);
    } catch {
      setPreviewUrlError("This draft is no longer the shared preview, but the address bar could not be cleared.");
    }
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[var(--background)] text-[var(--text)]">
      <div className="pointer-events-none fixed inset-0 opacity-70">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(224,224,250,0.7),transparent_30%),linear-gradient(180deg,var(--background)_0%,oklch(0.965_0.006_80)_100%)]" />
      </div>
      <div className="relative mx-auto flex w-full max-w-[1180px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-1)]">
          <Link href="/cockpit" className="inline-flex items-center gap-2 text-sm font-medium text-[var(--text-dim)] hover:text-[var(--text)]">
            <ArrowLeft className="size-4" />
            Back to cockpit
          </Link>
          <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--mute)]">Consumer guard</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[var(--text-strong)]">{consumer.name}</h1>
              <p className="mt-2 text-sm text-[var(--text-dim)]">{consumer.plan} plan · {formatNumber(consumer.generations)} generations · {consumer.failureRate}% failure rate</p>
            </div>
            <span
              data-guard-state={guardState}
              className={cn(
                "w-fit rounded-full border px-3 py-1.5 text-xs font-semibold",
                guardState === "active"
                  ? "border-[var(--success)]/20 bg-[var(--success-soft)] text-[var(--success)]"
                  : guardState === "simulated"
                    ? "border-[var(--accent)]/20 bg-[var(--info-soft)] text-[var(--info)]"
                    : "border-[var(--warning)]/20 bg-[var(--warning-soft)] text-[var(--warning)]",
              )}
            >
              {guardState === "active" ? "Session guard active" : guardState === "simulated" ? "Impact simulated" : "Draft guard"}
            </span>
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-1)]">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--mute)]">
              <SlidersHorizontal className="size-3.5" />
              Configure this guard
            </div>
            <h2 className="mt-2 text-xl font-semibold tracking-[-0.02em]">Set an account spend ceiling</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">Preview the account-level impact before enabling a temporary local guard. This demo never changes billing, credits, or server-side policy.</p>
            <label className="mt-6 block">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-dim)]">24-hour spend ceiling</span>
              <div className="mt-2 flex items-center rounded-lg border border-[var(--border)] bg-[var(--surface-mute)] px-3 focus-within:border-[var(--accent)]">
                <CircleDollarSign className="size-4 text-[var(--mute)]" />
                <input
                  aria-label="24-hour spend ceiling"
                  className="h-12 w-full bg-transparent px-2 text-lg font-semibold text-[var(--text-strong)] outline-none"
                  min="0"
                  onChange={(event) => {
                    const nextCeiling = Number(event.target.value);
                    copyAttempt.current += 1;
                    setCopyState(null);
                    setCeilingOverride(normalizeCeiling(nextCeiling));
                    setSimulatedCeiling(null);
                    setActiveCeiling(null);
                    clearPreviewLink();
                  }}
                  step="1"
                  type="number"
                  value={ceiling}
                />
              </div>
            </label>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  copyAttempt.current += 1;
                  setCopyState(null);
                  setSimulatedCeiling(ceiling);
                  syncPreviewLink();
                  captureProductEvent("session_guard_simulated", {
                    consumer_id: consumer.id,
                    ceiling,
                    affected_generations: projection.affectedGenerations,
                  });
                }}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-mute)] px-4 text-sm font-semibold text-[var(--text)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                <Sparkles className="size-4" />
                {guardState === "simulated" ? "Impact simulated" : "Preview impact"}
              </button>
              <button
                type="button"
                disabled={guardState !== "simulated"}
                onClick={() => {
                  setActiveCeiling(ceiling);
                  clearPreviewLink();
                  captureProductEvent("session_guard_activated", {
                    consumer_id: consumer.id,
                    ceiling,
                    affected_generations: projection.affectedGenerations,
                  });
                }}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ShieldCheck className="size-4" />
                Activate session guard
              </button>
            </div>
            {activeCeiling !== null ? (
              <button
                type="button"
                onClick={() => {
                  copyAttempt.current += 1;
                  setCopyState(null);
                  setActiveCeiling(null);
                  setSimulatedCeiling(null);
                }}
                className="mt-3 text-sm font-semibold text-[var(--accent)] underline-offset-4 hover:underline"
              >
                Clear session guard
              </button>
            ) : null}
          </section>

          <section aria-live="polite" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-1)]">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--mute)]">Live preview</p>
            <h2 className="mt-2 text-xl font-semibold tracking-[-0.02em]">Account-level impact</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">Changes in the control on the left invalidate prior simulation and guard state.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <Stat label="Current spend" value={formatCurrency(consumer.spend)} />
              <Stat label="Over ceiling" value={formatCurrency(projection.overage)} danger={projection.overage > 0} />
              <Stat label="Estimated holds" value={`${formatNumber(projection.affectedGenerations)} jobs`} danger={projection.affectedGenerations > 0} />
            </div>
            <div className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface-mute)] p-4 text-sm leading-6 text-[var(--text)]">
              {projection.overage > 0
                ? `At this ceiling, the next ${formatNumber(projection.affectedGenerations)} generation requests would be held after the account reaches ${formatCurrency(ceiling)}. ${formatNumber(projection.remainingCredits)} credits remain outside the held share.`
                : `This ceiling is at or above current spend. No generation requests would be held in the current 24-hour snapshot.`}
            </div>
            <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-[var(--text-dim)]">
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-[var(--success)]" />
              {inputChanged ? "Draft values are not active. Preview, then explicitly activate the session-only guard." : "This guard is local to the current screen and is intentionally not a persisted billing control."}
            </p>
            {guardState === "simulated" ? (
              <section
                aria-labelledby="preview-checkpoint-title"
                className="mt-5 rounded-lg border border-[var(--info)]/20 bg-[var(--info-soft)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--info)]">Shareable checkpoint</p>
                    <h3 className="mt-1 text-base font-semibold text-[var(--text-strong)]" id="preview-checkpoint-title">
                      Preview this guard with a teammate
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={copyPreviewLink}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[var(--info)]/25 bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--text)] transition hover:border-[var(--info)] hover:text-[var(--info)]"
                  >
                    {copyState?.content === buildPreviewGuardUrl(ceiling) && copyState.status === "copied" ? (
                      <ClipboardCheck className="size-4" />
                    ) : (
                      <Clipboard className="size-4" />
                    )}
                    {copyState?.content === buildPreviewGuardUrl(ceiling) && copyState.status === "copied"
                      ? "Preview link copied"
                      : "Copy preview link"}
                  </button>
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--text-dim)]">
                  This link restores the selected account and simulated ceiling only. It never activates a guard or changes billing, credits, or server-side policy.
                </p>
                {copyState?.content === buildPreviewGuardUrl(ceiling) && copyState.status === "error" ? (
                  <p className="mt-3 text-sm font-medium text-[var(--danger)]" role="alert">
                    {copyState.error}
                  </p>
                ) : null}
              </section>
            ) : null}
            {previewUrlError ? (
              <div
                className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--warning)]/20 bg-[var(--warning-soft)] p-3"
                role="alert"
              >
                <p className="text-sm leading-5 text-[var(--text)]">{previewUrlError}</p>
                <button
                  type="button"
                  onClick={syncPreviewLink}
                  className="shrink-0 text-sm font-semibold text-[var(--accent)] underline-offset-4 hover:underline"
                >
                  Retry link sync
                </button>
              </div>
            ) : null}
            {activeHandoff ? (
              <section
                aria-labelledby="session-guard-handoff-title"
                className="mt-5 rounded-lg border border-[var(--success)]/20 bg-[var(--success-soft)] p-4"
                id="handoff"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--success)]">Shareable record</p>
                    <h3 className="mt-1 text-base font-semibold text-[var(--text-strong)]" id="session-guard-handoff-title">
                      Session guard handoff
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={copySessionGuardHandoff}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[var(--success)]/25 bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--text)] transition hover:border-[var(--success)] hover:text-[var(--success)]"
                  >
                    {copyState?.content === activeHandoff && copyState.status === "copied" ? (
                      <ClipboardCheck className="size-4" />
                    ) : (
                      <Clipboard className="size-4" />
                    )}
                    {copyState?.content === activeHandoff && copyState.status === "copied"
                      ? "Handoff copied"
                      : "Copy session guard handoff"}
                  </button>
                </div>
                <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-md border border-[var(--success)]/15 bg-[var(--surface)] p-3 font-mono text-xs leading-5 text-[var(--text)]">
                  {activeHandoff}
                </pre>
                {copyState?.content === activeHandoff && copyState.status === "error" ? (
                  <p className="mt-3 text-sm font-medium text-[var(--danger)]" role="alert">
                    {copyState.error}
                  </p>
                ) : null}
              </section>
            ) : null}
          </section>
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-mute)] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)]">{label}</p>
      <p className={cn("mt-2 text-xl font-semibold", danger ? "text-[var(--danger)]" : "text-[var(--text-strong)]")}>{value}</p>
    </div>
  );
}
