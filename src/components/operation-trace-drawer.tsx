"use client";

import { Dialog } from "@base-ui/react/dialog";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  RefreshCw,
  Route,
  TriangleAlert,
  X,
} from "lucide-react";
import type { RefObject } from "react";
import { useCallback, useEffect, useState } from "react";

import type {
  SignalOpsOperationTraceAttemptV1,
  SignalOpsOperationTraceV1,
} from "@/lib/signalops/v1/operation-trace";

type TraceResponseV1 =
  | { ok: true; trace: SignalOpsOperationTraceV1 }
  | { ok: false; code: string };

function formatDuration(value: number | null): string {
  if (value === null) return "Not reported";
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

function formatMoney(amount: string, currency: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: value < 1 ? 3 : 2,
      maximumFractionDigits: value < 1 ? 4 : 2,
    }).format(value);
  } catch {
    return `${amount} ${currency}`;
  }
}

function formatTimestamp(value: string | null): string {
  if (!value) return "Not observed";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

function statusTone(status: string): string {
  if (status === "succeeded") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (status === "running") return "bg-blue-50 text-blue-700 ring-blue-200";
  if (status === "cancelled") return "bg-slate-50 text-slate-700 ring-slate-200";
  return "bg-rose-50 text-rose-700 ring-rose-200";
}

function eventLabel(type: SignalOpsOperationTraceV1["events"][number]["type"]): string {
  return type
    .replace("com.signalops.ai.", "")
    .replace(".v1", "")
    .replaceAll(".", " ");
}

function qualitySummary(trace: SignalOpsOperationTraceV1): string {
  const issues: string[] = [];
  if (!trace.telemetry.acceptedSeen) issues.push("missing acceptance");
  if (!trace.telemetry.operationTerminalSeen) issues.push("missing terminal outcome");
  if (trace.telemetry.missingAttemptStarts > 0) {
    issues.push(`${trace.telemetry.missingAttemptStarts} missing attempt start`);
  }
  if (trace.telemetry.missingAttemptTerminals > 0) {
    issues.push(`${trace.telemetry.missingAttemptTerminals} missing attempt terminal`);
  }
  if (trace.telemetry.contradictoryTerminals > 0) {
    issues.push(`${trace.telemetry.contradictoryTerminals} contradictory terminal`);
  }
  if (trace.telemetry.identityCollisions > 0) {
    issues.push(`${trace.telemetry.identityCollisions} identity collision`);
  }
  if (trace.telemetry.truncated) issues.push("trace limit exceeded");
  return issues.length === 0 ? "Every expected lifecycle boundary is present." : issues.join(" · ");
}

function AttemptCard({ attempt }: { attempt: SignalOpsOperationTraceAttemptV1 }) {
  return (
    <article className="relative rounded-xl border border-[var(--border)] bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--accent)]">
            Attempt {attempt.number}
          </p>
          <p className="mt-1 max-w-[420px] truncate font-mono text-[11px] font-semibold text-[var(--text-strong)]" title={attempt.id}>
            {attempt.id}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ${statusTone(attempt.status)}`}>
          {attempt.status}
        </span>
      </div>

      <div className="mt-4 flex items-start gap-3 rounded-lg bg-[var(--surface-mute)] p-3">
        <Route className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[var(--text-strong)]">
            {attempt.route.providerVendor || attempt.route.providerKey}
          </p>
          <p className="mt-1 break-all font-mono text-[10px] text-[var(--text-dim)]">
            {attempt.route.providerKey} / {attempt.route.modelKey}
          </p>
          {attempt.route.providerModelKey || attempt.route.region ? (
            <p className="mt-1 break-all font-mono text-[9px] text-[var(--mute)]">
              {[attempt.route.providerModelKey, attempt.route.region].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <TraceDatum label="Duration" value={formatDuration(attempt.durationMs)} />
        <TraceDatum label="Queue" value={formatDuration(attempt.queueDurationMs)} />
        <TraceDatum label="Output" value={attempt.outputUnits === null ? "Not reported" : String(attempt.outputUnits)} />
        <TraceDatum
          label="Cost"
          value={attempt.cost ? formatMoney(attempt.cost.amount, attempt.cost.currency) : "Not reported"}
          detail={attempt.cost?.source.replaceAll("_", " ")}
        />
      </dl>

      <div className="mt-4 grid gap-2 text-[10px] text-[var(--text-dim)] sm:grid-cols-2">
        <p><span className="font-semibold text-[var(--text)]">Started:</span> {formatTimestamp(attempt.startedAt)}</p>
        <p><span className="font-semibold text-[var(--text)]">Terminal:</span> {formatTimestamp(attempt.terminalAt)}</p>
      </div>

      {attempt.failure ? (
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-800">
          <div className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="text-xs font-semibold">{attempt.failure.category.replaceAll("_", " ")}</p>
              <p className="mt-1 font-mono text-[9px]">
                {attempt.failure.code || "No normalized failure code"} · {attempt.failure.responsibility}
                {attempt.failure.retryable ? " · retryable" : ""}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function TraceDatum({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div>
      <dt className="font-mono text-[8px] font-bold uppercase tracking-[0.08em] text-[var(--mute)]">{label}</dt>
      <dd className="mt-1 text-xs font-semibold text-[var(--text-strong)]">{value}</dd>
      {detail ? <dd className="mt-0.5 text-[9px] text-[var(--mute)]">{detail}</dd> : null}
    </div>
  );
}

function TraceContent({ trace }: { trace: SignalOpsOperationTraceV1 }) {
  const qualityTone = trace.telemetry.complete
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : "border-amber-200 bg-amber-50 text-amber-900";
  return (
    <div className="px-5 pb-8 sm:px-7">
      <section className={`rounded-xl border p-4 ${qualityTone}`}>
        <div className="flex items-start gap-3">
          {trace.telemetry.complete ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          ) : (
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          )}
          <div>
            <p className="text-xs font-semibold">
              {trace.telemetry.complete ? "Lifecycle evidence complete" : "Lifecycle evidence needs attention"}
            </p>
            <p className="mt-1 text-[10px] leading-4 opacity-85">{qualitySummary(trace)}</p>
          </div>
        </div>
      </section>

      <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <TraceDatum label="Status" value={trace.operation.status} />
        <TraceDatum label="Duration" value={formatDuration(trace.operation.durationMs)} />
        <TraceDatum label="Attempts" value={String(trace.attempts.length)} detail={`${trace.telemetry.pairedAttempts} paired`} />
        <TraceDatum label="Evidence" value={String(trace.events.length)} detail="canonical observations" />
      </dl>

      {trace.operation.failure ? (
        <section className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="text-xs font-semibold">Operation failed: {trace.operation.failure.category.replaceAll("_", " ")}</p>
              <p className="mt-1 font-mono text-[9px] leading-4">
                {trace.operation.failure.code || "No normalized failure code"} · {trace.operation.failure.responsibility}
                {trace.operation.failure.retryable ? " · retryable" : ""}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="mt-7">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-strong)]">Provider attempts</h3>
            <p className="mt-1 text-[10px] text-[var(--text-dim)]">Concrete execution routes in canonical attempt order</p>
          </div>
          <span className="font-mono text-[9px] text-[var(--mute)]">{trace.attempts.length} total</span>
        </div>
        {trace.attempts.length > 0 ? (
          <div className="mt-4 grid gap-3">
            {trace.attempts.map((attempt) => <AttemptCard key={attempt.id} attempt={attempt} />)}
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-mute)] p-6 text-center">
            <Activity className="mx-auto size-5 text-[var(--mute)]" />
            <p className="mt-2 text-xs text-[var(--text-dim)]">No explicit provider attempt was observed for this operation.</p>
          </div>
        )}
      </section>

      <section className="mt-7">
        <h3 className="text-sm font-semibold text-[var(--text-strong)]">Canonical evidence</h3>
        <p className="mt-1 text-[10px] text-[var(--text-dim)]">Sanitized lifecycle index; source payloads and attributes are excluded</p>
        <ol className="mt-4 border-l border-[var(--border)] pl-5">
          {trace.events.map((event) => (
            <li key={event.eventId} className="relative pb-5 last:pb-0">
              <span className="absolute -left-[23px] top-1 size-1.5 rounded-full bg-[var(--accent)] ring-4 ring-white" />
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold capitalize text-[var(--text-strong)]">{eventLabel(event.type)}</p>
                  <p className="mt-1 max-w-[420px] truncate font-mono text-[9px] text-[var(--mute)]" title={event.eventId}>{event.eventId}</p>
                </div>
                <time className="font-mono text-[9px] text-[var(--text-dim)]">{formatTimestamp(event.occurredAt)}</time>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export function OperationTraceDrawer({
  operationId,
  onClose,
  finalFocus,
}: {
  operationId: string;
  onClose: () => void;
  finalFocus: RefObject<HTMLElement | null>;
}) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [trace, setTrace] = useState<SignalOpsOperationTraceV1 | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setState("loading");
    try {
      const response = await fetch(
        `/v1/ops/operations/${encodeURIComponent(operationId)}`,
        { cache: "no-store", signal },
      );
      const body = (await response.json()) as TraceResponseV1;
      if (!response.ok || !body.ok) throw new Error("operation trace unavailable");
      setTrace(body.trace);
      setState("ready");
    } catch (error) {
      if ((error as DOMException).name === "AbortError") return;
      setTrace(null);
      setState("error");
    }
  }, [operationId]);

  useEffect(() => {
    const controller = new AbortController();
    const initial = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(initial);
      controller.abort();
    };
  }, [load]);

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-slate-950/35 backdrop-blur-[2px] transition-opacity" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex justify-end">
          <Dialog.Popup
            finalFocus={finalFocus}
            className="h-dvh w-full max-w-[680px] overflow-y-auto border-l border-[var(--border)] bg-[#f8faff] shadow-2xl outline-none"
          >
            <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-white/95 px-5 py-5 backdrop-blur sm:px-7">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--accent)]">Operation trace</p>
                  <Dialog.Title className="mt-1 truncate text-lg font-semibold text-[var(--text-strong)]" title={operationId}>
                    {operationId}
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-[10px] text-[var(--text-dim)]">
                    Tenant-scoped lifecycle, route, failure, latency, and cost evidence
                  </Dialog.Description>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void load()}
                    disabled={state === "loading"}
                    aria-label="Refresh operation trace"
                    className="grid size-9 place-items-center rounded-lg border border-[var(--border)] bg-white text-[var(--text-dim)] hover:text-[var(--accent)] disabled:opacity-50"
                  >
                    <RefreshCw className={`size-4 ${state === "loading" ? "animate-spin" : ""}`} />
                  </button>
                  <Dialog.Close className="grid size-9 place-items-center rounded-lg border border-[var(--border)] bg-white text-[var(--text-dim)] hover:text-[var(--text-strong)]" aria-label="Close operation trace">
                    <X className="size-4" />
                  </Dialog.Close>
                </div>
              </div>
            </header>

            <div className="pt-5" aria-live="polite">
              {state === "loading" ? (
                <div className="grid min-h-[420px] place-items-center px-6 text-sm font-medium text-[var(--text-dim)]">
                  <div className="flex items-center gap-3"><RefreshCw className="size-4 animate-spin" /> Loading canonical evidence…</div>
                </div>
              ) : state === "error" || !trace ? (
                <div className="mx-5 rounded-xl border border-rose-200 bg-white p-7 text-center shadow-sm sm:mx-7">
                  <TriangleAlert className="mx-auto size-6 text-rose-600" />
                  <h3 className="mt-3 text-sm font-semibold text-[var(--text-strong)]">Trace is unavailable</h3>
                  <p className="mt-2 text-xs leading-5 text-[var(--text-dim)]">The operation may have aged out of retention, or the indexed observation store could not be reached.</p>
                  <button type="button" onClick={() => void load()} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white">
                    Try again <ArrowRight className="size-3.5" />
                  </button>
                </div>
              ) : (
                <TraceContent trace={trace} />
              )}
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
