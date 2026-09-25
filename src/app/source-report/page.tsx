import { AlertTriangle, BarChart3, CheckCircle2, Database, ExternalLink, RadioTower } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { isCockpitAuthRequired, requireCockpitAccess } from "@/lib/signalops/auth";
import {
  buildSourceOperationalReport,
  type SourceProviderReport,
  type SourceReportFilters,
  type SourceReportRange,
} from "@/lib/signalops/source-report";
import { getSignalOpsStore, getStoreHealth, getWorkspaceSlug } from "@/lib/signalops/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function formatDate(value: string | undefined) {
  if (!value) {
    return "No events";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatMs(value: number | null) {
  if (value == null) {
    return "n/a";
  }

  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

function MetricTile({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-[var(--shadow-1)]">
      <dt className="text-xs font-semibold uppercase text-[var(--mute)]">{label}</dt>
      <dd className="mt-2 text-2xl font-semibold text-[var(--text-strong)]">{value}</dd>
      <p className="mt-1 text-xs font-medium text-[var(--text-dim)]">{detail}</p>
    </div>
  );
}

function BrowserAuthNotice() {
  return (
    <section className="mt-8 rounded-lg border border-[var(--warning)] bg-[var(--warning-soft)] p-5 text-[var(--warning)]">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0" />
        <div>
          <h2 className="text-lg font-semibold">Browser operator auth required</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6">
            Source reports can include real provider, model, latency, failure, and cost evidence.
            Configure cockpit password auth with an explicit session secret before rendering this
            browser page in production. Operator API tokens are still supported for CLI/API report
            export.
          </p>
        </div>
      </div>
    </section>
  );
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function readPageFilters(params: Record<string, string | string[] | undefined>): SourceReportFilters {
  const range = firstParam(params.range);
  const eventId = firstParam(params.eventId)?.trim();
  const providerId = firstParam(params.providerId)?.trim();
  const modelId = firstParam(params.modelId)?.trim();

  return {
    range: range === "24h" || range === "7d" || range === "30d" || range === "all" ? range : "all",
    eventId: eventId || undefined,
    providerId: providerId || undefined,
    modelId: modelId || undefined,
  };
}

function reportHref(filters: SourceReportFilters, extra: Record<string, string | undefined> = {}) {
  const params = new URLSearchParams();
  if (filters.range !== "all") {
    params.set("range", filters.range);
  }
  if (filters.eventId) {
    params.set("eventId", filters.eventId);
  }
  if (filters.providerId) {
    params.set("providerId", filters.providerId);
  }
  if (filters.modelId) {
    params.set("modelId", filters.modelId);
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
  }

  const query = params.toString();
  return query ? `/source-report?${query}` : "/source-report";
}

function apiHref(filters: SourceReportFilters, extra: Record<string, string | undefined> = {}) {
  return reportHref(filters, extra).replace("/source-report", "/api/source-report");
}

function FilterLink({
  active,
  href,
  children,
}: {
  active: boolean;
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-md border px-3 py-2 text-sm font-semibold ${
        active
          ? "border-[var(--accent)] bg-[var(--accent)] text-white"
          : "border-[var(--border)] bg-white text-[var(--text-dim)]"
      }`}
    >
      {children}
    </Link>
  );
}

function ProviderRow({ provider }: { provider: SourceProviderReport }) {
  const statusClass =
    provider.status === "degraded"
      ? "border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]"
      : provider.status === "watch"
        ? "border-[var(--warning)] bg-[var(--warning-soft)] text-[var(--warning)]"
        : "border-[var(--success)] bg-[var(--success-soft)] text-[var(--success)]";

  return (
    <article className="rounded-lg border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-strong)]">{provider.providerId}</h2>
          <p className="mt-1 text-sm text-[var(--text-dim)]">
            {provider.models.length ? provider.models.join(", ") : "no models yet"}
          </p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass}`}>
          {provider.status}
        </span>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-5">
        <div>
          <dt className="text-xs font-semibold uppercase text-[var(--mute)]">Events</dt>
          <dd className="mt-1 text-[var(--text-strong)]">{provider.eventCount}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase text-[var(--mute)]">Success</dt>
          <dd className="mt-1 text-[var(--text-strong)]">{provider.successRate}%</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase text-[var(--mute)]">Failure</dt>
          <dd className="mt-1 text-[var(--text-strong)]">{provider.failureRate}%</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase text-[var(--mute)]">Retry</dt>
          <dd className="mt-1 text-[var(--text-strong)]">{provider.retryRate}%</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase text-[var(--mute)]">p95</dt>
          <dd className="mt-1 text-[var(--text-strong)]">{formatMs(provider.p95Ms)}</dd>
        </div>
      </dl>
      <p className="mt-4 text-xs font-semibold text-[var(--mute)]">Last seen {formatDate(provider.lastSeenAt)}</p>
    </article>
  );
}

export default async function SourceReportPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCockpitAccess("/source-report");

  const filters = readPageFilters((await searchParams) ?? {});
  const productionNeedsBrowserAuth =
    (process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL)) && !isCockpitAuthRequired();
  const workspaceSlug = getWorkspaceSlug();
  const storage = getStoreHealth();

  if (productionNeedsBrowserAuth) {
    return (
      <main className="min-h-screen bg-[var(--background)] px-5 py-8 text-[var(--text)] sm:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Link href="/cockpit" className="text-sm font-semibold text-[var(--accent)]">
              Back to cockpit
            </Link>
            <div className="flex flex-wrap gap-3 text-sm font-semibold">
              <Link href="/docs" className="text-[var(--accent)]">
                Source docs
              </Link>
              <Link href="/setup" className="text-[var(--accent)]">
                Setup
              </Link>
            </div>
          </div>
          <BrowserAuthNotice />
        </div>
      </main>
    );
  }

  let report = buildSourceOperationalReport([], { workspaceSlug, filters });
  let unfilteredReport = buildSourceOperationalReport([], { workspaceSlug });
  let readError = "";

  try {
    const [events, unfilteredEvents] = await Promise.all([
      getSignalOpsStore().listEvents(workspaceSlug, 1000, { filters }),
      getSignalOpsStore().listEvents(workspaceSlug, 1000),
    ]);
    report = buildSourceOperationalReport(events, { workspaceSlug, filters });
    unfilteredReport = buildSourceOperationalReport(unfilteredEvents, { workspaceSlug });
  } catch (error) {
    readError = error instanceof Error ? error.message : "source report read failed";
  }

  return (
    <main className="min-h-screen bg-[var(--background)] px-5 py-8 text-[var(--text)] sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link href="/cockpit" className="text-sm font-semibold text-[var(--accent)]">
            Back to cockpit
          </Link>
          <div className="flex flex-wrap gap-3 text-sm font-semibold">
            <Link href={apiHref(filters)} className="text-[var(--accent)]">
              Report JSON
            </Link>
            <Link href={apiHref(filters, { format: "markdown" })} className="text-[var(--accent)]">
              Markdown
            </Link>
            <Link href={apiHref(filters, { format: "csv" })} className="text-[var(--accent)]">
              CSV
            </Link>
            <Link href="/docs" className="text-[var(--accent)]">
              Source docs
            </Link>
            <Link href="/setup" className="text-[var(--accent)]">
              Setup
            </Link>
          </div>
        </div>

        <section className="mt-10">
          <p className="font-mono text-[11px] font-bold uppercase text-[var(--accent)]">Source-only report</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-[-0.03em] text-[var(--text-strong)]">
            Real source events, no seeded demo data
          </h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[var(--text-dim)]">
            This view reads only stored source events for workspace <strong>{workspaceSlug}</strong>.
            It is intentionally separate from the cockpit demo snapshot so pilot evidence stays auditable.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <span className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold shadow-[var(--shadow-1)]">
              <Database className="size-4 text-[var(--accent)]" />
              {storage.adapter}
              {storage.durable ? " durable" : " local"}
            </span>
            <span className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold shadow-[var(--shadow-1)]">
              <CheckCircle2 className="size-4 text-[var(--success)]" />
              demo data excluded
            </span>
          </div>
        </section>

        {readError ? (
          <section className="mt-8 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-5 text-[var(--danger)]">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0" />
              <div>
                <h2 className="text-lg font-semibold">Could not build source report</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6">{readError}</p>
              </div>
            </div>
          </section>
        ) : null}

        {!readError ? (
          <>
            <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface-mute)] p-4">
              {filters.eventId ? (
                <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold text-[var(--text-strong)]">Receipt event</span>
                  <code className="rounded border border-[var(--border)] bg-white px-2 py-1 text-xs text-[var(--text-dim)]">
                    {filters.eventId}
                  </code>
                  <FilterLink active={false} href={reportHref({ ...filters, eventId: undefined })}>
                    Clear event
                  </FilterLink>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {(["all", "24h", "7d", "30d"] as SourceReportRange[]).map((range) => (
                  <FilterLink
                    key={range}
                    active={filters.range === range}
                    href={reportHref({ ...filters, range })}
                  >
                    {range === "all" ? "All time" : range}
                  </FilterLink>
                ))}
              </div>
              {unfilteredReport.providers.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <FilterLink
                    active={!filters.providerId}
                    href={reportHref({ ...filters, providerId: undefined, modelId: undefined })}
                  >
                    All providers
                  </FilterLink>
                  {unfilteredReport.providers.map((provider) => (
                    <FilterLink
                      key={provider.providerId}
                      active={filters.providerId === provider.providerId}
                      href={reportHref({
                        ...filters,
                        providerId: filters.providerId === provider.providerId ? undefined : provider.providerId,
                        modelId: undefined,
                      })}
                    >
                      {provider.providerId}
                    </FilterLink>
                  ))}
                </div>
              ) : null}
              {unfilteredReport.models.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <FilterLink
                    active={!filters.modelId}
                    href={reportHref({ ...filters, modelId: undefined })}
                  >
                    All models
                  </FilterLink>
                  {unfilteredReport.models.map((model) => (
                    <FilterLink
                      key={`${model.providerId}:${model.modelId}`}
                      active={filters.modelId === model.modelId}
                      href={reportHref({
                        ...filters,
                        providerId: model.providerId,
                        modelId: filters.modelId === model.modelId ? undefined : model.modelId,
                      })}
                    >
                      {model.modelId}
                    </FilterLink>
                  ))}
                </div>
              ) : null}
            </section>

            <dl className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricTile
                label="Stored events"
                value={report.totalEvents}
                detail={`Window starts ${formatDate(report.storedEventWindow.firstSeenAt)}`}
              />
              <MetricTile
                label="Providers"
                value={report.providers.length}
                detail={`${report.providerHealthEvents} provider health events`}
              />
              <MetricTile
                label="Generation events"
                value={report.generationEvents}
                detail={`${report.models.length} model reports`}
              />
              <MetricTile
                label="Readiness"
                value={report.diagnostics.readiness.replace("_", " ")}
                detail="Computed from real source coverage"
              />
            </dl>

            {report.totalEvents === 0 ? (
              <section className="mt-8 rounded-lg border border-[var(--border)] bg-white p-8 text-center shadow-[var(--shadow-1)]">
                <RadioTower className="mx-auto size-8 text-[var(--mute)]" />
                <h2 className="mt-4 text-lg font-semibold text-[var(--text-strong)]">No source events captured yet</h2>
                <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[var(--text-dim)]">
                  Validate a payload in `/docs`, then send one token-protected generation event after storage is configured.
                  This report will stay empty until real source traffic is stored.
                </p>
              </section>
            ) : null}

            {report.risks.length > 0 ? (
              <section className="mt-8 rounded-lg border border-[var(--warning)] bg-[var(--warning-soft)] p-5 text-[var(--warning)]">
                <h2 className="text-lg font-semibold">Risks</h2>
                <ul className="mt-3 grid gap-2 text-sm font-semibold">
                  {report.risks.map((risk) => (
                    <li key={risk}>{risk}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="mt-8 rounded-lg border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-[11px] font-bold uppercase text-[var(--accent)]">Pilot evidence</p>
                  <h2 className="mt-2 text-lg font-semibold text-[var(--text-strong)]">
                    {report.pilotEvidence.level.replace("_", " ")}
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-dim)]">
                    {report.pilotEvidence.summary}
                  </p>
                </div>
                <span className="rounded-full bg-[var(--surface-mute)] px-3 py-1 text-xs font-semibold text-[var(--text-dim)]">
                  {report.pilotEvidence.readyForOperatorReview ? "reviewable" : "waiting for source event"}
                </span>
              </div>
              <div className="mt-5 grid gap-5 md:grid-cols-2">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-strong)]">Missing coverage</h3>
                  <ul className="mt-3 grid gap-2 text-sm leading-6 text-[var(--text-dim)]">
                    {(report.pilotEvidence.missingCoverage.length > 0
                      ? report.pilotEvidence.missingCoverage
                      : ["no missing coverage detected"]).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-strong)]">Recommended pilot scope</h3>
                  <ul className="mt-3 grid gap-2 text-sm leading-6 text-[var(--text-dim)]">
                    {report.pilotEvidence.recommendedScope.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>

            <section className="mt-8 rounded-lg border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)]">
              <p className="font-mono text-[11px] font-bold uppercase text-[var(--accent)]">Operator brief</p>
              <h2 className="mt-2 text-lg font-semibold text-[var(--text-strong)]">
                {report.operatorBrief.decision.replaceAll("_", " ")}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-dim)]">
                {report.operatorBrief.headline}
              </p>
              <div className="mt-5 grid gap-5 lg:grid-cols-3">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-strong)]">Talking points</h3>
                  <ul className="mt-3 grid gap-2 text-sm leading-6 text-[var(--text-dim)]">
                    {report.operatorBrief.talkingPoints.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-strong)]">Proof checklist</h3>
                  <ul className="mt-3 grid gap-2 text-sm leading-6 text-[var(--text-dim)]">
                    {report.operatorBrief.proofChecklist.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-strong)]">Non-goals</h3>
                  <ul className="mt-3 grid gap-2 text-sm leading-6 text-[var(--text-dim)]">
                    {report.operatorBrief.nonGoals.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>

            {report.providers.length > 0 ? (
              <section className="mt-8 grid gap-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <h2 className="text-xl font-semibold text-[var(--text-strong)]">Providers</h2>
                  <Link href={apiHref(filters)} className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent)]">
                    JSON
                    <ExternalLink className="size-4" />
                  </Link>
                  <Link href={apiHref(filters, { format: "markdown" })} className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent)]">
                    Markdown
                    <ExternalLink className="size-4" />
                  </Link>
                  <Link href={apiHref(filters, { format: "csv" })} className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent)]">
                    CSV
                    <ExternalLink className="size-4" />
                  </Link>
                </div>
                {report.providers.map((provider) => (
                  <ProviderRow key={provider.providerId} provider={provider} />
                ))}
              </section>
            ) : null}

            <section className="mt-8 rounded-lg border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)]">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--text-strong)]">
                <BarChart3 className="size-5 text-[var(--accent)]" />
                Next actions
              </h2>
              <ol className="mt-3 grid gap-2 text-sm leading-6 text-[var(--text-dim)]">
                {report.nextActions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ol>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
