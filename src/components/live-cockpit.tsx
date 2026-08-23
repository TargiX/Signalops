"use client";

import {
  Activity,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Database,
  DollarSign,
  ExternalLink,
  Gauge,
  LogOut,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

import {
  LatencyChart,
  PerformanceScatterChart,
  SpendDonutChart,
  ThroughputChart,
  TrafficAreaChart,
  type ChartProvider,
  type ChartTimeBucket,
} from "@/components/charts";
import { OperationTraceDrawer } from "@/components/operation-trace-drawer";
import type { SignalOpsIncidentV1 } from "@/lib/signalops/v1/incidents";
import {
  applySignalOpsCockpitRangeV1,
  filterSignalOpsOperationsV1,
  paginateSignalOpsRowsV1,
  readSignalOpsCockpitRangeV1,
  type SignalOpsOperationFilterV1,
} from "@/lib/signalops/v1/cockpit-view";
import type {
  SignalOpsCurrencyCostV1,
  SignalOpsCoverageMetricV1,
  SignalOpsOpsRangeV1,
  SignalOpsOpsSnapshotV1,
  SignalOpsProviderHealthV1,
} from "@/lib/signalops/v1/ops-snapshot";
import type {
  SignalOpsOperatorMembershipV1,
  SignalOpsOperatorRoleV1,
} from "@/lib/signalops/v1/operator-directory";
import type { SignalOpsSloEvaluationV1 } from "@/lib/signalops/v1/slo";

type SnapshotResponse =
  | { ok: true; snapshot: SignalOpsOpsSnapshotV1 }
  | { ok: false; code: string };

type SessionResponse = {
  ok: boolean;
  configured: boolean;
  auth: { password: boolean; supabase: boolean; emailOtp: boolean; providers: string[] };
  session: null | {
    tenantId: string;
    tenantName: string;
    subject: string;
    role: SignalOpsOperatorRoleV1;
    authMode: "password" | "supabase";
  };
  memberships: SignalOpsOperatorMembershipV1[];
};

type IncidentsResponse =
  | { ok: true; incidents: SignalOpsIncidentV1[] }
  | { ok: false; code: string };

type SlosResponse =
  | { ok: true; evaluations: SignalOpsSloEvaluationV1[] }
  | { ok: false; code: string };

const emptySession: SessionResponse = {
  ok: false,
  configured: false,
  auth: { password: false, supabase: false, emailOtp: false, providers: [] },
  session: null,
  memberships: [],
};

const chartColors = ["#3459df", "#24a17e", "#e6a23c", "#d24b63", "#7b61d1", "#168aad"];
const MODEL_PAGE_SIZE = 5;
const PROVIDER_PAGE_SIZE = 5;
const OPERATION_PAGE_SIZE = 10;
const cockpitRanges = ["24h", "7d", "30d", "90d"] as const;

type LoadMode = "initial" | "refresh";

type SelectedChartCost = {
  currency: string;
  source: "reported" | "estimated";
  value: number;
};

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

function formatSloValue(evaluation: SignalOpsSloEvaluationV1, value: number | null): string {
  if (evaluation.policy.metric.endsWith("_ms")) return formatDuration(value);
  return formatPercent(value);
}

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: value < 1 ? 3 : 2,
      maximumFractionDigits: value < 1 ? 4 : 2,
    }).format(value);
  } catch {
    return `${value.toFixed(value < 1 ? 4 : 2)} ${currency}`;
  }
}

function reportedCost(row: SignalOpsCurrencyCostV1): number {
  return row.billing_reconciled + row.provider_reported;
}

function selectChartCost(rows: SignalOpsCurrencyCostV1[]): SelectedChartCost | null {
  if (rows.length !== 1) return null;
  const row = rows[0];
  if (!row) return null;
  const reported = reportedCost(row);
  return reported > 0
    ? { currency: row.currency, source: "reported", value: reported }
    : {
        currency: row.currency,
        source: "estimated",
        value: row.catalog_estimate,
      };
}

function chartCostValue(
  rows: SignalOpsCurrencyCostV1[],
  selected: SelectedChartCost | null,
): number {
  if (!selected) return 0;
  const row = rows.find((cost) => cost.currency === selected.currency);
  if (!row) return 0;
  return selected.source === "reported" ? reportedCost(row) : row.catalog_estimate;
}

function timelineLabel(value: string, range: SignalOpsOpsRangeV1): string {
  const date = new Date(value);
  if (range === "24h") {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(date);
  }
  if (range === "7d") {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      hour: "numeric",
      timeZone: "UTC",
    }).format(date);
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function costSummary(rows: SignalOpsCurrencyCostV1[], source: "reported" | "estimated"): string {
  if (rows.length === 0) return "—";
  const formatted = rows.map((row) =>
    formatMoney(source === "reported" ? reportedCost(row) : row.catalog_estimate, row.currency),
  );
  return formatted.length <= 2 ? formatted.join(" · ") : `${formatted[0]} +${formatted.length - 1}`;
}

function relativeTime(value: string | null): string {
  if (!value) return "No events yet";
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1_000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function statusTone(status: string): string {
  if (status === "succeeded") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (status === "running") return "bg-blue-50 text-blue-700 ring-blue-200";
  if (status === "cancelled") return "bg-slate-50 text-slate-700 ring-slate-200";
  return "bg-rose-50 text-rose-700 ring-rose-200";
}

function healthTone(status: SignalOpsProviderHealthV1): string {
  if (status === "healthy") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (status === "degraded") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (status === "incident") return "bg-rose-50 text-rose-700 ring-rose-200";
  return "bg-slate-50 text-slate-600 ring-slate-200";
}

function authErrorMessage(): string {
  if (typeof window === "undefined") return "";
  const code = new URLSearchParams(window.location.search).get("auth");
  if (!code) return "";
  const messages: Record<string, string> = {
    "not-configured": "Team sign-in is not configured yet.",
    "provider-not-allowed": "That identity provider is not enabled for this workspace.",
    "rate-limited": "Too many sign-in attempts. Please wait and try again.",
    "start-failed": "Could not start sign-in. Please try again.",
    "callback-invalid": "The sign-in callback was incomplete. Please try again.",
    "callback-failed": "The identity provider could not complete sign-in.",
    "membership-required": "Your account is valid, but it is not a member of a SignalOps workspace.",
  };
  return messages[code] ?? "Sign-in could not be completed.";
}

function replaceCockpitRangeUrl(range: SignalOpsOpsRangeV1): void {
  if (typeof window === "undefined") return;
  try {
    const nextUrl = applySignalOpsCockpitRangeV1(new URL(window.location.href), range);
    window.history.replaceState(window.history.state, "", nextUrl);
  } catch {
    // URL state is an enhancement; live analysis must keep working if history is unavailable.
  }
}

export function LiveCockpit() {
  const [range, setRange] = useState<SignalOpsOpsRangeV1>(() =>
    typeof window === "undefined"
      ? "90d"
      : readSignalOpsCockpitRangeV1(window.location.search),
  );
  const initialRangeRef = useRef(range);
  const [pendingRange, setPendingRange] = useState<SignalOpsOpsRangeV1 | null>(null);
  const [snapshot, setSnapshot] = useState<SignalOpsOpsSnapshotV1 | null>(null);
  const [incidents, setIncidents] = useState<SignalOpsIncidentV1[]>([]);
  const [sloEvaluations, setSloEvaluations] = useState<SignalOpsSloEvaluationV1[]>([]);
  const [session, setSession] = useState<SessionResponse>(emptySession);
  const [state, setState] = useState<"loading" | "ready" | "unauthorized" | "error">("loading");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginNotice, setLoginNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [switchingTenant, setSwitchingTenant] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [operationFilter, setOperationFilter] = useState<SignalOpsOperationFilterV1>("all");
  const [operationPage, setOperationPage] = useState(1);
  const [modelPage, setModelPage] = useState(1);
  const [providerPage, setProviderPage] = useState(1);
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null);
  const snapshotRef = useRef<SignalOpsOpsSnapshotV1 | null>(null);
  const activeLoadRef = useRef<AbortController | null>(null);
  const loadSequenceRef = useRef(0);
  const sloSectionRef = useRef<HTMLElement>(null);
  const qualitySectionRef = useRef<HTMLElement>(null);
  const routeSectionRef = useRef<HTMLElement>(null);
  const operationSectionRef = useRef<HTMLDivElement>(null);
  const operationTraceTriggerRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async (
    requestedRange: SignalOpsOpsRangeV1,
    mode: LoadMode = "refresh",
  ) => {
    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    activeLoadRef.current?.abort();
    const controller = new AbortController();
    activeLoadRef.current = controller;

    if (mode === "initial" || !snapshotRef.current) {
      setState("loading");
    } else {
      setIsRefreshing(true);
      setRefreshError("");
    }

    try {
      const [snapshotResponse, sessionResponse] = await Promise.all([
        fetch(`/v1/ops/snapshot?range=${requestedRange}`, {
          cache: "no-store",
          signal: controller.signal,
        }),
        fetch("/api/cockpit/session", {
          cache: "no-store",
          signal: controller.signal,
        }),
      ]);
      const [snapshotBody, sessionBody] = (await Promise.all([
        snapshotResponse.json(),
        sessionResponse.json(),
      ])) as [SnapshotResponse, SessionResponse];
      if (sequence !== loadSequenceRef.current) return;
      setSession(sessionBody);
      if (snapshotResponse.status === 401) {
        snapshotRef.current = null;
        setSnapshot(null);
        setIncidents([]);
        setSloEvaluations([]);
        setState("unauthorized");
        return;
      }
      if (!snapshotResponse.ok || !snapshotBody.ok) throw new Error("snapshot unavailable");
      snapshotRef.current = snapshotBody.snapshot;
      setSnapshot(snapshotBody.snapshot);
      setRange(snapshotBody.snapshot.range);
      replaceCockpitRangeUrl(snapshotBody.snapshot.range);
      setState("ready");

      const [incidentsResponse, slosResponse] = await Promise.all([
        fetch("/v1/incidents?state=active&limit=20", {
          cache: "no-store",
          signal: controller.signal,
        }),
        fetch("/v1/slos", { cache: "no-store", signal: controller.signal }),
      ]);
      const [incidentsBody, slosBody] = (await Promise.all([
        incidentsResponse.json(),
        slosResponse.json(),
      ])) as [IncidentsResponse, SlosResponse];
      if (sequence !== loadSequenceRef.current) return;
      setIncidents(incidentsResponse.ok && incidentsBody.ok ? incidentsBody.incidents : []);
      setSloEvaluations(slosResponse.ok && slosBody.ok ? slosBody.evaluations : []);
    } catch (error) {
      if (
        sequence !== loadSequenceRef.current ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        return;
      }
      if (snapshotRef.current && mode === "refresh") {
        setRefreshError("Couldn’t refresh. Showing the last complete snapshot.");
        setState("ready");
      } else {
        setState("error");
      }
    } finally {
      if (sequence === loadSequenceRef.current) {
        activeLoadRef.current = null;
        setIsRefreshing(false);
        setPendingRange(null);
      }
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => {
      setLoginError(authErrorMessage());
      void load(initialRangeRef.current, "initial");
    }, 0);
    return () => {
      window.clearTimeout(initial);
      activeLoadRef.current?.abort();
    };
  }, [load]);

  useEffect(() => {
    if (state !== "ready" || isRefreshing) return;
    const interval = window.setInterval(() => void load(range, "refresh"), 10_000);
    return () => window.clearInterval(interval);
  }, [isRefreshing, load, range, state]);

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
      const body = (await response.json()) as { code?: string };
      if (!response.ok) {
        setLoginError(
          response.status === 429
            ? "Too many attempts. Please wait and try again."
            : response.status === 503
              ? "Operator access is not configured."
              : body.code === "origin_required"
                ? "This sign-in must be opened from the SignalOps cockpit."
                : "Password not recognized.",
        );
        return;
      }
      setPassword("");
      await load(range, "initial");
    } catch {
      setLoginError("SignalOps could not be reached. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function requestEmailLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setLoginError("");
    setLoginNotice("");
    try {
      const response = await fetch("/api/cockpit/auth/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = (await response.json()) as { code?: string };
      if (!response.ok) {
        setLoginError(
          response.status === 429
            ? "Too many requests. Please wait before asking for another link."
            : body.code === "invalid_email"
              ? "Enter a valid work email address."
              : "The secure sign-in link could not be sent.",
        );
        return;
      }
      setLoginNotice("Check your inbox for a secure SignalOps sign-in link.");
    } catch {
      setLoginError("SignalOps could not be reached. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function switchTenant(tenantId: string) {
    if (!tenantId || tenantId === snapshot?.tenant.id) return;
    setSwitchingTenant(true);
    setSelectedOperationId(null);
    try {
      const response = await fetch("/api/cockpit/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId }),
      });
      if (!response.ok) throw new Error("tenant switch rejected");
      snapshotRef.current = null;
      setSnapshot(null);
      setState("loading");
      await load(range, "initial");
    } catch {
      setState("error");
    } finally {
      setSwitchingTenant(false);
    }
  }

  async function logout() {
    activeLoadRef.current?.abort();
    await fetch("/api/cockpit/session", { method: "DELETE" });
    snapshotRef.current = null;
    setSnapshot(null);
    setIncidents([]);
    setSloEvaluations([]);
    setSelectedOperationId(null);
    setState("unauthorized");
    await load(range, "initial");
  }

  function selectRange(value: SignalOpsOpsRangeV1) {
    if (value === pendingRange || (!pendingRange && value === range)) return;
    setPendingRange(value);
    setSelectedOperationId(null);
    setOperationPage(1);
    setModelPage(1);
    setProviderPage(1);
    void load(value, "refresh");
  }

  function scrollToSection(ref: React.RefObject<HTMLElement | null>) {
    window.requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      ref.current?.focus({ preventScroll: true });
    });
  }

  function activateOperationFilter(filter: SignalOpsOperationFilterV1) {
    setOperationFilter(filter);
    setOperationPage(1);
    window.requestAnimationFrame(() => {
      operationSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      operationSectionRef.current?.focus({ preventScroll: true });
    });
  }

  function openOperationTrace(operationId: string, trigger: HTMLElement) {
    operationTraceTriggerRef.current = trigger;
    setSelectedOperationId(operationId);
  }

  if (state === "unauthorized") {
    const hasOAuth = session.auth.supabase && session.auth.providers.length > 0;
    const hasTeamAuth = hasOAuth || session.auth.emailOtp;
    return (
      <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_50%_0%,rgba(52,89,223,0.14),transparent_42%),#f8faff] px-5 py-10">
        <section className="w-full max-w-[460px] rounded-2xl border border-[var(--border)] bg-white p-7 shadow-[var(--shadow-panel)] sm:p-9">
          <div className="grid size-11 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <ShieldCheck className="size-5" />
          </div>
          <p className="mt-7 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--accent)]">SignalOps workspace</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--text-strong)]">Open your live cockpit</h1>
          <p className="mt-3 text-sm leading-6 text-[var(--text-dim)]">
            Sign in as a SignalOps operator. Source applications receive revocable service credentials and never share prompts, email addresses, or customer identity.
          </p>

          {session.auth.emailOtp ? (
            <form className="mt-7" onSubmit={requestEmailLink}>
              <label className="text-xs font-semibold text-[var(--text)]" htmlFor="operator-email">Operator email</label>
              <input
                id="operator-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2 h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm shadow-sm"
                required
              />
              <button
                type="submit"
                disabled={submitting}
                className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-60"
              >
                {submitting ? "Sending…" : "Email me a secure link"}
                <ArrowRight className="size-4" />
              </button>
            </form>
          ) : null}

          {hasOAuth ? (
            <div className="mt-7 grid gap-2">
              {session.auth.providers.map((provider) => (
                <a
                  key={provider}
                  href={`/api/cockpit/auth/start?provider=${encodeURIComponent(provider)}`}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--accent-hover)]"
                >
                  Continue with {provider.charAt(0).toUpperCase() + provider.slice(1)}
                  <ExternalLink className="size-4" />
                </a>
              ))}
            </div>
          ) : null}

          {hasTeamAuth && session.auth.password ? (
            <div className="my-6 flex items-center gap-3 text-[10px] uppercase tracking-[0.12em] text-[var(--mute)]"><span className="h-px flex-1 bg-[var(--border)]" />Local access<span className="h-px flex-1 bg-[var(--border)]" /></div>
          ) : null}

          {session.auth.password ? (
            <form className={hasTeamAuth ? "" : "mt-7"} onSubmit={login}>
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
              <button
                type="submit"
                disabled={submitting}
                className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--text-strong)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60"
              >
                {submitting ? "Opening…" : "Enter with password"}
                <ArrowRight className="size-4" />
              </button>
            </form>
          ) : null}

          {loginError ? <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium leading-5 text-rose-700 ring-1 ring-rose-200">{loginError}</p> : null}
          {loginNotice ? <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium leading-5 text-emerald-700 ring-1 ring-emerald-200">{loginNotice}</p> : null}
          {!session.configured ? (
            <p className="mt-5 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 ring-1 ring-amber-200">No operator identity provider is configured for this deployment yet.</p>
          ) : null}
          <a className="mt-6 inline-flex text-xs font-semibold text-[var(--text-dim)] hover:text-[var(--accent)]" href="/cockpit?mode=demo">
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
          <p className="mt-2 text-sm text-[var(--text-dim)]">Your session is intact, but SignalOps could not read the canonical event projection.</p>
          <button className="mt-5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white" onClick={() => void load(range, "initial")}>Try again</button>
        </section>
      </main>
    );
  }

  const qualityIssues =
    snapshot.dataQuality.contradictoryTerminals +
    snapshot.dataQuality.identityCollisions +
    snapshot.dataQuality.idempotencyConflicts;
  const displayedRange = snapshot.range;
  const selectedChartCost = selectChartCost(snapshot.totals.costByCurrency);
  const timelineData: ChartTimeBucket[] = snapshot.timeline.map((bucket) => ({
    time: timelineLabel(bucket.start, displayedRange),
    volume: bucket.operations,
    failures: bucket.failedOperations,
    latency: bucket.p95DurationMs,
    spend: chartCostValue(bucket.costByCurrency, selectedChartCost),
  }));
  const providerChartData: ChartProvider[] = snapshot.providers.flatMap(
    (provider, index) => {
      if (provider.p95DurationMs === null || provider.attempts === 0) return [];
      return [
        {
          id: `${provider.providerKey}:${provider.modelKey}`,
          name: `${provider.providerVendor || provider.providerKey} · ${provider.modelKey}`,
          p95Ms: provider.p95DurationMs,
          failureRate:
            provider.successRate === null ? 0 : (1 - provider.successRate) * 100,
          spend: chartCostValue(provider.costByCurrency, selectedChartCost),
          volume: provider.attempts,
          color: chartColors[index % chartColors.length] ?? "#3459df",
        },
      ];
    },
  );
  const spendProviderData: ChartProvider[] = snapshot.providers
    .map((provider, index) => ({
      id: `${provider.providerKey}:${provider.modelKey}`,
      name: `${provider.providerVendor || provider.providerKey} · ${provider.modelKey}`,
      p95Ms: provider.p95DurationMs ?? 0,
      failureRate:
        provider.successRate === null ? 0 : (1 - provider.successRate) * 100,
      spend: chartCostValue(provider.costByCurrency, selectedChartCost),
      volume: provider.attempts,
      color: chartColors[index % chartColors.length] ?? "#3459df",
    }))
    .filter((provider) => provider.spend > 0);
  const hasTimelineVolume = timelineData.some(
    (bucket) => bucket.volume > 0 || bucket.failures > 0,
  );
  const hasLatency = timelineData.some((bucket) => bucket.latency !== null);
  const spendSubtitle = selectedChartCost
    ? `${selectedChartCost.source} cost by provider route · ${selectedChartCost.currency}`
    : snapshot.totals.costByCurrency.length > 1
      ? "Multiple live currencies stay separate and are never summed"
      : "No reported or catalog-estimated cost in this window";
  const runningOperations = Math.max(
    0,
    snapshot.totals.operations - snapshot.totals.succeeded - snapshot.totals.failed,
  );
  const attemptCoverage =
    snapshot.totals.operations === 0
      ? null
      : snapshot.totals.operationsWithAttemptTelemetry / snapshot.totals.operations;
  const operationSource =
    operationFilter === "failed"
      ? snapshot.recentFailedOperations
      : snapshot.recentOperations;
  const filteredOperations = filterSignalOpsOperationsV1(operationSource, operationFilter);
  const operationPagination = paginateSignalOpsRowsV1(
    filteredOperations,
    operationPage,
    OPERATION_PAGE_SIZE,
  );
  const modelPagination = paginateSignalOpsRowsV1(
    snapshot.models,
    modelPage,
    MODEL_PAGE_SIZE,
  );
  const providerPagination = paginateSignalOpsRowsV1(
    snapshot.providers,
    providerPage,
    PROVIDER_PAGE_SIZE,
  );
  const maxModelOperations = Math.max(
    1,
    ...snapshot.models.map((model) => model.operations),
  );
  const maxFailureOperations = Math.max(
    1,
    ...snapshot.failureBreakdown.map((failure) => failure.operations),
  );
  const unclassifiedFailures = snapshot.failureBreakdown
    .filter((failure) => failure.category === "unknown")
    .reduce((total, failure) => total + failure.operations, 0);
  const operationFilterTotal =
    operationFilter === "all"
      ? snapshot.totals.operations
      : operationFilter === "succeeded"
        ? snapshot.totals.succeeded
        : operationFilter === "failed"
          ? snapshot.totals.failed
          : runningOperations;
  return (
    <>
    <main className="min-h-screen bg-[radial-gradient(circle_at_78%_0%,rgba(52,89,223,0.10),transparent_28%),#f8faff] text-[var(--text)]">
      <div className="mx-auto w-full max-w-[1440px] px-5 py-6 sm:px-8 lg:px-10">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] pb-5">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-[var(--accent)] text-white"><Activity className="size-4" /></div>
            <div>
              <div className="flex items-center gap-2"><span className="text-sm font-bold text-[var(--text-strong)]">SignalOps</span><span className="rounded-full bg-emerald-50 px-2 py-0.5 font-mono text-[9px] font-bold uppercase text-emerald-700 ring-1 ring-emerald-200">Live</span></div>
              <p className="mt-0.5 text-xs text-[var(--text-dim)]">{snapshot.tenant.name} · {session.session?.role ?? "operator"}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {session.memberships.length > 1 ? (
              <select
                aria-label="SignalOps workspace"
                value={snapshot.tenant.id}
                disabled={switchingTenant}
                onChange={(event) => void switchTenant(event.target.value)}
                className="h-9 max-w-[220px] rounded-lg border border-[var(--border)] bg-white px-3 text-xs font-semibold text-[var(--text-strong)]"
              >
                {session.memberships.map((membership) => <option key={membership.tenantId} value={membership.tenantId}>{membership.tenantName}</option>)}
              </select>
            ) : null}
            <a href="/cockpit?mode=demo" className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs font-semibold text-[var(--text-dim)] hover:text-[var(--accent)]">Demo</a>
            <button onClick={() => void load(range, "refresh")} className="grid size-9 place-items-center rounded-lg border border-[var(--border)] bg-white text-[var(--text-dim)] hover:text-[var(--accent)]" aria-label="Refresh"><RefreshCw className={`size-4 ${isRefreshing ? "animate-spin" : ""}`} /></button>
            <button onClick={() => void logout()} className="grid size-9 place-items-center rounded-lg border border-[var(--border)] bg-white text-[var(--text-dim)] hover:text-rose-600" aria-label="Sign out"><LogOut className="size-4" /></button>
          </div>
        </header>

        <section className="mt-7">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--accent)]">Canonical AI telemetry v1</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--text-strong)] sm:text-4xl">Generation operations</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--text-dim)]">
              <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-emerald-500" /> Last signal {relativeTime(snapshot.freshness.lastReceivedAt)}</span>
              <span className="rounded-full border border-[var(--border)] bg-white px-2 py-0.5 font-mono text-[10px]">{snapshot.projection.materialized ? "materialized" : "live projection"}</span>
              {snapshot.environments.map((environment) => <span key={environment} className="rounded-full border border-[var(--border)] bg-white px-2 py-0.5 font-mono text-[10px]">{environment}</span>)}
            </div>
          </div>
        </section>

        <section
          aria-label="Analysis controls"
          aria-busy={isRefreshing}
          className="sticky top-2 z-30 mt-5"
        >
          <div className="rounded-xl border border-white/80 bg-white/90 p-1.5 shadow-[0_10px_32px_rgba(34,55,105,0.14)] ring-1 ring-[var(--border)] backdrop-blur-xl">
            <div className="flex min-h-11 items-center gap-2 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <span className="shrink-0 pl-1 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--mute)]">Window</span>
              <div className="flex shrink-0 rounded-lg bg-[var(--surface-mute)] p-1" aria-label="Analysis window">
                {cockpitRanges.map((value) => {
                  const selectedRange = pendingRange ?? range;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={selectedRange === value}
                      onClick={() => selectRange(value)}
                      className={`rounded-md px-2.5 py-1.5 text-[10px] font-semibold transition ${selectedRange === value ? "bg-[var(--accent)] text-white shadow-sm" : "text-[var(--text-dim)] hover:bg-white hover:text-[var(--text)]"}`}
                    >
                      {value}
                    </button>
                  );
                })}
              </div>
              <span className="mx-1 h-6 w-px shrink-0 bg-[var(--border)]" />
              <div aria-live="polite" className={`flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold ${refreshError ? "bg-rose-50 text-rose-700" : "text-[var(--text-dim)]"}`}>
                <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin text-[var(--accent)]" : refreshError ? "text-rose-600" : "text-emerald-600"}`} />
                {pendingRange
                  ? `Updating to ${pendingRange} · showing ${displayedRange}`
                  : refreshError || `${formatNumber(snapshot.totals.operations)} ops · ${formatNumber(snapshot.totals.failed)} failed · p95 ${formatDuration(snapshot.totals.p95DurationMs)}`}
              </div>
              <span className="mx-1 h-6 w-px shrink-0 bg-[var(--border)]" />
              <button type="button" onClick={() => activateOperationFilter("failed")} className="shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold text-rose-700 transition hover:bg-rose-50">Failures <span className="ml-1 font-mono">{formatNumber(snapshot.totals.failed)}</span></button>
              <button type="button" onClick={() => scrollToSection(qualitySectionRef)} className="shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold text-[var(--text-dim)] transition hover:bg-[var(--surface-mute)] hover:text-[var(--accent)]">Coverage <span className="ml-1 font-mono">{formatPercent(attemptCoverage)}</span></button>
              <button type="button" onClick={() => scrollToSection(routeSectionRef)} className="shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold text-[var(--text-dim)] transition hover:bg-[var(--surface-mute)] hover:text-[var(--accent)]">Routes <span className="ml-1 font-mono">{formatNumber(snapshot.providers.length)}</span></button>
              {sloEvaluations.length > 0 ? <button type="button" onClick={() => scrollToSection(sloSectionRef)} className="shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold text-[var(--text-dim)] transition hover:bg-[var(--surface-mute)] hover:text-[var(--accent)]">SLOs <span className="ml-1 font-mono">{formatNumber(sloEvaluations.filter((evaluation) => evaluation.status === "breached").length)}</span></button> : null}
              <button type="button" onClick={() => activateOperationFilter("all")} className="shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold text-[var(--text-dim)] transition hover:bg-[var(--surface-mute)] hover:text-[var(--accent)]">Operations</button>
              <button type="button" onClick={() => void load(range, "refresh")} disabled={isRefreshing} className="ml-auto grid size-8 shrink-0 place-items-center rounded-lg border border-[var(--border)] bg-white text-[var(--text-dim)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50" aria-label="Refresh analysis"><RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} /></button>
            </div>
          </div>
        </section>

        {!snapshot.dataQuality.complete ? (
          <section className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            <TriangleAlert className="size-4 shrink-0" />
            <span className="font-semibold">Telemetry quality needs attention.</span>
            <span>{qualityIssues} conflict{qualityIssues === 1 ? "" : "s"}{snapshot.dataQuality.truncated ? " · projection capacity exceeded" : ""}</span>
          </section>
        ) : null}

        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Metric icon={Database} label="Operations" value={formatNumber(snapshot.totals.operations)} detail="Inspect latest operations →" active={operationFilter === "all"} onClick={() => activateOperationFilter("all")} />
          <Metric icon={CheckCircle2} label="Succeeded" value={formatNumber(snapshot.totals.succeeded)} detail={`${formatPercent(snapshot.totals.successRate)} success rate →`} tone="good" active={operationFilter === "succeeded"} onClick={() => activateOperationFilter("succeeded")} />
          <Metric icon={TriangleAlert} label="Failed" value={formatNumber(snapshot.totals.failed)} detail={`${formatNumber(snapshot.totals.retryableFailures)} retryable · inspect →`} tone="bad" active={operationFilter === "failed"} onClick={() => activateOperationFilter("failed")} />
          <Metric icon={Clock3} label="Operation p95" value={formatDuration(snapshot.totals.p95DurationMs)} detail="terminal duration" />
          <Metric icon={Activity} label="Provider coverage" value={formatPercent(attemptCoverage)} detail={`${formatNumber(snapshot.totals.operationsWithAttemptTelemetry)} / ${formatNumber(snapshot.totals.operations)} operations`} tone="warn" />
          <Metric icon={DollarSign} label="Reported cost" value={costSummary(snapshot.totals.costByCurrency, "reported")} detail={`${costSummary(snapshot.totals.costByCurrency, "estimated")} estimated`} />
        </section>

        <section className="mt-6 grid gap-4 xl:grid-cols-[1.35fr_0.9fr]">
          <Panel title="Throughput" subtitle={`${displayedRange} operation volume vs failures`}>
            {hasTimelineVolume ? (
              <ThroughputChart data={timelineData} />
            ) : (
              <EmptyState text="No operation volume is available in this live window yet." />
            )}
          </Panel>
          <Panel title="Latency tail" subtitle="Operation p95 by canonical start-time bucket">
            {hasLatency ? (
              <LatencyChart data={timelineData} />
            ) : (
              <EmptyState text="Latency appears after the first operation reaches a terminal state." />
            )}
          </Panel>
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-3">
          <Panel title="Spend distribution" subtitle={spendSubtitle}>
            {selectedChartCost && selectedChartCost.value > 0 && spendProviderData.length > 0 ? (
              <SpendDonutChart
                data={spendProviderData}
                currency={selectedChartCost.currency}
              />
            ) : (
              <EmptyState text="Spend distribution needs one live currency and positive cost evidence." />
            )}
          </Panel>
          <Panel
            title="Performance matrix"
            subtitle={
              providerChartData.length === 0
                ? "Insufficient live provider data; no terminal attempt latency in this window."
                : providerChartData.length === 1
                ? "Insufficient live provider data for comparison; plotting the available route."
                : "Provider routes by speed, reliability, and attempt volume"
            }
          >
            {providerChartData.length > 0 ? (
              <PerformanceScatterChart data={providerChartData} />
            ) : (
              <EmptyState text="Performance comparison appears after a provider attempt records latency." />
            )}
          </Panel>
          <Panel title="Traffic wave" subtitle="Operation volume over the selected live window">
            {hasTimelineVolume ? (
              <TrafficAreaChart data={timelineData} />
            ) : (
              <EmptyState text="The traffic wave appears after the source application sends an operation." />
            )}
          </Panel>
        </section>

        {sloEvaluations.length > 0 ? (
          <section ref={sloSectionRef} tabIndex={-1} className="mt-6 scroll-mt-24 rounded-xl border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)] outline-none sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-strong)]"><Gauge className="size-4 text-[var(--accent)]" /> Reliability objectives</h2>
                <p className="mt-1 text-[11px] text-[var(--text-dim)]">Versioned 24-hour SLO policies for this workspace; low samples never become false breaches</p>
              </div>
              <span className="rounded-full bg-slate-50 px-2.5 py-1 font-mono text-[9px] font-bold text-slate-700 ring-1 ring-slate-200">{sloEvaluations.filter((evaluation) => evaluation.status === "breached").length} breached</span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {sloEvaluations.map((evaluation) => {
                const tone = evaluation.status === "breached"
                  ? evaluation.severity === "critical"
                    ? "border-rose-200 bg-rose-50/60 text-rose-800"
                    : "border-amber-200 bg-amber-50/60 text-amber-900"
                  : evaluation.status === "met"
                    ? "border-emerald-200 bg-emerald-50/50 text-emerald-800"
                    : "border-slate-200 bg-slate-50 text-slate-700";
                return (
                  <div key={evaluation.policy.id} className={`min-w-0 rounded-lg border p-4 ${tone}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[11px] font-semibold leading-4">{evaluation.policy.name}</p>
                      <span className="rounded-full bg-white/80 px-2 py-0.5 font-mono text-[8px] font-bold uppercase ring-1 ring-current/15">{evaluation.status.replace("_", " ")}</span>
                    </div>
                    <p className="mt-4 text-xl font-semibold tracking-tight">{formatSloValue(evaluation, evaluation.observedValue)}</p>
                    <p className="mt-1 text-[9px] opacity-75">objective {evaluation.policy.comparator === "gte" ? "≥" : "≤"} {formatSloValue(evaluation, evaluation.policy.objective)}</p>
                    <p className="mt-3 font-mono text-[8px] opacity-65">n={formatNumber(evaluation.sampleSize)} · min {formatNumber(evaluation.policy.minimumSample)} · {evaluation.policy.version}</p>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {incidents.length > 0 ? (
          <section className="mt-6 rounded-xl border border-rose-200 bg-white p-5 shadow-[var(--shadow-1)] sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-[var(--text-strong)]">Active incidents</h2><p className="mt-1 text-[11px] text-[var(--text-dim)]">Stable policy-based signals with evidence, ownership, and lifecycle history</p></div><span className="rounded-full bg-rose-50 px-2.5 py-1 text-[10px] font-bold text-rose-700 ring-1 ring-rose-200">{incidents.length} active</span></div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {incidents.map((incident) => (
                <a key={incident.id} href={`/incidents/${encodeURIComponent(incident.id)}`} className="group rounded-lg border border-[var(--border)] bg-[var(--surface-mute)] p-4 transition hover:border-[var(--accent)] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
                  <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-[var(--text-strong)]">{incident.title}</p><p className="mt-1 font-mono text-[9px] text-[var(--mute)]">{incident.metric} · {incident.id}</p></div><div className="flex shrink-0 items-center gap-2"><span className={`rounded-full px-2 py-1 text-[9px] font-bold ring-1 ${incident.state === "acknowledged" ? "bg-blue-50 text-blue-700 ring-blue-200" : incident.severity === "critical" ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-amber-50 text-amber-800 ring-amber-200"}`}>{incident.state === "acknowledged" ? "acknowledged" : incident.severity}</span><ArrowRight className="size-3.5 text-[var(--mute)] transition group-hover:translate-x-0.5 group-hover:text-[var(--accent)]" /></div></div>
                  <p className="mt-3 text-[10px] text-[var(--text-dim)]">Observed {relativeTime(incident.lastObservedAt)} · policy {incident.policyVersion}</p>
                </a>
              ))}
            </div>
          </section>
        ) : null}

        <section ref={qualitySectionRef} tabIndex={-1} className="mt-6 grid scroll-mt-24 items-start gap-5 outline-none xl:grid-cols-[1.25fr_0.75fr]">
          <Panel
            title="Instrumentation quality"
            subtitle="Measured canonical evidence coverage; missing facts are never inferred"
          >
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <CoverageRow label="Accepted boundaries" metric={snapshot.coverage.operationAcceptance} />
              <CoverageRow label="Terminal outcomes" metric={snapshot.coverage.operationCompletion} />
              <CoverageRow label="Provider attempts" metric={snapshot.coverage.providerAttempts} />
              <CoverageRow label="Paired attempt lifecycle" metric={snapshot.coverage.attemptLifecycle} />
              <CoverageRow label="Failure taxonomy" metric={snapshot.coverage.failureClassification} />
              <CoverageRow label="Failure codes" metric={snapshot.coverage.failureCodes} />
              <CoverageRow label="Cost evidence" metric={snapshot.coverage.costEvidence} />
            </div>
            <p className="mt-5 rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2.5 text-[10px] leading-4 text-blue-900">
              These ratios describe what producers actually emitted. Logical model labels do not count as provider-route evidence, and catalog prices do not count as reported billing.
            </p>
          </Panel>

          <Panel
            title="Failure intelligence"
            subtitle={`${formatNumber(snapshot.totals.failed)} unsuccessful operation${snapshot.totals.failed === 1 ? "" : "s"} in this range`}
          >
            {snapshot.failureBreakdown.length === 0 ? (
              <EmptyState text="Normalized failure categories appear after an operation records an unsuccessful terminal outcome." />
            ) : (
              <>
                {unclassifiedFailures > 0 ? (
                  <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                    <p className="text-[10px] leading-4">
                      <span className="font-semibold">{formatNumber(unclassifiedFailures)} unclassified.</span> The source recorded failure outcomes without a normalized cause; inspect an operation to see the available evidence.
                    </p>
                  </div>
                ) : null}
                <div className="divide-y divide-[var(--border-soft)]">
                  {snapshot.failureBreakdown.slice(0, 7).map((failure) => (
                    <div key={`${failure.category}:${failure.responsibility}`} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-[var(--text-strong)]">{failure.category.replaceAll("_", " ")}</p>
                          <p className="mt-1 font-mono text-[9px] text-[var(--mute)]">{failure.responsibility} · {formatNumber(failure.retryableOperations)} retryable</p>
                        </div>
                        <span className="font-mono text-xs font-bold text-[var(--text-strong)]">{formatNumber(failure.operations)}</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${failure.category === "unknown" ? "bg-amber-500" : "bg-rose-500"}`}
                          style={{ width: `${Math.max(4, (failure.operations / maxFailureOperations) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Panel>
        </section>

        <section ref={routeSectionRef} tabIndex={-1} className="mt-6 grid scroll-mt-24 items-start gap-5 outline-none lg:grid-cols-2">
          <Panel
            title="Provider route health"
            subtitle={`${formatNumber(snapshot.totals.operationsWithAttemptTelemetry)} of ${formatNumber(snapshot.totals.operations)} operations include explicit attempt telemetry`}
          >
            <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold text-amber-950">Attempt telemetry coverage</p>
                <p className="font-mono text-xs font-bold text-amber-900">{formatPercent(attemptCoverage)}</p>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-amber-100 ring-1 ring-amber-200">
                <div
                  className="h-full rounded-full bg-amber-500"
                  style={{ width: `${Math.max(0, Math.min(100, (attemptCoverage ?? 0) * 100))}%` }}
                />
              </div>
              <p className="mt-3 text-[10px] leading-4 text-amber-900/80">
                Route health uses explicit attempt start and terminal facts only. Logical model names are never guessed into provider routes.
              </p>
            </div>
            {snapshot.providers.length === 0 ? <EmptyState text="Provider attempts will appear after the source application delivers its first terminal attempt." /> : (
              <>
                <div className="divide-y divide-[var(--border-soft)]">
                  {providerPagination.rows.map((provider) => (
                    <div key={`${provider.providerKey}:${provider.modelKey}`} className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                      <div><p className="text-sm font-semibold text-[var(--text-strong)]">{provider.providerVendor || provider.providerKey}</p><p className="mt-1 font-mono text-[10px] text-[var(--text-dim)]">{provider.providerKey} / {provider.modelKey}</p></div>
                      <div className="grid grid-cols-3 gap-5 text-right"><Mini label="Attempts" value={formatNumber(provider.attempts)} /><Mini label="p95" value={formatDuration(provider.p95DurationMs)} /><Mini label="Success" value={formatPercent(provider.successRate)} /></div>
                      <span className={`justify-self-start rounded-full px-2 py-1 text-[10px] font-bold ring-1 sm:justify-self-end ${healthTone(provider.health.status)}`}>{provider.health.status.replace("_", " ")}</span>
                    </div>
                  ))}
                </div>
                <Pagination
                  ariaLabel="Provider route pagination"
                  itemLabel="routes"
                  page={providerPagination.page}
                  pageCount={providerPagination.pageCount}
                  pageSize={PROVIDER_PAGE_SIZE}
                  total={providerPagination.total}
                  onPageChange={setProviderPage}
                />
              </>
            )}
          </Panel>

          <Panel title="Model performance" subtitle="Logical model classes from canonical operation lifecycles">
            {snapshot.models.length === 0 ? (
              <EmptyState text="Model performance appears after the source application sends an operation." />
            ) : (
              <>
                <div className="divide-y divide-[var(--border-soft)]">
                {modelPagination.rows.map((model) => (
                  <div
                    key={model.modelKey}
                    className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[1fr_auto] sm:items-center"
                  >
                    <div>
                      <p className="font-mono text-[11px] font-semibold text-[var(--text-strong)]">
                        {model.modelKey}
                      </p>
                      <p className="mt-1 text-[10px] text-[var(--text-dim)]">
                        {formatNumber(model.succeeded)} succeeded · {formatNumber(model.failed)} failed
                      </p>
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.max(3, (model.operations / maxModelOperations) * 100)}%` }} />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-5 text-right">
                      <Mini label="Operations" value={formatNumber(model.operations)} />
                      <Mini label="p95" value={formatDuration(model.p95DurationMs)} />
                      <Mini label="Success" value={formatPercent(model.successRate)} />
                    </div>
                  </div>
                ))}
                </div>
                <Pagination
                  ariaLabel="Model performance pagination"
                  itemLabel="models"
                  page={modelPagination.page}
                  pageCount={modelPagination.pageCount}
                  pageSize={MODEL_PAGE_SIZE}
                  total={modelPagination.total}
                  onPageChange={setModelPage}
                />
              </>
            )}
          </Panel>

          <div ref={operationSectionRef} tabIndex={-1} className="min-w-0 scroll-mt-24 outline-none lg:col-span-2">
            <Panel
              title="Operations explorer"
              subtitle={`${formatNumber(operationPagination.total)} available of ${formatNumber(operationFilterTotal)} ${operationFilter === "all" ? "operations" : `${operationFilter} outcomes`} in this range · identifiers only`}
            >
              <div className="mb-5 flex flex-wrap gap-2" aria-label="Operation status filter">
                <FilterChip label="All" count={snapshot.totals.operations} active={operationFilter === "all"} onClick={() => activateOperationFilter("all")} />
                <FilterChip label="Succeeded" count={snapshot.totals.succeeded} active={operationFilter === "succeeded"} tone="good" onClick={() => activateOperationFilter("succeeded")} />
                <FilterChip label="Failed" count={snapshot.totals.failed} active={operationFilter === "failed"} tone="bad" onClick={() => activateOperationFilter("failed")} />
                <FilterChip label="Running" count={runningOperations} active={operationFilter === "running"} onClick={() => activateOperationFilter("running")} />
              </div>
              {operationPagination.rows.length === 0 ? (
                <EmptyState text={operationFilter === "all" ? "The pipeline is connected. Trigger an AI operation in the source application to populate this table." : `No ${operationFilter} operations are available in the retained sample for this range.`} />
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1020px] text-left">
                      <thead><tr className="border-b border-[var(--border)] font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--mute)]"><th className="pb-3 font-semibold">Operation</th><th className="pb-3 font-semibold">Status</th><th className="pb-3 font-semibold">Model class</th><th className="pb-3 font-semibold">Failure</th><th className="pb-3 font-semibold">Duration</th><th className="pb-3 font-semibold">Attempts</th><th className="pb-3 text-right font-semibold">Seen</th><th className="pb-3 text-right font-semibold">Trace</th></tr></thead>
                      <tbody className="divide-y divide-[var(--border-soft)]">
                        {operationPagination.rows.map((operation) => (
                          <tr key={operation.operationId} className="text-xs transition-colors hover:bg-[var(--surface-mute)]">
                            <td className="py-3.5"><p className="max-w-[180px] truncate font-mono text-[10px] font-semibold text-[var(--text-strong)]">{operation.operationId}</p><p className="mt-1 text-[10px] text-[var(--text-dim)]">{operation.service} · {operation.environment}</p></td>
                            <td className="py-3.5"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ring-1 ${statusTone(operation.status)}`}>{operation.status}</span></td>
                            <td className="max-w-[180px] py-3.5 text-[var(--text-dim)]"><span className="block truncate" title={operation.logicalModelKey || operation.kind}>{operation.logicalModelKey || operation.kind}</span></td>
                            <td className="py-3.5">
                              {operation.status === "succeeded" || operation.status === "running" ? <span className="text-[var(--mute)]">—</span> : (
                                <div><p className="font-medium text-rose-700">{operation.failureCategory?.replaceAll("_", " ") || "unclassified"}</p><p className="mt-1 max-w-[180px] truncate font-mono text-[9px] text-[var(--mute)]" title={operation.failureCode}>{operation.failureCode || (operation.failureRetryable ? "retryable" : "no failure code")}</p></div>
                              )}
                            </td>
                            <td className="py-3.5 font-medium">{formatDuration(operation.durationMs)}</td>
                            <td className="py-3.5 font-medium">{formatNumber(operation.attemptCount)}</td>
                            <td className="py-3.5 text-right text-[var(--text-dim)]">{relativeTime(operation.occurredAt)}</td>
                            <td className="py-3.5 text-right">
                              <button
                                type="button"
                                aria-label={`Inspect operation ${operation.operationId}`}
                                onClick={(event) => openOperationTrace(operation.operationId, event.currentTarget)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white px-2.5 py-1.5 text-[10px] font-semibold text-[var(--text-dim)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                              >
                                Inspect <ArrowRight className="size-3" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pagination
                    ariaLabel="Operations pagination"
                    itemLabel="operations"
                    page={operationPagination.page}
                    pageCount={operationPagination.pageCount}
                    pageSize={OPERATION_PAGE_SIZE}
                    total={operationPagination.total}
                    onPageChange={setOperationPage}
                  />
                </>
              )}
            </Panel>
          </div>
        </section>
        <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] py-5 text-[10px] text-[var(--mute)]"><span>Auto-refreshes every 10 seconds · {snapshot.projection.sourceEventCount} source events · snapshot generated {new Date(snapshot.generatedAt).toLocaleTimeString()}</span><a className="font-semibold hover:text-[var(--accent)]" href="/schemas/ai-telemetry/v1">Canonical schema</a></footer>
      </div>
    </main>
    {selectedOperationId ? (
      <OperationTraceDrawer
        operationId={selectedOperationId}
        onClose={() => setSelectedOperationId(null)}
        finalFocus={operationTraceTriggerRef}
      />
    ) : null}
    </>
  );
}

function Metric({ icon: Icon, label, value, detail, onClick, active = false, tone = "neutral" }: { icon: typeof Activity; label: string; value: string; detail: string; onClick?: () => void; active?: boolean; tone?: "neutral" | "good" | "bad" | "warn" }) {
  const toneClass = tone === "good"
    ? "text-emerald-600"
    : tone === "bad"
      ? "text-rose-600"
      : tone === "warn"
        ? "text-amber-600"
        : "text-[var(--accent)]";
  const className = `min-w-0 rounded-xl border bg-white p-4 text-left shadow-[var(--shadow-1)] transition ${active ? "border-[var(--accent)] ring-2 ring-[var(--accent-soft)]" : "border-[var(--border)]"} ${onClick ? "cursor-pointer hover:-translate-y-0.5 hover:border-[var(--accent)] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]" : ""}`;
  const content = <><div className="flex items-center justify-between"><p className="font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--mute)]">{label}</p><Icon className={`size-4 ${toneClass}`} /></div><p className="mt-4 truncate text-2xl font-semibold tracking-tight text-[var(--text-strong)]" title={value}>{value}</p><p className="mt-1 truncate text-[10px] text-[var(--text-dim)]" title={detail}>{detail}</p></>;
  return onClick ? <button type="button" aria-pressed={active} className={className} onClick={onClick}>{content}</button> : <div className={className}>{content}</div>;
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <section className="min-w-0 rounded-xl border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)] sm:p-6"><div className="mb-5"><h2 className="text-sm font-semibold text-[var(--text-strong)]">{title}</h2><p className="mt-1 text-[11px] text-[var(--text-dim)]">{subtitle}</p></div>{children}</section>;
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div><p className="font-mono text-[8px] uppercase text-[var(--mute)]">{label}</p><p className="mt-1 text-xs font-semibold text-[var(--text-strong)]">{value}</p></div>;
}

function CoverageRow({ label, metric }: { label: string; metric: SignalOpsCoverageMetricV1 }) {
  const tone = metric.ratio === null
    ? "bg-slate-300"
    : metric.ratio >= 0.95
      ? "bg-emerald-500"
      : metric.ratio >= 0.8
        ? "bg-amber-500"
        : "bg-rose-500";
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold text-[var(--text-strong)]">{label}</p>
        <p className="font-mono text-[10px] font-bold text-[var(--text-strong)]">{formatPercent(metric.ratio)}</p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${tone}`}
          style={{ width: `${Math.max(0, Math.min(100, (metric.ratio ?? 0) * 100))}%` }}
        />
      </div>
      <p className="mt-1.5 font-mono text-[9px] text-[var(--mute)]">{formatNumber(metric.observed)} / {formatNumber(metric.total)} observed</p>
    </div>
  );
}

function FilterChip({ label, count, active, onClick, tone = "neutral" }: { label: string; count: number; active: boolean; onClick: () => void; tone?: "neutral" | "good" | "bad" }) {
  const activeClass = tone === "bad"
    ? "border-rose-600 bg-rose-600 text-white"
    : tone === "good"
      ? "border-emerald-600 bg-emerald-600 text-white"
      : "border-[var(--accent)] bg-[var(--accent)] text-white";
  return <button type="button" aria-pressed={active} onClick={onClick} className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${active ? activeClass : "border-[var(--border)] bg-white text-[var(--text-dim)] hover:border-[var(--accent)] hover:text-[var(--accent)]"}`}>{label} <span className="ml-1 font-mono opacity-80">{formatNumber(count)}</span></button>;
}

function Pagination({ ariaLabel, itemLabel, page, pageCount, pageSize, total, onPageChange }: { ariaLabel: string; itemLabel: string; page: number; pageCount: number; pageSize: number; total: number; onPageChange: (page: number) => void }) {
  if (total === 0) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  return (
    <nav aria-label={ariaLabel} className="mt-5 flex items-center justify-between gap-3 border-t border-[var(--border-soft)] pt-4">
      <p className="font-mono text-[9px] text-[var(--mute)]">{first}–{last} of {formatNumber(total)} {itemLabel}</p>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={`Previous ${itemLabel} page`} disabled={page <= 1} onClick={() => onPageChange(page - 1)} className="grid size-8 place-items-center rounded-lg border border-[var(--border)] bg-white text-[var(--text-dim)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-35"><ChevronLeft className="size-4" /></button>
        <span className="min-w-14 text-center font-mono text-[9px] font-semibold text-[var(--text-dim)]">{page} / {pageCount}</span>
        <button type="button" aria-label={`Next ${itemLabel} page`} disabled={page >= pageCount} onClick={() => onPageChange(page + 1)} className="grid size-8 place-items-center rounded-lg border border-[var(--border)] bg-white text-[var(--text-dim)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-35"><ChevronRight className="size-4" /></button>
      </div>
    </nav>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-mute)] px-5 py-10 text-center"><Database className="mx-auto size-5 text-[var(--mute)]" /><p className="mx-auto mt-3 max-w-sm text-xs leading-5 text-[var(--text-dim)]">{text}</p></div>;
}
