"use client";

import {
  AlertTriangle,
  ArrowLeft,
  BellRing,
  CheckCircle2,
  Clock3,
  History,
  Loader2,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";

import type {
  SignalOpsIncidentTransitionV1,
  SignalOpsIncidentV1,
} from "@/lib/signalops/v1/incidents";
import type { SignalOpsOperatorRoleV1 } from "@/lib/signalops/v1/operator-directory";

type DetailResponse =
  | {
      ok: true;
      incident: SignalOpsIncidentV1;
      history: SignalOpsIncidentTransitionV1[];
    }
  | { ok: false; code: string };

type SessionResponse = {
  ok: boolean;
  session: null | { role: SignalOpsOperatorRoleV1 };
};

function relativeTime(value: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1_000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function readableKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function formatEvidenceValue(incident: SignalOpsIncidentV1, key: string, value: unknown) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value !== "number") return String(value);
  const ratioMetric = incident.metric.includes("rate") || incident.metric.includes("coverage");
  if (
    ratioMetric &&
    ["observedValue", "objective", "warningThreshold", "criticalThreshold", "failureRate"].includes(key)
  ) {
    return `${(value * 100).toFixed(1)}%`;
  }
  if (/duration|freshness/i.test(incident.metric) && /value|threshold|objective/i.test(key)) {
    return value >= 1_000 ? `${(value / 1_000).toFixed(1)}s` : `${Math.round(value)}ms`;
  }
  if (/duration/i.test(key)) {
    return value >= 1_000 ? `${(value / 1_000).toFixed(1)}s` : `${Math.round(value)}ms`;
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value);
}

function stateTone(incident: SignalOpsIncidentV1): string {
  if (incident.state === "resolved") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (incident.state === "acknowledged") return "bg-blue-50 text-blue-700 ring-blue-200";
  return incident.severity === "critical"
    ? "bg-rose-50 text-rose-700 ring-rose-200"
    : "bg-amber-50 text-amber-800 ring-amber-200";
}

export function LiveIncidentDetail({ incidentId }: { incidentId: string }) {
  const [incident, setIncident] = useState<SignalOpsIncidentV1 | null>(null);
  const [history, setHistory] = useState<SignalOpsIncidentTransitionV1[]>([]);
  const [role, setRole] = useState<SignalOpsOperatorRoleV1 | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unauthorized" | "not_found" | "error">("loading");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");

  const load = useCallback(async () => {
    try {
      const [detailResponse, sessionResponse] = await Promise.all([
        fetch(`/v1/incidents/${encodeURIComponent(incidentId)}`, { cache: "no-store" }),
        fetch("/api/cockpit/session", { cache: "no-store" }),
      ]);
      const [detailBody, sessionBody] = (await Promise.all([
        detailResponse.json(),
        sessionResponse.json(),
      ])) as [DetailResponse, SessionResponse];
      setRole(sessionBody.session?.role ?? null);
      if (detailResponse.status === 401) {
        setState("unauthorized");
        return;
      }
      if (detailResponse.status === 404) {
        setState("not_found");
        return;
      }
      if (!detailResponse.ok || !detailBody.ok) throw new Error("incident unavailable");
      setIncident(detailBody.incident);
      setHistory(detailBody.history);
      setNote(detailBody.incident.acknowledgementNote ?? "");
      setState("ready");
    } catch {
      setState("error");
    }
  }, [incidentId]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initial);
  }, [load]);

  async function updateAcknowledgement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!incident || incident.state === "resolved") return;
    setSubmitting(true);
    setActionError("");
    try {
      const response = await fetch(`/v1/incidents/${encodeURIComponent(incident.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: incident.state === "acknowledged" ? "unacknowledge" : "acknowledge",
          note,
        }),
      });
      const body = (await response.json()) as DetailResponse;
      if (!response.ok || !body.ok) {
        throw new Error("code" in body ? body.code : "incident_action_failed");
      }
      setIncident(body.incident);
      setHistory(body.history);
      setNote(body.incident.acknowledgementNote ?? "");
    } catch (error) {
      setActionError(
        error instanceof Error && error.message === "incident_resolved"
          ? "This incident recovered before it could be acknowledged."
          : "The incident state could not be updated. Try again.",
      );
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  if (state === "loading") {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f8faff] text-[var(--text-dim)]">
        <div className="flex items-center gap-3 text-sm font-medium"><Loader2 className="size-4 animate-spin" /> Loading live incident…</div>
      </main>
    );
  }

  if (state !== "ready" || !incident) {
    const unauthorized = state === "unauthorized";
    const notFound = state === "not_found";
    return (
      <main className="grid min-h-screen place-items-center bg-[#f8faff] px-5">
        <section className="max-w-md rounded-xl border border-[var(--border)] bg-white p-7 text-center shadow-[var(--shadow-1)]">
          <AlertTriangle className="mx-auto size-7 text-amber-600" />
          <h1 className="mt-4 text-xl font-semibold">{unauthorized ? "Operator session required" : notFound ? "Incident not found" : "Incident unavailable"}</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">{unauthorized ? "Open the cockpit and sign in to the workspace that owns this incident." : notFound ? "This identifier does not exist in your current workspace." : "SignalOps could not read the incident record."}</p>
          <a href="/cockpit" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent)] hover:underline"><ArrowLeft className="size-4" /> Back to cockpit</a>
        </section>
      </main>
    );
  }

  const canAcknowledge = role === "owner" || role === "operator";
  const evidence = Object.entries(incident.evidence).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_12%_0%,rgba(52,89,223,0.09),transparent_34%),#f8faff] px-4 py-6 text-[var(--text)] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <a href="/cockpit" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-dim)] hover:text-[var(--accent)]"><ArrowLeft className="size-4" /> Back to live cockpit</a>

        <header className="mt-5 rounded-2xl border border-[var(--border)] bg-white p-6 shadow-[var(--shadow-panel)] sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ring-1 ${stateTone(incident)}`}>{incident.state}</span>
                <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[10px] font-bold uppercase text-slate-700 ring-1 ring-slate-200">{incident.severity}</span>
                <span className="font-mono text-[10px] text-[var(--mute)]">{incident.id}</span>
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-[var(--text-strong)]">{incident.title}</h1>
              <p className="mt-3 font-mono text-xs text-[var(--text-dim)]">{incident.metric} · policy {incident.policyVersion}</p>
            </div>
            <div className="grid shrink-0 grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <HeaderFact label="Opened" value={relativeTime(incident.openedAt)} />
              <HeaderFact label="Observed" value={relativeTime(incident.lastObservedAt)} />
              <HeaderFact label="Alert rev" value={String(incident.alertVersion)} />
            </div>
          </div>
        </header>

        <div className="mt-5 grid items-start gap-5 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-xl border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)] sm:p-6">
            <div className="flex items-center gap-2"><ShieldCheck className="size-4 text-[var(--accent)]" /><h2 className="text-sm font-semibold">Measured evidence</h2></div>
            <p className="mt-1 text-[11px] text-[var(--text-dim)]">The evaluator stores the latest observed value, sample, and exact versioned thresholds. Every lifecycle transition retains its boundary evidence.</p>
            <dl className="mt-5 grid gap-3 sm:grid-cols-2">
              {evidence.map(([key, value]) => (
                <div key={key} className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface-mute)] p-3">
                  <dt className="font-mono text-[9px] uppercase tracking-wide text-[var(--mute)]">{readableKey(key)}</dt>
                  <dd className="mt-2 break-words text-sm font-semibold text-[var(--text-strong)]">{formatEvidenceValue(incident, key, value)}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="rounded-xl border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)] sm:p-6">
            <div className="flex items-center gap-2"><UserCheck className="size-4 text-[var(--accent)]" /><h2 className="text-sm font-semibold">Incident ownership</h2></div>
            {incident.state === "resolved" ? (
              <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
                <div className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="size-4" /> Automatically recovered</div>
                <p className="mt-2 text-xs leading-5">Resolved {incident.resolvedAt ? relativeTime(incident.resolvedAt) : "after the last evaluation"}. The recovery boundary remains recorded in the lifecycle below.</p>
              </div>
            ) : canAcknowledge ? (
              <form className="mt-5" onSubmit={updateAcknowledgement}>
                {incident.state === "acknowledged" ? (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-blue-900">
                    <p className="text-sm font-semibold">Acknowledged by {incident.acknowledgedBy ?? "an operator"}</p>
                    <p className="mt-1 text-xs">{incident.acknowledgedAt ? relativeTime(incident.acknowledgedAt) : "recently"}</p>
                    {incident.acknowledgementNote ? <p className="mt-3 text-xs leading-5">{incident.acknowledgementNote}</p> : null}
                  </div>
                ) : (
                  <>
                    <label htmlFor="acknowledgement-note" className="text-xs font-semibold text-[var(--text-strong)]">Ownership note</label>
                    <textarea id="acknowledgement-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={4} placeholder="What are you investigating? No prompts, customer identities, or secrets." className="mt-2 w-full resize-y rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]" />
                  </>
                )}
                <button type="submit" disabled={submitting} className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-60">
                  {submitting ? <Loader2 className="size-4 animate-spin" /> : <BellRing className="size-4" />}
                  {incident.state === "acknowledged" ? "Return to unowned queue" : "Acknowledge incident"}
                </button>
                {actionError ? <p className="mt-3 text-xs font-medium text-rose-700" aria-live="polite">{actionError}</p> : null}
              </form>
            ) : (
              <p className="mt-5 rounded-lg bg-slate-50 p-4 text-xs leading-5 text-slate-700 ring-1 ring-slate-200">Viewer access is read-only. An owner or operator can acknowledge this incident.</p>
            )}
          </section>
        </div>

        <section className="mt-5 rounded-xl border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)] sm:p-6">
          <div className="flex items-center gap-2"><History className="size-4 text-[var(--accent)]" /><h2 className="text-sm font-semibold">Lifecycle history</h2></div>
          <p className="mt-1 text-[11px] text-[var(--text-dim)]">Evaluator and operator transitions are append-only and tenant-scoped.</p>
          {history.length === 0 ? (
            <p className="mt-5 rounded-lg bg-slate-50 p-4 text-xs text-slate-600 ring-1 ring-slate-200">This incident predates lifecycle history. Its current state remains authoritative.</p>
          ) : (
            <ol className="mt-5 space-y-3">
              {[...history].reverse().map((transition) => (
                <li key={transition.id} className="grid gap-3 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-mute)] p-4 sm:grid-cols-[auto_1fr_auto] sm:items-start">
                  <span className="grid size-8 place-items-center rounded-lg bg-white text-[var(--accent)] ring-1 ring-[var(--border)]"><Clock3 className="size-4" /></span>
                  <div><p className="text-xs font-semibold capitalize text-[var(--text-strong)]">{transition.type.replaceAll("_", " ")}</p><p className="mt-1 font-mono text-[9px] text-[var(--mute)]">{transition.actorSubject} · {transition.fromState ?? "none"} → {transition.toState} · alert rev {transition.alertVersion}</p></div>
                  <time className="text-[10px] text-[var(--text-dim)]" dateTime={transition.createdAt}>{relativeTime(transition.createdAt)}</time>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </main>
  );
}

function HeaderFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[96px] rounded-lg border border-[var(--border)] bg-[var(--surface-mute)] p-3">
      <p className="font-mono text-[8px] uppercase tracking-wide text-[var(--mute)]">{label}</p>
      <p className="mt-1 text-xs font-semibold text-[var(--text-strong)]">{value}</p>
    </div>
  );
}
