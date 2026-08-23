"use client";

import { CheckCircle2, Clipboard, ClipboardCheck, Loader2, ShieldAlert, Sparkles, XCircle } from "lucide-react";
import { useMemo, useState } from "react";

import {
  captureProductEvent,
  captureProductException,
  getPostHogRequestHeaders,
} from "@/lib/product-analytics";
import type { SignalEventValidationResponse } from "@/lib/signalops/events";

// The endpoint returns unknown JSON, so treat every field as optional; the shape
// itself is the server contract, imported type-only to stay in sync without drift.
type ValidationResponse = Partial<SignalEventValidationResponse>;

type IngestReceipt = {
  acceptedEvents?: number;
  rejectedEvents?: number;
  storedEvents?: number;
  duplicateEvents?: number;
  evictedEvents?: number;
  retainedEvents?: number;
  storage?: {
    adapter?: string;
    durable?: boolean;
    capacity?: number | null;
  };
};

type IngestResponse = {
  ok?: boolean;
  code?: string;
  error?: string;
  requestId?: string;
  partial?: boolean;
  receipt?: IngestReceipt;
  rejected?: Array<{ index: number; error: string }>;
};

const samples = [
  {
    id: "pilot-ready",
    label: "Pilot-ready batch",
    description: "Shows lifecycle, latency, cost, retries, and provider health coverage.",
    payload: {
      events: [
        {
          type: "generation.started",
          occurredAt: "2026-07-01T12:00:00.000Z",
          generationId: "gen_public_001",
          providerId: "fal",
          modelId: "flux-kontext-pro",
          source: "public-api",
          status: "running",
          user: "ops@signalops.cc",
          prompt: "cinematic portrait with rain",
        },
        {
          type: "generation.retrying",
          occurredAt: "2026-07-01T12:00:10.000Z",
          generationId: "gen_public_001",
          providerId: "fal",
          modelId: "flux-kontext-pro",
          source: "public-api",
          status: "retrying",
          retryCount: 1,
          durationMs: 8200,
        },
        {
          type: "generation.completed",
          occurredAt: "2026-07-01T12:00:31.000Z",
          generationId: "gen_public_001",
          providerId: "fal",
          modelId: "flux-kontext-pro",
          source: "public-api",
          status: "succeeded",
          durationMs: 18340,
          cost: 0.057,
        },
        {
          type: "provider.health",
          occurredAt: "2026-07-01T12:01:00.000Z",
          providerId: "fal",
          source: "health-monitor",
          statusMessage: "Latency stabilized after regional failover.",
        },
      ],
    },
  },
  {
    id: "partial",
    label: "Partial batch",
    description: "One accepted event and one rejected event to show batch-level feedback.",
    payload: {
      events: [
        {
          type: "generation.completed",
          occurredAt: "2026-07-01T11:55:00.000Z",
          generationId: "gen_partial_001",
          providerId: "alibaba",
          modelId: "wan-2.2-image",
          durationMs: 9110,
          cost: 0.031,
          user: "artist@example.com",
          prompt: "product photo on brushed steel",
        },
        {
          type: "generation.retrying",
          occurredAt: "3026-07-12T11:55:05.000Z",
          generationId: "gen_partial_001",
          providerId: "alibaba",
          modelId: "wan-2.2-image",
          retryCount: 1.5,
        },
      ],
    },
  },
  {
    id: "invalid",
    label: "Invalid event",
    description: "Highlights strict JSON-contract errors before any protected ingest exists.",
    payload: {
      type: "generation.completed",
      occurredAt: "3026-07-12T12:00:00.000Z",
      providerId: "qwen",
      modelId: "qwen-image-beta",
      durationMs: -1,
      cost: 0.02,
    },
  },
];

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function formatValidationHandoff(result: ValidationResponse) {
  const diagnostics = result.diagnostics;
  const coverage = [
    diagnostics?.coverage.generationLifecycle.started ? "started" : "",
    diagnostics?.coverage.generationLifecycle.completed ? "completed" : "",
    diagnostics?.coverage.generationLifecycle.failed ? "failed" : "",
    diagnostics?.coverage.generationLifecycle.retrying ? "retrying" : "",
    diagnostics?.coverage.latency ? "latency" : "",
    diagnostics?.coverage.cost ? "cost" : "",
    diagnostics?.coverage.retries ? "retries" : "",
    diagnostics?.coverage.providerHealth ? "provider health" : "",
  ].filter(Boolean);

  return [
    "SignalOps validation handoff",
    `Outcome: ${result.ok ? "contract accepted" : "contract rejected"}`,
    `Request ID: ${result.requestId ?? "not returned"}`,
    `Accepted: ${result.validEvents ?? 0} · Rejected: ${result.rejectedEvents ?? 0}`,
    `Readiness: ${diagnostics?.readiness ?? "not returned"}`,
    `Coverage: ${coverage.length ? coverage.join(", ") : "none reported"}`,
    `Providers: ${result.providerIds?.join(", ") || "none reported"}`,
    `Models: ${result.modelIds?.join(", ") || "none reported"}`,
    `Gaps: ${diagnostics?.gaps.length ? diagnostics.gaps.join("; ") : "none reported"}`,
    `Next actions: ${diagnostics?.nextActions.length ? diagnostics.nextActions.join("; ") : "none reported"}`,
    `Accepted preview: ${result.acceptedPreview?.length ? "redacted preview returned; no event was stored" : "no accepted preview returned"}`,
    "Endpoint: POST /api/events/validate (public verification only; zero storage)",
  ].join("\n");
}

function readinessTone(readiness: NonNullable<ValidationResponse["diagnostics"]>["readiness"]) {
  if (readiness === "pilot_ready") {
    return {
      label: "Pilot ready",
      className: "bg-[var(--success-soft)] text-[var(--success)] border-[var(--success)]/20",
    };
  }

  if (readiness === "partial") {
    return {
      label: "Partial",
      className: "bg-[var(--warning-soft)] text-[var(--warning)] border-[var(--warning)]/20",
    };
  }

  return {
    label: "Insufficient",
    className: "bg-[var(--danger-soft)] text-[var(--danger)] border-[var(--danger)]/20",
  };
}

export default function ValidatePage() {
  const [payload, setPayload] = useState(formatJson(samples[0].payload));
  const [result, setResult] = useState<ValidationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedHandoff, setCopiedHandoff] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [ingestToken, setIngestToken] = useState("");
  const [ingestResult, setIngestResult] = useState<IngestResponse | null>(null);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [isIngesting, setIsIngesting] = useState(false);

  const parsedPayload = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(payload) as unknown };
    } catch (parseError) {
      return {
        ok: false as const,
        error: parseError instanceof Error ? parseError.message : "Invalid JSON",
      };
    }
  }, [payload]);

  const readiness = result?.diagnostics ? readinessTone(result.diagnostics.readiness) : null;
  const statusIcon = result?.ok
    ? CheckCircle2
    : error || result || !parsedPayload.ok
      ? XCircle
      : ShieldAlert;

  async function runValidation() {
    setCopied(false);
    setCopiedHandoff(false);
    setHandoffError(null);
    setError(null);
    setResult(null);

    if (!parsedPayload.ok) {
      setError(parsedPayload.error);
      captureProductEvent("signal_validation_blocked", {
        reason: "invalid_json",
      });
      return;
    }

    setIsValidating(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch("/api/events/validate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...getPostHogRequestHeaders(),
        },
        body: formatJson(parsedPayload.value),
        signal: controller.signal,
      });
      const json = (await response.json()) as ValidationResponse;
      setResult(json);
      captureProductEvent("signal_validation_received", {
        success: Boolean(json.ok),
        status_code: response.status,
        outcome_code: json.code ?? (response.ok ? "accepted" : "rejected"),
        valid_events: json.validEvents ?? 0,
        rejected_events: json.rejectedEvents ?? 0,
        readiness: json.diagnostics?.readiness,
      });
      if (!response.ok) {
        setError(json.error ?? json.code ?? `Validation failed with ${response.status}`);
      }
    } catch (requestError) {
      captureProductException(requestError, {
        flow: "signal_validation",
      });
      setError(
        requestError instanceof Error && requestError.name === "AbortError"
          ? "Validation timed out after 15 seconds."
          : requestError instanceof Error
            ? requestError.message
            : "Validation request failed",
      );
    } finally {
      clearTimeout(timeout);
      setIsValidating(false);
    }
  }

  async function copyPayload() {
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      captureProductEvent("signal_payload_copied");
    } catch (clipboardError) {
      captureProductException(clipboardError, { flow: "copy_signal_payload" });
      setError(clipboardError instanceof Error ? clipboardError.message : "Copy failed");
    }
  }

  async function copyValidationHandoff() {
    if (!result) {
      return;
    }

    setCopiedHandoff(false);
    setHandoffError(null);
    try {
      await navigator.clipboard.writeText(formatValidationHandoff(result));
      setCopiedHandoff(true);
      captureProductEvent("validation_handoff_copied", {
        success: Boolean(result.ok),
        readiness: result.diagnostics?.readiness,
      });
    } catch (clipboardError) {
      captureProductException(clipboardError, {
        flow: "copy_validation_handoff",
      });
      setHandoffError(clipboardError instanceof Error ? clipboardError.message : "Copy failed");
    }
  }

  async function runProtectedIngest() {
    setIngestError(null);
    setIngestResult(null);

    if (!parsedPayload.ok) {
      setIngestError(`Fix local JSON before ingesting: ${parsedPayload.error}`);
      captureProductEvent("protected_ingest_blocked", {
        reason: "invalid_json",
      });
      return;
    }

    const token = ingestToken.trim();
    if (!token) {
      setIngestError("Enter a development bearer token before sending to protected ingest.");
      captureProductEvent("protected_ingest_blocked", {
        reason: "missing_token",
      });
      return;
    }

    setIsIngesting(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch("/api/events", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...getPostHogRequestHeaders(),
        },
        body: formatJson(parsedPayload.value),
        signal: controller.signal,
      });
      const json = (await response.json()) as IngestResponse;
      setIngestResult(json);
      captureProductEvent("protected_ingest_received", {
        success: Boolean(json.ok),
        status_code: response.status,
        outcome_code: json.code ?? (response.ok ? "accepted" : "rejected"),
        stored_events: json.receipt?.storedEvents ?? 0,
        duplicate_events: json.receipt?.duplicateEvents ?? 0,
        durable_storage: json.receipt?.storage?.durable,
      });

      if (!response.ok || !json.ok) {
        setIngestError(json.error ?? json.code ?? `Protected ingest failed with ${response.status}`);
      }
    } catch (requestError) {
      captureProductException(requestError, {
        flow: "protected_ingest",
      });
      setIngestError(
        requestError instanceof Error && requestError.name === "AbortError"
          ? "Protected ingest timed out after 15 seconds."
          : requestError instanceof Error
            ? requestError.message
            : "Protected ingest request failed.",
      );
    } finally {
      clearTimeout(timeout);
      setIsIngesting(false);
    }
  }

  function loadSample(sampleId: string) {
    const sample = samples.find((entry) => entry.id === sampleId);
    if (!sample) {
      return;
    }

    setCopied(false);
    setCopiedHandoff(false);
    setHandoffError(null);
    setError(null);
    setResult(null);
    setPayload(formatJson(sample.payload));
    captureProductEvent("validation_sample_loaded", {
      sample_id: sample.id,
    });
  }

  const StatusIcon = statusIcon;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(52,89,223,0.16),_transparent_28%),linear-gradient(180deg,_#f7f9ff_0%,_#fbfcff_42%,_#eef4ff_100%)]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
        <section className="overflow-hidden rounded-[28px] border border-white/70 bg-white/85 shadow-[var(--shadow-panel)] backdrop-blur">
          <div className="grid gap-8 px-6 py-7 lg:grid-cols-[1.15fr_0.85fr] lg:px-8 lg:py-8">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-mute)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-dim)]">
                <Sparkles className="size-3.5" />
                Public validator
              </div>
              <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-[var(--text-strong)] sm:text-5xl">
                Validate SignalOps event payloads before you wire protected ingest.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--text-dim)] sm:text-base">
                This endpoint is public, zero-storage, and strict on shape. It validates a single event or a
                bounded batch, redacts `user` and `prompt`, and returns readiness feedback plus the gaps
                still blocking a real ingest path.
              </p>
            </div>

            <div className="grid gap-3 rounded-[24px] border border-[var(--border)] bg-[linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(237,243,255,0.9))] p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-dim)]">
                    Request bounds
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-[var(--text-strong)]">256 KB</p>
                  <p className="mt-1 text-sm text-[var(--text-dim)]">Header and actual UTF-8 body both enforced.</p>
                </div>
                <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-dim)]">
                    Batch bounds
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-[var(--text-strong)]">100 events</p>
                  <p className="mt-1 text-sm text-[var(--text-dim)]">Partial rejection supported inside the limit.</p>
                </div>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-mute)] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-dim)]">
                  Current contract
                </p>
                <ul className="mt-3 grid gap-2 text-sm leading-6 text-[var(--text)]">
                  <li>Public `POST /api/events/validate` accepts `application/json` only.</li>
                  <li>Telemetry must be finite and nonnegative; `retryCount` must be an integer.</li>
                  <li>Future timestamps are rejected. Accepted previews are redacted and never stored.</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-[28px] border border-white/75 bg-white/90 p-5 shadow-[var(--shadow-2)] backdrop-blur sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.03em] text-[var(--text-strong)]">
                  Editable playground
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-dim)]">
                  Start with a sample, edit the JSON, then run the same validator response your integration
                  would receive from the public dry-run endpoint.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {samples.map((sample) => (
                  <button
                    key={sample.id}
                    type="button"
                    onClick={() => loadSample(sample.id)}
                    className="rounded-full border border-[var(--border)] bg-[var(--surface-mute)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  >
                    {sample.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 grid gap-3">
              {samples.map((sample) => (
                <div
                  key={`${sample.id}-note`}
                  className="rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-mute)] px-4 py-3 text-sm text-[var(--text-dim)]"
                >
                  <span className="font-semibold text-[var(--text-strong)]">{sample.label}:</span> {sample.description}
                </div>
              ))}
            </div>

            <textarea
              aria-label="SignalOps event payload JSON"
              value={payload}
              onChange={(event) => {
                setPayload(event.target.value);
                setCopied(false);
                setCopiedHandoff(false);
                setHandoffError(null);
                setIngestResult(null);
                setIngestError(null);
                setError(null);
                setResult(null);
              }}
              spellCheck={false}
              className="mt-5 min-h-[480px] w-full resize-y rounded-[24px] border border-[#162241] bg-[#07122b] p-5 font-mono text-xs leading-6 text-[#f4f7ff] outline-hidden transition focus:border-[var(--accent)]"
            />

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={runValidation}
                disabled={isValidating}
                className="inline-flex h-11 items-center justify-center rounded-full bg-[var(--accent)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isValidating ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Sparkles className="mr-2 size-4" />}
                Validate payload
              </button>
              <button
                type="button"
                onClick={copyPayload}
                className="inline-flex h-11 items-center justify-center rounded-full border border-[var(--border)] bg-white px-5 text-sm font-semibold text-[var(--text)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                <Clipboard className="mr-2 size-4" />
                {copied ? "Copied" : "Copy JSON"}
              </button>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/75 bg-white/90 p-5 shadow-[var(--shadow-2)] backdrop-blur sm:p-6">
            <div aria-live="polite" className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-[var(--surface-mute)] text-[var(--text-strong)]">
                <StatusIcon className="size-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.03em] text-[var(--text-strong)]">
                  {result?.ok
                    ? "Contract accepted"
                    : error || result || !parsedPayload.ok
                      ? "Contract rejected"
                      : "Ready to validate"}
                </h2>
                <p className="mt-1 text-sm text-[var(--text-dim)]">
                  Public verification only. No events are persisted from this endpoint.
                </p>
                <p className="sr-only">
                  {!parsedPayload.ok
                    ? `Local JSON error: ${parsedPayload.error}`
                    : error
                      ? error
                      : result
                        ? `${result.validEvents ?? 0} accepted, ${result.rejectedEvents ?? 0} rejected.`
                        : "Enter a payload to validate."}
                </p>
              </div>
            </div>

            {!parsedPayload.ok ? (
              <div className="mt-5 rounded-2xl border border-[var(--danger)]/15 bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger)]">
                Local JSON error: {parsedPayload.error}
              </div>
            ) : null}

            {error ? (
              <div className="mt-5 rounded-2xl border border-[var(--danger)]/15 bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger)]">
                {error}
              </div>
            ) : null}

            {result ? (
              <div className="mt-5 grid gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-mute)] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-dim)]">Accepted</p>
                    <p className="mt-2 text-3xl font-semibold text-[var(--text-strong)]">{result.validEvents ?? 0}</p>
                  </div>
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-mute)] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-dim)]">Rejected</p>
                    <p className="mt-2 text-3xl font-semibold text-[var(--text-strong)]">{result.rejectedEvents ?? 0}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--text)]">
                    Zero storage: {String(result.storedEvents ?? 0)}
                  </span>
                  <span className="rounded-full border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--text)]">
                    Partial rejection: {result.partial ? "yes" : "no"}
                  </span>
                  {readiness ? (
                    <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${readiness.className}`}>
                      {readiness.label}
                    </span>
                  ) : null}
                </div>

                <div className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-mute)] p-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-dim)]">Coverage</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {[
                        result.diagnostics?.coverage.generationLifecycle.started ? "started" : "",
                        result.diagnostics?.coverage.generationLifecycle.completed ? "completed" : "",
                        result.diagnostics?.coverage.generationLifecycle.failed ? "failed" : "",
                        result.diagnostics?.coverage.generationLifecycle.retrying ? "retrying" : "",
                        result.diagnostics?.coverage.latency ? "latency" : "",
                        result.diagnostics?.coverage.cost ? "cost" : "",
                        result.diagnostics?.coverage.retries ? "retries" : "",
                        result.diagnostics?.coverage.providerHealth ? "provider health" : "",
                      ]
                        .filter(Boolean)
                        .map((item) => (
                          <span
                            key={item}
                            className="rounded-full border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--text)]"
                          >
                            {item}
                          </span>
                        ))}
                    </div>
                  </div>
                  <div className="grid gap-2 text-sm text-[var(--text)]">
                    <p>
                      Providers: <span className="font-semibold">{result.providerIds?.join(", ") || "none"}</span>
                    </p>
                    <p>
                      Models: <span className="font-semibold">{result.modelIds?.join(", ") || "none"}</span>
                    </p>
                    <p>
                      Event types: <span className="font-semibold">{result.eventTypes?.join(", ") || "none"}</span>
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-dim)]">Readiness gaps</p>
                    <div className="mt-3 grid gap-2 text-sm leading-6 text-[var(--text)]">
                      {(result.diagnostics?.gaps.length ? result.diagnostics.gaps : ["No additional gaps reported."]).map(
                        (gap) => (
                          <p key={gap}>{gap}</p>
                        ),
                      )}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-dim)]">Next actions</p>
                    <div className="mt-3 grid gap-2 text-sm leading-6 text-[var(--text)]">
                      {(result.diagnostics?.nextActions.length
                        ? result.diagnostics.nextActions
                        : ["Run a valid batch to receive readiness guidance."]).map((action) => (
                        <p key={action}>{action}</p>
                      ))}
                    </div>
                  </div>
                </div>

                {result.rejected?.length ? (
                  <div className="rounded-2xl border border-[var(--danger)]/15 bg-[var(--danger-soft)] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--danger)]">
                      Rejected events
                    </p>
                    <div className="mt-3 grid gap-2 font-mono text-xs leading-5 text-[var(--danger)]">
                      {result.rejected.map((item) => (
                        <p key={`${item.index}-${item.error}`}>
                          #{item.index}: {item.error}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}

                {result.acceptedPreview?.length ? (
                  <div className="rounded-2xl border border-[var(--border)] bg-[#07122b] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#9cb3ff]">Accepted preview</p>
                    <pre className="mt-3 overflow-x-auto font-mono text-xs leading-6 text-[#f4f7ff]">
                      {formatJson(result.acceptedPreview)}
                    </pre>
                  </div>
                ) : null}

                <div className="grid gap-2 text-xs text-[var(--text-dim)]">
                  <p>Request id: {result.requestId ?? "pending"}</p>
                  <p>
                    Returned limits: {result.limits?.maxBodyBytes ?? 262144} bytes, {result.limits?.maxBatchEvents ?? 100} events
                  </p>
                </div>

                <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-dim)]">
                        Integration handoff
                      </p>
                      <p className="mt-2 max-w-md text-sm leading-6 text-[var(--text)]">
                        Copy a compact receipt with this result&apos;s readiness, coverage, gaps, and zero-storage preview status.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={copyValidationHandoff}
                      className="inline-flex h-10 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-mute)] px-4 text-sm font-semibold text-[var(--text)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                    >
                      {copiedHandoff ? <ClipboardCheck className="mr-2 size-4" /> : <Clipboard className="mr-2 size-4" />}
                      {copiedHandoff ? "Handoff copied" : "Copy handoff"}
                    </button>
                  </div>
                  {handoffError ? (
                    <p aria-live="polite" className="mt-3 text-sm text-[var(--danger)]">
                      Could not copy handoff: {handoffError}
                    </p>
                  ) : null}
                </div>

                <section
                  aria-labelledby="protected-ingest-title"
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface-mute)] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-dim)]">
                        Protected ingest
                      </p>
                      <h3 id="protected-ingest-title" className="mt-2 text-base font-semibold text-[var(--text-strong)]">
                        Send this payload to your configured development ingress
                      </h3>
                      <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--text-dim)]">
                        This calls <code>POST /api/events</code> with the same JSON and returns its real
                        storage receipt. The token is used for this request only and is never saved.
                      </p>
                    </div>
                    <span className="rounded-full border border-[var(--warning)]/20 bg-[var(--warning-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--warning)]">
                      Development only
                    </span>
                  </div>

                  <label className="mt-4 block">
                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-dim)]">
                      Development bearer token
                    </span>
                    <input
                      aria-describedby="protected-ingest-token-note"
                      autoComplete="off"
                      onChange={(event) => {
                        setIngestToken(event.target.value);
                        setIngestError(null);
                        setIngestResult(null);
                      }}
                      placeholder="Paste SIGNALOPS_INGEST_TOKEN"
                      type="password"
                      value={ingestToken}
                      className="mt-2 h-11 w-full rounded-xl border border-[var(--border)] bg-white px-3 text-sm text-[var(--text-strong)] outline-hidden transition focus:border-[var(--accent)]"
                    />
                    <span id="protected-ingest-token-note" className="mt-2 block text-xs leading-5 text-[var(--text-dim)]">
                      Production intentionally rejects the development memory adapter. A configured local receipt
                      states its storage durability explicitly.
                    </span>
                  </label>

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled={isIngesting || isValidating}
                      onClick={runProtectedIngest}
                      className="inline-flex h-10 items-center justify-center rounded-full bg-[var(--text-strong)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--text)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isIngesting ? <Loader2 className="mr-2 size-4 animate-spin" /> : <ShieldAlert className="mr-2 size-4" />}
                      {isIngesting ? "Sending to protected ingest" : "Send to protected ingest"}
                    </button>
                    {ingestResult?.requestId ? <span className="text-xs text-[var(--text-dim)]">Request id: {ingestResult.requestId}</span> : null}
                  </div>

                  {ingestError ? (
                    <p role="alert" className="mt-4 rounded-xl border border-[var(--danger)]/15 bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]">
                      Protected ingest did not accept this request: {ingestError}
                    </p>
                  ) : null}

                  {ingestResult?.ok && ingestResult.receipt ? (
                    <div className="mt-4 grid gap-3">
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        {[
                          ["stored", ingestResult.receipt.storedEvents ?? 0],
                          ["duplicates", ingestResult.receipt.duplicateEvents ?? 0],
                          ["evicted", ingestResult.receipt.evictedEvents ?? 0],
                          ["retained", ingestResult.receipt.retainedEvents ?? 0],
                        ].map(([label, value]) => (
                          <div key={label as string} className="rounded-xl border border-[var(--border)] bg-white p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-dim)]">{label}</p>
                            <p className="mt-1 text-xl font-semibold text-[var(--text-strong)]">{value}</p>
                          </div>
                        ))}
                      </div>
                      <p className="rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text)]">
                        Receipt: {ingestResult.receipt.storage?.adapter ?? "unknown"} adapter · {ingestResult.receipt.storage?.durable ? "durable storage" : "non-durable storage"}
                        {ingestResult.receipt.storage?.capacity != null ? ` · capacity ${ingestResult.receipt.storage.capacity}` : ""}
                        {ingestResult.partial ? " · partial acceptance" : ""}
                      </p>
                    </div>
                  ) : null}
                </section>
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-mute)] p-5 text-sm leading-6 text-[var(--text-dim)]">
                The response pane will show accepted counts, rejected item detail, readiness, gaps, and a redacted
                preview of the first accepted events.
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
