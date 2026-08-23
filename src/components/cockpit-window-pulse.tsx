import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Clock3,
  Minus,
  Table2,
  TriangleAlert,
} from "lucide-react";

import type {
  SignalOpsOpsRangeV1,
  SignalOpsTimelineBucketV1,
} from "@/lib/signalops/v1/ops-snapshot";
import type { SignalOpsTimelinePulseV1 } from "@/lib/signalops/v1/cockpit-view";

function formatBucket(value: string, range: SignalOpsOpsRangeV1): string {
  const options: Intl.DateTimeFormatOptions = range === "24h"
    ? { hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }
    : range === "7d"
      ? { weekday: "short", hour: "numeric", timeZone: "UTC", timeZoneName: "short" }
      : { month: "short", day: "numeric", timeZone: "UTC" };
  return new Intl.DateTimeFormat("en-US", options).format(new Date(value));
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function formatDuration(value: number | null): string {
  if (value === null) return "—";
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

function Delta({
  value,
  unit = "%",
  intent = "neutral",
}: {
  value: number | null;
  unit?: "%" | "pp";
  intent?: "neutral" | "risk";
}) {
  if (value === null) {
    return <span className="inline-flex items-center gap-1 text-[var(--mute)]"><Minus className="size-3" /> new baseline</span>;
  }
  const display = value * 100;
  const positive = display > 0;
  const negative = display < 0;
  const Icon = positive ? ArrowUpRight : negative ? ArrowDownRight : Minus;
  const tone = intent === "risk"
    ? positive
      ? "text-amber-700"
      : negative
        ? "text-emerald-700"
        : "text-[var(--mute)]"
    : positive || negative
      ? "text-blue-700"
      : "text-[var(--mute)]";
  const direction = positive ? "Increased" : negative ? "Decreased" : "Unchanged";
  return (
    <span
      className={`inline-flex items-center gap-1 ${tone}`}
      aria-label={`${direction} by ${Math.abs(display).toFixed(1)} ${unit === "pp" ? "percentage points" : "percent"}`}
    >
      <Icon aria-hidden="true" className="size-3" /> {Math.abs(display).toFixed(1)}{unit === "pp" ? "pp" : "%"}
    </span>
  );
}

function Peak({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface-mute)] p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[8px] font-bold uppercase tracking-[0.08em] text-[var(--mute)]">{label}</p>
        <Icon className="size-3.5 text-[var(--accent)]" />
      </div>
      <p className="mt-2 truncate text-sm font-semibold text-[var(--text-strong)]" title={value}>{value}</p>
      <p className="mt-1 truncate text-[9px] text-[var(--text-dim)]" title={detail}>{detail}</p>
    </div>
  );
}

export function CockpitWindowPulse({
  range,
  timeline,
  pulse,
}: {
  range: SignalOpsOpsRangeV1;
  timeline: readonly SignalOpsTimelineBucketV1[];
  pulse: SignalOpsTimelinePulseV1;
}) {
  const volumePeak = pulse.peaks.volume;
  const failurePeak = pulse.peaks.failureRate;
  const latencyPeak = pulse.peaks.latency;
  return (
    <section className="mt-4 rounded-xl border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-strong)]"><BarChart3 className="size-4 text-[var(--accent)]" /> Window pulse</h3>
          <p className="mt-1 text-[11px] text-[var(--text-dim)]">Recent half versus the earlier equal-duration half of this {range} snapshot</p>
        </div>
        <div className="grid grid-cols-2 gap-4 text-right text-[10px]">
          <div>
            <p className="font-mono uppercase text-[var(--mute)]">Operations</p>
            <p className="mt-1 font-semibold text-[var(--text-strong)]">{pulse.recent.operations} vs {pulse.earlier.operations}</p>
            <Delta value={pulse.operationDeltaRatio} />
          </div>
          <div>
            <p className="font-mono uppercase text-[var(--mute)]">Failure rate</p>
            <p className="mt-1 font-semibold text-[var(--text-strong)]">{formatPercent(pulse.recent.failureRate)} vs {formatPercent(pulse.earlier.failureRate)}</p>
            <Delta value={pulse.failureRateDelta} unit="pp" intent="risk" />
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Peak
          icon={Activity}
          label="Peak volume bucket"
          value={volumePeak ? `${volumePeak.operations} operations` : "No volume"}
          detail={volumePeak ? formatBucket(volumePeak.start, range) : "No canonical bucket evidence"}
        />
        <Peak
          icon={TriangleAlert}
          label="Highest failure-rate bucket"
          value={failurePeak && failurePeak.operations > 0 ? formatPercent(failurePeak.failedOperations / failurePeak.operations) : "No failures"}
          detail={failurePeak ? `${formatBucket(failurePeak.start, range)} · n=${failurePeak.operations}` : "No populated canonical bucket"}
        />
        <Peak
          icon={Clock3}
          label="Slowest bucket p95"
          value={formatDuration(latencyPeak?.p95DurationMs ?? null)}
          detail={latencyPeak ? formatBucket(latencyPeak.start, range) : "No terminal duration evidence"}
        />
      </div>

      <details className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface-mute)] open:bg-white">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-xs font-semibold text-[var(--text-strong)] marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
          <Table2 className="size-4 text-[var(--accent)]" /> View canonical timeline as a table
        </summary>
        <div className="overflow-x-auto border-t border-[var(--border)]">
          <table className="w-full min-w-[760px] text-left text-[10px]">
            <caption className="sr-only">Canonical {range} timeline buckets with operation, attempt, failure, and p95 latency evidence</caption>
            <thead className="bg-[var(--surface-mute)] font-mono uppercase tracking-[0.06em] text-[var(--mute)]">
              <tr><th className="px-3 py-2.5 font-semibold">Bucket UTC</th><th className="px-3 py-2.5 text-right font-semibold">Operations</th><th className="px-3 py-2.5 text-right font-semibold">Failures</th><th className="px-3 py-2.5 text-right font-semibold">Failure rate</th><th className="px-3 py-2.5 text-right font-semibold">Attempts</th><th className="px-3 py-2.5 text-right font-semibold">Failed attempts</th><th className="px-3 py-2.5 text-right font-semibold">Operation p95</th></tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-soft)]">
              {timeline.map((bucket) => (
                <tr key={bucket.start}>
                  <th scope="row" className="px-3 py-2.5 font-mono font-medium text-[var(--text-strong)]">{formatBucket(bucket.start, range)}</th>
                  <td className="px-3 py-2.5 text-right">{bucket.operations}</td>
                  <td className="px-3 py-2.5 text-right">{bucket.failedOperations}</td>
                  <td className="px-3 py-2.5 text-right">{formatPercent(bucket.operations === 0 ? null : bucket.failedOperations / bucket.operations)}</td>
                  <td className="px-3 py-2.5 text-right">{bucket.attempts}</td>
                  <td className="px-3 py-2.5 text-right">{bucket.failedAttempts}</td>
                  <td className="px-3 py-2.5 text-right">{formatDuration(bucket.p95DurationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="mt-3 text-[9px] leading-4 text-[var(--mute)]">Latency callouts are bucket-level p95 observations. They are not recombined into a synthetic percentile.</p>
    </section>
  );
}
