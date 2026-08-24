"use client";

import { CheckCircle2, CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

type Readiness = {
  ok: boolean;
  productionReady: boolean;
  publicBetaReady: boolean;
  contract: string;
  checks?: {
    storage?: string;
    storageReachable?: boolean;
    operatorAuth?: { supabase?: boolean };
    ingestAuth?: boolean;
    alerting?: boolean;
    publicSignup?: boolean;
    pilotRequests?: boolean;
  };
};

export function ServiceStatus() {
  const [status, setStatus] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const response = await fetch("/api/readiness", { cache: "no-store" });
      setStatus((await response.json()) as Readiness);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  function refresh() {
    setLoading(true);
    void load();
  }

  const healthy = Boolean(status?.ok && status.publicBetaReady);
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <span className={`grid size-11 place-items-center rounded-xl ${healthy ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-700"}`}>
            {loading ? <LoaderCircle className="size-5 animate-spin" /> : healthy ? <CheckCircle2 className="size-5" /> : <CircleAlert className="size-5" />}
          </span>
          <div>
            <h2 className="text-xl font-semibold text-[var(--text-strong)]">{loading ? "Checking service readiness…" : healthy ? "All public-beta launch checks pass" : "Public-beta readiness needs attention"}</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">Live deployment checks, not a contractual uptime statement. Canonical contract: {status?.contract ?? "ai-telemetry/v1"}.</p>
          </div>
        </div>
        <button type="button" onClick={refresh} disabled={loading} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-3 text-xs font-bold text-[var(--text-dim)] hover:text-[var(--accent)]"><RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
      </div>
      {status?.checks ? (
        <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatusFact label="Durable storage" value={status.checks.storageReachable ? status.checks.storage ?? "reachable" : "unavailable"} good={Boolean(status.checks.storageReachable)} />
          <StatusFact label="Operator identity" value={status.checks.operatorAuth?.supabase ? "configured" : "unavailable"} good={Boolean(status.checks.operatorAuth?.supabase)} />
          <StatusFact label="Protected ingest" value={status.checks.ingestAuth ? "configured" : "unavailable"} good={Boolean(status.checks.ingestAuth)} />
          <StatusFact label="Incident delivery" value={status.checks.alerting ? "configured" : "unavailable"} good={Boolean(status.checks.alerting)} />
          <StatusFact label="Public onboarding" value={status.checks.publicSignup ? "enabled" : "closed"} good={Boolean(status.checks.publicSignup)} />
          <StatusFact label="Beta request delivery" value={status.checks.pilotRequests ? "configured" : "unavailable"} good={Boolean(status.checks.pilotRequests)} />
        </div>
      ) : null}
    </section>
  );
}

function StatusFact({ label, value, good }: { label: string; value: string; good: boolean }) {
  return <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-mute)] p-4"><p className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--mute)]">{label}</p><p className={`mt-2 text-sm font-bold ${good ? "text-emerald-700" : "text-amber-800"}`}>{value}</p></div>;
}
