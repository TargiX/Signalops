"use client";

import { CheckCircle2, Clipboard, Loader2, Play, XCircle } from "lucide-react";
import { useMemo, useState } from "react";

const sampleEvent = {
  type: "generation.completed",
  generationId: "gen_prod_001",
  providerId: "fal",
  modelId: "flux-2-pro",
  status: "succeeded",
  source: "production-api",
  durationMs: 18420,
  cost: 0.052,
  retryCount: 1,
  user: "user@example.com",
  prompt: "portrait prompt that should be redacted",
};

type ValidationResponse = {
  ok: boolean;
  code?: string;
  error?: string;
  verificationOnly?: boolean;
  validEvents?: number;
  rejectedEvents?: number;
  eventTypes?: string[];
  providerIds?: string[];
  modelIds?: string[];
  privacyMode?: "redact" | "raw";
  diagnostics?: {
    readiness: "insufficient" | "partial" | "pilot_ready";
    gaps: string[];
    nextActions: string[];
    coverage: {
      latency: boolean;
      cost: boolean;
      retries: boolean;
      providerHealth: boolean;
      providers: number;
      models: number;
    };
  };
  storedEvents?: number;
  rejected?: Array<{ index: number; error: string }>;
  requestId?: string;
};

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function EventValidatorPlayground() {
  const [payload, setPayload] = useState(formatJson(sampleEvent));
  const [result, setResult] = useState<ValidationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [copied, setCopied] = useState(false);

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

  async function validatePayload() {
    setCopied(false);
    setError(null);
    setResult(null);

    if (!parsedPayload.ok) {
      setError(parsedPayload.error);
      return;
    }

    setIsValidating(true);
    try {
      const response = await fetch("/api/events/validate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: formatJson(parsedPayload.value),
      });
      const json = (await response.json()) as ValidationResponse;
      setResult(json);
      if (!response.ok) {
        setError(json.error || json.code || `Validation failed with ${response.status}`);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Validation request failed");
    } finally {
      setIsValidating(false);
    }
  }

  async function copyPayload() {
    await navigator.clipboard.writeText(payload);
    setCopied(true);
  }

  const success = Boolean(result?.ok);

  return (
    <section className="mt-5 rounded-lg border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-strong)]">Event validator</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-dim)]">
            Paste one event or an <code>{"{ events: [...] }"}</code> batch. The request uses the public
            dry-run endpoint and stores zero events.
          </p>
        </div>
        <span className="rounded-full bg-[var(--surface-mute)] px-3 py-1 text-xs font-semibold text-[var(--text-dim)]">
          verification only
        </span>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="grid gap-3">
          <textarea
            value={payload}
            onChange={(event) => setPayload(event.target.value)}
            spellCheck={false}
            className="min-h-[360px] resize-y rounded-lg border border-[var(--border)] bg-[#07122b] p-4 font-mono text-xs leading-6 text-white outline-none focus:border-[var(--accent)]"
          />
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={validatePayload}
              disabled={isValidating}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isValidating ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Play className="mr-2 size-4" />}
              Validate event
            </button>
            <button
              type="button"
              onClick={copyPayload}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--text)]"
            >
              <Clipboard className="mr-2 size-4" />
              {copied ? "Copied" : "Copy JSON"}
            </button>
          </div>
        </div>

        <div className="min-h-[360px] rounded-lg border border-[var(--border)] bg-[var(--surface-mute)] p-4">
          <div className="flex items-center gap-2">
            {success ? (
              <CheckCircle2 className="size-5 text-[var(--success)]" />
            ) : error || result ? (
              <XCircle className="size-5 text-[var(--danger)]" />
            ) : (
              <Play className="size-5 text-[var(--accent)]" />
            )}
            <h3 className="text-sm font-semibold text-[var(--text-strong)]">
              {success ? "Contract accepted" : error || result ? "Contract rejected" : "Ready"}
            </h3>
          </div>

          {error ? <p className="mt-3 text-sm leading-6 text-[var(--danger)]">{error}</p> : null}

          {result ? (
            <dl className="mt-4 grid gap-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[var(--text-dim)]">Valid events</dt>
                <dd className="font-semibold text-[var(--text-strong)]">{result.validEvents ?? 0}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[var(--text-dim)]">Rejected events</dt>
                <dd className="font-semibold text-[var(--text-strong)]">{result.rejectedEvents ?? 0}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[var(--text-dim)]">Stored events</dt>
                <dd className="font-semibold text-[var(--text-strong)]">{result.storedEvents ?? 0}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[var(--text-dim)]">Privacy mode</dt>
                <dd className="font-semibold text-[var(--text-strong)]">{result.privacyMode ?? "redact"}</dd>
              </div>
              <div>
                <dt className="text-[var(--text-dim)]">Event types</dt>
                <dd className="mt-1 font-semibold text-[var(--text-strong)]">
                  {result.eventTypes?.join(", ") || "none"}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--text-dim)]">Providers</dt>
                <dd className="mt-1 font-semibold text-[var(--text-strong)]">
                  {result.providerIds?.join(", ") || "none"}
                </dd>
              </div>
              {result.diagnostics ? (
                <>
                  <div>
                    <dt className="text-[var(--text-dim)]">Readiness</dt>
                    <dd className="mt-1 font-semibold text-[var(--text-strong)]">
                      {result.diagnostics.readiness.replace("_", " ")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--text-dim)]">Coverage</dt>
                    <dd className="mt-1 flex flex-wrap gap-2">
                      {[
                        result.diagnostics.coverage.latency ? "latency" : "",
                        result.diagnostics.coverage.cost ? "cost" : "",
                        result.diagnostics.coverage.retries ? "retries" : "",
                        result.diagnostics.coverage.providerHealth ? "provider health" : "",
                      ].filter(Boolean).map((item) => (
                        <span key={item} className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-[var(--text-strong)]">
                          {item}
                        </span>
                      ))}
                    </dd>
                  </div>
                  {result.diagnostics.gaps.length ? (
                    <div>
                      <dt className="text-[var(--text-dim)]">Gaps</dt>
                      <dd className="mt-1 space-y-1 text-xs font-semibold text-[var(--text-strong)]">
                        {result.diagnostics.gaps.slice(0, 4).map((gap) => (
                          <p key={gap}>{gap}</p>
                        ))}
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="text-[var(--text-dim)]">Next actions</dt>
                    <dd className="mt-1 space-y-1 text-xs font-semibold text-[var(--text-strong)]">
                      {result.diagnostics.nextActions.map((action) => (
                        <p key={action}>{action}</p>
                      ))}
                    </dd>
                  </div>
                </>
              ) : null}
              {result.rejected?.length ? (
                <div>
                  <dt className="text-[var(--text-dim)]">Rejected detail</dt>
                  <dd className="mt-1 space-y-1 font-mono text-xs text-[var(--danger)]">
                    {result.rejected.map((item) => (
                      <p key={`${item.index}:${item.error}`}>
                        #{item.index}: {item.error}
                      </p>
                    ))}
                  </dd>
                </div>
              ) : null}
              {result.requestId ? (
                <div>
                  <dt className="text-[var(--text-dim)]">Request id</dt>
                  <dd className="mt-1 font-mono text-xs text-[var(--text-strong)]">{result.requestId}</dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <p className="mt-3 text-sm leading-6 text-[var(--text-dim)]">
              Validation results will appear here with the same summary returned by the API.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
