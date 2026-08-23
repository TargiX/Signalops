"use client";

import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Database,
  DollarSign,
  LogOut,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";

import type {
  SignalOpsOpsRangeV1,
  SignalOpsOpsSnapshotV1,
} from "@/lib/signalops/v1/ops-snapshot";

type SnapshotResponse =
  | { ok: true; snapshot: SignalOpsOpsSnapshotV1 }
  | { ok: false; code: string };

function formatNumber(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function formatDuration(value: number | null): string {
  if (value === null) return "—";
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 1 ? 3 : 2,
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

function relativeTime(value: string | null): string {
  if (!value) return "No events yet";
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1_000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3_600)}h ago`;
}

function statusTone(status: string): string {
  if (status === "succeeded") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (status === "running") return "bg-blue-50 text-blue-700 ring-blue-200";
  return "bg-rose-50 text-rose-700 ring-rose-200";
}

export function LiveCockpit() {
  const [range, setRange] = useState<SignalOpsOpsRangeV1>("90d");
  const [snapshot, setSnapshot] = useState<SignalOpsOpsSnapshotV1 | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unauthorized" | "error">("loading");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/v1/ops/snapshot?range=${range}`, { cache: "no-store" });
      const body = (await response.json()) as SnapshotResponse;
      if (response.status === 401) {
        setSnapshot(null);
        setState("unauthorized");
        return;
      }
      if (!response.ok || !body.ok) throw new Error("snapshot unavailable");
      setSnapshot(body.snapshot);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [range]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initial);
  }, [load]);

  useEffect(() => {
    if (state !== "ready") return;
    const interval = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(interval);
  }, [load, state]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setLoginError("");
    try {
      const response = await fetch("/api/cockpit/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        setLoginError(response.status === 503 ? "Operator access is not configured." : "Password not recognized.");
        return;
      }
      setPassword("");
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    await fetch("/api/cockpit/session", { method: "DELETE" });
    setSnapshot(null);
    setState("unauthorized");
  }

  if (state === "unauthorized") {
    return (
      <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_50%_0%,rgba(52,89,223,0.14),transparent_42%),#f8faff] px-5 py-10">
        <section className="w-full max-w-[440px] rounded-2xl border border-[var(--border)] bg-white p-7 shadow-[var(--shadow-panel)] sm:p-9">
          <div className="grid size-11 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <ShieldCheck className="size-5" />
          </div>
          <p className="mt-7 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--accent)]">SignalOps workspace</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--text-strong)]">Open your live cockpit</h1>
          <p className="mt-3 text-sm leading-6 text-[var(--text-dim)]">
            This creates a separate SignalOps operator session. Phosphene only receives a service credential and never sends prompts, email addresses, or user identity.
          </p>
          <form className="mt-7" onSubmit={login}>
            <label className="text-xs font-semibold text-[var(--text)]" htmlFor="workspace-password">Workspace password</label>
            <input
              id="workspace-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm shadow-sm"
              required
            />
            {loginError ? <p className="mt-2 text-xs font-medium text-rose-600">{loginError}</p> : null}
            <button
              type="submit"
              disabled={submitting}
              className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-60"
            >
              {submitting ? "Opening…" : "Enter live cockpit"}
              <ArrowRight className="size-4" />
            </button>
          </form>
          <a className="mt-5 inline-flex text-xs font-semibold text-[var(--text-dim)] hover:text-[var(--accent)]" href="/cockpit?mode=demo">
            Open the synthetic product demo instead
          </a>
        </section>
      </main>
    );
  }

  if (state === "loading") {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f8faff] text-[var(--text-dim)]">
        <div className="flex items-center gap-3 text-sm font-medium"><RefreshCw className="size-4 animate-spin" /> Loading live operations…</div>
      </main>
    );
  }

  if (state === "error" || !snapshot) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f8faff] px-5">
        <section className="max-w-md rounded-xl border border-rose-200 bg-white p-6 text-center shadow-sm">
          <TriangleAlert className="mx-auto size-6 text-rose-600" />
          <h1 className="mt-3 text-lg font-semibold">Live storage is unavailable</h1>
          <p className="mt-2 text-sm text-[var(--text-dim)]">The cockpit kept your session, but could not read canonical events.</p>
          <button className="mt-5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white" onClick={() => void load()}>Try again</button>
        </section>
      </main>
    );
  }

  const reconciledCost = snapshot.totals.cost.billing_reconciled + snapshot.totals.cost.provider_reported;
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_78%_0%,rgba(52,89,223,0.10),transparent_28%),#f8faff] text-[var(--text)]">
      <div className="mx-auto w-full max-w-[1440px] px-5 py-6 sm:px-8 lg:px-10">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] pb-5">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-[var(--accent)] text-white"><Activity className="size-4" /></div>
            <div>
              <div className="flex items-center gap-2"><span className="text-sm font-bold text-[var(--text-strong)]">SignalOps</span><span className="rounded-full bg-emerald-50 px-2 py-0.5 font-mono text-[9px] font-bold uppercase text-emerald-700 ring-1 ring-emerald-200">Live</span></div>
              <p className="mt-0.5 text-xs text-[var(--text-dim)]">{snapshot.tenant.name} · {snapshot.tenant.id}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a href="/cockpit?mode=demo" className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs font-semibold text-[var(--text-dim)] hover:text-[var(--accent)]">Demo</a>
            <button onClick={() => void load()} className="grid size-9 place-items-center rounded-lg border border-[var(--border)] bg-white text-[var(--text-dim)] hover:text-[var(--accent)]" aria-label="Refresh"><RefreshCw className="size-4" /></button>
            <button onClick={() => void logout()} className="grid size-9 place-items-center rounded-lg border border-[var(--border)] bg-white text-[var(--text-dim)] hover:text-rose-600" aria-label="Sign out"><LogOut className="size-4" /></button>
          </div>
        </header>

        <section className="mt-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--accent)]">Canonical AI telemetry v1</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--text-strong)] sm:text-4xl">Generation operations</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--text-dim)]">
              <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-emerald-500" /> Last signal {relativeTime(snapshot.freshness.lastReceivedAt)}</span>
              {snapshot.environments.map((environment) => <span key={environment} className="rounded-full border border-[var(--border)] bg-white px-2 py-0.5 font-mono text-[10px]">{environment}</span>)}
            </div>
          </div>
          <div className="flex rounded-lg border border-[var(--border)] bg-white p-1 shadow-sm">
            {(["24h", "7d", "30d", "90d"] as const).map((value) => (
              <button key={value} onClick={() => { setState("loading"); setRange(value); }} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${range === value ? "bg-[var(--accent)] text-white" : "text-[var(--text-dim)] hover:text-[var(--text)]"}`}>{value}</button>
            ))}
          </div>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Metric icon={Database} label="Operations" value={formatNumber(snapshot.totals.operations)} detail={`${formatNumber(snapshot.totals.attempts)} attempts`} />
          <Metric icon={CheckCircle2} label="Success rate" value={formatPercent(snapshot.totals.successRate)} detail={`${formatNumber(snapshot.totals.failed)} failed`} />
          <Metric icon={Clock3} label="Operation p95" value={formatDuration(snapshot.totals.p95DurationMs)} detail="terminal duration" />
          <Metric icon={RefreshCw} label="Retry pressure" value={formatNumber(snapshot.totals.retryableFailures)} detail="retryable failures" />
          <Metric icon={DollarSign} label="Reported cost" value={formatMoney(reconciledCost)} detail={`${formatMoney(snapshot.totals.cost.catalog_estimate)} estimated`} />
        </section>

        <section className="mt-6 grid gap-5 xl:grid-cols-[0.95fr_1.35fr]">
          <Panel title="Provider and model health" subtitle="Attempts, latency, outcome, and cost without customer data">
            {snapshot.providers.length === 0 ? <EmptyState text="Provider attempts will appear after Phosphene delivers its first terminal attempt." /> : (
              <div className="divide-y divide-[var(--border-soft)]">
                {snapshot.providers.map((provider) => (
                  <div key={`${provider.providerKey}:${provider.modelKey}`} className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                    <div><p className="text-sm font-semibold text-[var(--text-strong)]">{provider.providerVendor || provider.providerKey}</p><p className="mt-1 font-mono text-[10px] text-[var(--text-dim)]">{provider.providerKey} / {provider.modelKey}</p></div>
                    <div className="grid grid-cols-3 gap-5 text-right"><Mini label="Attempts" value={formatNumber(provider.attempts)} /><Mini label="p95" value={formatDuration(provider.p95DurationMs)} /><Mini label="Success" value={formatPercent(provider.successRate)} /></div>
                    <span className={`justify-self-start rounded-full px-2 py-1 text-[10px] font-bold ring-1 sm:justify-self-end ${provider.failed > 0 ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200"}`}>{provider.failed > 0 ? `${provider.failed} failed` : "Healthy"}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Recent operations" subtitle="Opaque operation IDs only; no prompt, media URL, email, or user identifier">
            {snapshot.recentOperations.length === 0 ? <EmptyState text="The pipeline is connected. Make a Phosphene generation to populate this table." /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left">
                  <thead><tr className="border-b border-[var(--border)] font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--mute)]"><th className="pb-3 font-semibold">Operation</th><th className="pb-3 font-semibold">Status</th><th className="pb-3 font-semibold">Model class</th><th className="pb-3 font-semibold">Duration</th><th className="pb-3 font-semibold">Attempts</th><th className="pb-3 text-right font-semibold">Seen</th></tr></thead>
                  <tbody className="divide-y divide-[var(--border-soft)]">
                    {snapshot.recentOperations.map((operation) => (
                      <tr key={operation.operationId} className="text-xs"><td className="py-3.5"><p className="max-w-[180px] truncate font-mono text-[10px] font-semibold text-[var(--text-strong)]">{operation.operationId}</p><p className="mt-1 text-[10px] text-[var(--text-dim)]">{operation.service} · {operation.environment}</p></td><td className="py-3.5"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ring-1 ${statusTone(operation.status)}`}>{operation.status}</span></td><td className="py-3.5 text-[var(--text-dim)]">{operation.logicalModelKey || operation.kind}</td><td className="py-3.5 font-medium">{formatDuration(operation.durationMs)}</td><td className="py-3.5 font-medium">{formatNumber(operation.attemptCount)}</td><td className="py-3.5 text-right text-[var(--text-dim)]">{relativeTime(operation.occurredAt)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </section>
        <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] py-5 text-[10px] text-[var(--mute)]"><span>Auto-refreshes every 10 seconds · snapshot generated {new Date(snapshot.generatedAt).toLocaleTimeString()}</span><a className="font-semibold hover:text-[var(--accent)]" href="/schemas/ai-telemetry/v1">Canonical schema</a></footer>
      </div>
    </main>
  );
}

function Metric({ icon: Icon, label, value, detail }: { icon: typeof Activity; label: string; value: string; detail: string }) {
  return <div className="rounded-xl border border-[var(--border)] bg-white p-4 shadow-[var(--shadow-1)]"><div className="flex items-center justify-between"><p className="font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--mute)]">{label}</p><Icon className="size-4 text-[var(--accent)]" /></div><p className="mt-4 text-2xl font-semibold tracking-tight text-[var(--text-strong)]">{value}</p><p className="mt-1 text-[10px] text-[var(--text-dim)]">{detail}</p></div>;
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)] sm:p-6"><div className="mb-5"><h2 className="text-sm font-semibold text-[var(--text-strong)]">{title}</h2><p className="mt-1 text-[11px] text-[var(--text-dim)]">{subtitle}</p></div>{children}</section>;
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div><p className="font-mono text-[8px] uppercase text-[var(--mute)]">{label}</p><p className="mt-1 text-xs font-semibold text-[var(--text-strong)]">{value}</p></div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-mute)] px-5 py-10 text-center"><Database className="mx-auto size-5 text-[var(--mute)]" /><p className="mx-auto mt-3 max-w-sm text-xs leading-5 text-[var(--text-dim)]">{text}</p></div>;
}
