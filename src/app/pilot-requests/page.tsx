import {
  AlertTriangle,
  Building2,
  Clock3,
  ExternalLink,
  Gauge,
  Inbox,
  Mail,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { PilotRequestLifecycleControls } from "@/components/pilot-request-lifecycle-controls";
import { isCockpitAuthRequired, requireCockpitAccess } from "@/lib/signalops/auth";
import { getSignalOpsStore, getStoreHealth } from "@/lib/signalops/store";
import {
  buildPilotRequestOperatorSummary,
  filterPilotRequestsForOperator,
  type PilotQualification,
  type PilotRequest,
  type PilotRequestFollowUpFilter,
  type PilotRequestOperatorFilters,
  type PilotRequestStatus,
} from "@/lib/signalops/pilot-requests";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const tierStyles: Record<PilotQualification["tier"], string> = {
  urgent_fit: "border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]",
  strong_fit: "border-[var(--success)] bg-[var(--success-soft)] text-[var(--success)]",
  evaluate: "border-[var(--border)] bg-[var(--surface-mute)] text-[var(--text-dim)]",
};

const tierLabels: Record<PilotQualification["tier"], string> = {
  urgent_fit: "Urgent fit",
  strong_fit: "Strong fit",
  evaluate: "Evaluate",
};

const statusLabels: Record<PilotRequestStatus, string> = {
  new: "New",
  contacted: "Contacted",
  pilot_scoped: "Pilot scoped",
  closed: "Closed",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function ProductionAuthNotice() {
  return (
    <section className="mt-8 rounded-lg border border-[var(--warning)] bg-[var(--warning-soft)] p-5 text-[var(--warning)]">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0" />
        <div>
          <h2 className="text-lg font-semibold">Operator auth required</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6">
            Pilot requests include emails and workflow details. Configure `SIGNALOPS_REQUIRE_AUTH=true`
            and `SIGNALOPS_COCKPIT_PASSWORD` before reading this queue in production.
          </p>
        </div>
      </div>
    </section>
  );
}

function QueueReadError({ message }: { message: string }) {
  return (
    <section className="mt-8 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-5 text-[var(--danger)]">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0" />
        <div>
          <h2 className="text-lg font-semibold">Could not read pilot requests</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6">
            {message}
          </p>
        </div>
      </div>
    </section>
  );
}

function SummaryTile({ label, value, detail }: { label: string; value: number | string; detail: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-[var(--shadow-1)]">
      <dt className="text-xs font-semibold uppercase text-[var(--mute)]">{label}</dt>
      <dd className="mt-2 text-2xl font-semibold text-[var(--text-strong)]">{value}</dd>
      <p className="mt-1 text-xs font-medium text-[var(--text-dim)]">{detail}</p>
    </div>
  );
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function readPageFilters(params: Record<string, string | string[] | undefined>): PilotRequestOperatorFilters {
  const status = firstParam(params.status);
  const tier = firstParam(params.tier);
  const followUp = firstParam(params.followUp);

  return {
    status:
      status === "new" || status === "contacted" || status === "pilot_scoped" || status === "closed"
        ? status
        : undefined,
    tier: tier === "evaluate" || tier === "strong_fit" || tier === "urgent_fit" ? tier : undefined,
    followUp:
      followUp === "all" || followUp === "open" || followUp === "due" || followUp === "unscheduled"
        ? followUp
        : undefined,
  };
}

function queueHref(filters: PilotRequestOperatorFilters, extra: Record<string, string> = {}) {
  const params = new URLSearchParams();
  if (filters.status) {
    params.set("status", filters.status);
  }
  if (filters.tier) {
    params.set("tier", filters.tier);
  }
  if (filters.followUp && filters.followUp !== "all") {
    params.set("followUp", filters.followUp);
  }
  for (const [key, value] of Object.entries(extra)) {
    params.set(key, value);
  }

  const query = params.toString();
  return query ? `/pilot-requests?${query}` : "/pilot-requests";
}

function apiHref(filters: PilotRequestOperatorFilters, extra: Record<string, string> = {}) {
  const params = new URLSearchParams();
  if (filters.status) {
    params.set("status", filters.status);
  }
  if (filters.tier) {
    params.set("tier", filters.tier);
  }
  if (filters.followUp && filters.followUp !== "all") {
    params.set("followUp", filters.followUp);
  }
  for (const [key, value] of Object.entries(extra)) {
    params.set(key, value);
  }

  const query = params.toString();
  return query ? `/api/pilot-requests?${query}` : "/api/pilot-requests";
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

function PilotRequestCard({ request }: { request: PilotRequest }) {
  return (
    <article className="rounded-lg border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-[var(--text-strong)]">
              {request.company || request.name}
            </h2>
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${tierStyles[request.qualification.tier]}`}>
              {tierLabels[request.qualification.tier]}
            </span>
            <span className="rounded-full border border-[var(--border)] bg-[var(--surface-mute)] px-3 py-1 text-xs font-semibold text-[var(--text-dim)]">
              {statusLabels[request.lifecycle?.status ?? "new"]}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-sm text-[var(--text-dim)]">
            <span className="inline-flex items-center gap-2">
              <Mail className="size-4" />
              {request.email}
            </span>
            {request.company ? (
              <span className="inline-flex items-center gap-2">
                <Building2 className="size-4" />
                {request.name}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-2">
              <Clock3 className="size-4" />
              {formatDate(request.createdAt)}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {request.productUrl ? (
            <a
              href={request.productUrl}
              className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent)]"
              rel="noreferrer"
              target="_blank"
            >
              Product
              <ExternalLink className="size-4" />
            </a>
          ) : null}
          <a
            href={`/api/pilot-requests/${request.id}/handoff?format=markdown`}
            className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent)]"
          >
            Handoff pack
            <ExternalLink className="size-4" />
          </a>
        </div>
      </div>

      <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs font-semibold uppercase text-[var(--mute)]">Volume</dt>
          <dd className="mt-1 text-[var(--text-strong)]">{request.generationVolume || "Not provided"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase text-[var(--mute)]">Providers</dt>
          <dd className="mt-1 text-[var(--text-strong)]">{request.providers || "Not provided"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase text-[var(--mute)]">Urgency</dt>
          <dd className="mt-1 text-[var(--text-strong)]">{request.urgency || "Not provided"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase text-[var(--mute)]">Source</dt>
          <dd className="mt-1 text-[var(--text-strong)]">{request.source}</dd>
        </div>
      </dl>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase text-[var(--mute)]">Next action</dt>
          <dd className="mt-1 text-[var(--text-strong)]">
            {request.lifecycle?.nextActionAt ? formatDate(request.lifecycle.nextActionAt) : "Not scheduled"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase text-[var(--mute)]">Lifecycle updated</dt>
          <dd className="mt-1 text-[var(--text-strong)]">
            {request.lifecycle?.updatedAt ? formatDate(request.lifecycle.updatedAt) : "Not updated"}
          </dd>
        </div>
      </dl>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-strong)]">Primary pain</h3>
          <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">
            {request.primaryPain || request.useCase}
          </p>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-strong)]">Desired outcome</h3>
          <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">
            {request.desiredOutcome || "Not provided"}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {request.qualification.signals.length > 0 ? (
          request.qualification.signals.map((signal) => (
            <span key={signal} className="rounded-full bg-[var(--surface-mute)] px-3 py-1 text-xs font-semibold text-[var(--text-dim)]">
              {signal}
            </span>
          ))
        ) : (
          <span className="rounded-full bg-[var(--surface-mute)] px-3 py-1 text-xs font-semibold text-[var(--text-dim)]">
            no qualification signals
          </span>
        )}
      </div>

      {request.lifecycle?.operatorNote ? (
        <div className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface-mute)] p-4">
          <h3 className="text-sm font-semibold text-[var(--text-strong)]">Operator note</h3>
          <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">{request.lifecycle.operatorNote}</p>
        </div>
      ) : null}

      {request.activity?.length ? (
        <div className="mt-5 rounded-lg border border-[var(--border)] bg-white p-4">
          <h3 className="text-sm font-semibold text-[var(--text-strong)]">Activity</h3>
          <ol className="mt-3 grid gap-2">
            {request.activity.slice(-4).reverse().map((activity) => (
              <li key={activity.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium text-[var(--text-strong)]">{activity.summary}</span>
                <span className="text-xs font-semibold text-[var(--mute)]">{formatDate(activity.createdAt)}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <PilotRequestLifecycleControls request={request} />
    </article>
  );
}

export default async function PilotRequestsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCockpitAccess("/pilot-requests");

  const params = (await searchParams) ?? {};
  const filters = readPageFilters(params);
  const productionNeedsAuth = (process.env.NODE_ENV === "production" || process.env.VERCEL) && !isCockpitAuthRequired();
  const storage = getStoreHealth();
  let requests: PilotRequest[] = [];
  let readError = "";

  if (!productionNeedsAuth) {
    try {
      const allRequests = await getSignalOpsStore().listPilotRequests(100);
      requests = filterPilotRequestsForOperator(allRequests, filters).slice(0, 50);
    } catch (error) {
      readError = error instanceof Error ? error.message : "pilot request read failed";
    }
  }
  const summary = buildPilotRequestOperatorSummary(requests);

  return (
    <main className="min-h-screen bg-[var(--background)] px-5 py-8 text-[var(--text)] sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link href="/setup" className="text-sm font-semibold text-[var(--accent)]">
            Back to setup
          </Link>
          <div className="flex flex-wrap gap-3 text-sm font-semibold">
            <Link href="/cockpit" className="text-[var(--accent)]">
              Cockpit
            </Link>
            <Link href={apiHref(filters)} className="text-[var(--accent)]">
              Queue JSON
            </Link>
            <Link href={apiHref(filters, { format: "csv" })} className="text-[var(--accent)]">
              Export CSV
            </Link>
            <Link href="/pilot" className="text-[var(--accent)]">
              Public form
            </Link>
          </div>
        </div>

        <section className="mt-10">
          <p className="font-mono text-[11px] font-bold uppercase text-[var(--accent)]">Operator queue</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-[-0.03em] text-[var(--text-strong)]">
            Pilot requests
          </h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[var(--text-dim)]">
            This queue shows only submitted pilot requests from the configured store. There are no seeded
            leads here; an empty queue means no durable request has been captured in this environment.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <span className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold shadow-[var(--shadow-1)]">
              <Gauge className="size-4 text-[var(--accent)]" />
              {requests.length} request{requests.length === 1 ? "" : "s"}
            </span>
            <span className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold shadow-[var(--shadow-1)]">
              <ShieldCheck className="size-4 text-[var(--accent)]" />
              {storage.adapter}
              {storage.durable ? " durable" : " local"}
            </span>
          </div>
        </section>

        {!productionNeedsAuth && !readError ? (
          <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryTile
              label="Open"
              value={summary.openCount}
              detail={`${summary.byStatus.new} new, ${summary.byStatus.contacted} contacted`}
            />
            <SummaryTile
              label="Urgent open"
              value={summary.urgentOpenCount}
              detail={`${summary.byTier.urgent_fit} urgent-fit total`}
            />
            <SummaryTile
              label="Follow-up due"
              value={summary.needsFollowUpCount}
              detail={summary.nextActionDueAt ? formatDate(summary.nextActionDueAt) : "No due action"}
            />
            <SummaryTile
              label="Unscheduled"
              value={summary.unscheduledOpenCount}
              detail="Open requests without next action"
            />
          </dl>
        ) : null}

        {!productionNeedsAuth && !readError ? (
          <section className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface-mute)] p-4">
            <div className="flex flex-wrap gap-2">
              {(["all", "open", "due", "unscheduled"] as PilotRequestFollowUpFilter[]).map((item) => (
                <FilterLink
                  key={item}
                  active={(filters.followUp ?? "all") === item}
                  href={queueHref({ ...filters, followUp: item })}
                >
                  {item === "all" ? "All follow-up" : item}
                </FilterLink>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["new", "contacted", "pilot_scoped", "closed"] as PilotRequestStatus[]).map((item) => (
                <FilterLink
                  key={item}
                  active={filters.status === item}
                  href={queueHref({ ...filters, status: filters.status === item ? undefined : item })}
                >
                  {statusLabels[item]}
                </FilterLink>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["urgent_fit", "strong_fit", "evaluate"] as PilotQualification["tier"][]).map((item) => (
                <FilterLink
                  key={item}
                  active={filters.tier === item}
                  href={queueHref({ ...filters, tier: filters.tier === item ? undefined : item })}
                >
                  {tierLabels[item]}
                </FilterLink>
              ))}
            </div>
          </section>
        ) : null}

        {productionNeedsAuth ? <ProductionAuthNotice /> : null}
        {readError ? <QueueReadError message={readError} /> : null}

        {!productionNeedsAuth && !readError && requests.length === 0 ? (
          <section className="mt-8 rounded-lg border border-[var(--border)] bg-white p-8 text-center shadow-[var(--shadow-1)]">
            <Inbox className="mx-auto size-8 text-[var(--mute)]" />
            <h2 className="mt-4 text-lg font-semibold text-[var(--text-strong)]">No captured pilot requests</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[var(--text-dim)]">
              Connect D1/Supabase or a delivery path, then submit the public pilot form. Requests will
              appear here by qualification priority once storage is configured.
            </p>
          </section>
        ) : null}

        {!productionNeedsAuth && !readError && requests.length > 0 ? (
          <section className="mt-8 grid gap-5">
            {requests.map((request) => (
              <PilotRequestCard key={request.id} request={request} />
            ))}
          </section>
        ) : null}
      </div>
    </main>
  );
}
