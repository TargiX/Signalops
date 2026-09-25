"use client";

import { Clipboard, Mail, Send } from "lucide-react";
import { type FormEvent, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type FormState =
  | { status: "idle"; message: string }
  | { status: "submitting"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

type PilotRequestResponse = {
  ok?: boolean;
  code?: string;
  error?: string;
  fallbackEmail?: string | null;
  fallbackPackage?: unknown;
  qualification?: {
    tier: string;
    signals: string[];
  };
  requestId?: string;
};

type PilotQualification = NonNullable<PilotRequestResponse["qualification"]>;

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}

function createFallbackPackage(
  payload: Record<string, FormDataEntryValue>,
  requestId?: string,
  qualification?: PilotRequestResponse["qualification"],
) {
  return JSON.stringify(
    {
      type: "signalops.pilot_request",
      createdAt: new Date().toISOString(),
      requestId,
      qualification,
      request: payload,
    },
    null,
    2,
  );
}

export function PilotRequestForm() {
  const [state, setState] = useState<FormState>({ status: "idle", message: "" });
  const [fallbackPackage, setFallbackPackage] = useState("");
  const [fallbackEmail, setFallbackEmail] = useState<string | null>(null);
  const [fallbackQualification, setFallbackQualification] = useState<PilotQualification | null>(null);
  const [copied, setCopied] = useState(false);

  async function submitPilotRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setState({ status: "submitting", message: "Sending request..." });
    setFallbackPackage("");
    setFallbackEmail(null);
    setFallbackQualification(null);
    setCopied(false);

    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());

    const response = await fetch("/api/pilot-requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as PilotRequestResponse;

    if (response.ok && result.ok) {
      form.reset();
      setState({
        status: "success",
        message: "Request received. The next step is a source-event validation and scoped pilot setup.",
      });
      return;
    }

    if (result.code === "pilot_intake_not_configured" || result.code === "pilot_intake_delivery_failed") {
      setFallbackPackage(
        JSON.stringify(
          result.fallbackPackage ?? JSON.parse(createFallbackPackage(payload, result.requestId, result.qualification)),
          null,
          2,
        ),
      );
      setFallbackEmail(result.fallbackEmail || null);
      setFallbackQualification(result.qualification || null);
    }

    setState({
      status: "error",
      message:
        result.code === "pilot_intake_not_configured"
          ? "Pilot intake is not connected yet. Keep this request package and use the event validator while delivery is being connected."
          : result.code === "pilot_intake_delivery_failed"
            ? "Pilot delivery failed. Keep this request package and use the event validator while delivery is repaired."
          : result.error || "Pilot request could not be sent.",
    });
  }

  async function copyFallbackPackage() {
    await navigator.clipboard.writeText(fallbackPackage);
    setCopied(true);
  }

  const fallbackMailto =
    fallbackEmail && fallbackPackage
      ? `mailto:${fallbackEmail}?subject=${encodeURIComponent("SignalOps pilot request")}&body=${encodeURIComponent(fallbackPackage)}`
      : null;

  return (
    <form onSubmit={submitPilotRequest} className="mt-8 grid gap-4 rounded-lg border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)]">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold text-[var(--text)]">
          Name
          <input name="name" required maxLength={120} className="h-11 rounded-lg border border-[var(--border)] px-3 text-sm" />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-[var(--text)]">
          Work email
          <input name="email" type="email" required maxLength={180} className="h-11 rounded-lg border border-[var(--border)] px-3 text-sm" />
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold text-[var(--text)]">
          Company
          <input name="company" maxLength={160} className="h-11 rounded-lg border border-[var(--border)] px-3 text-sm" />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-[var(--text)]">
          Product URL
          <input name="productUrl" type="url" maxLength={240} className="h-11 rounded-lg border border-[var(--border)] px-3 text-sm" />
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold text-[var(--text)]">
          Monthly generation volume
          <input
            name="generationVolume"
            required
            maxLength={120}
            placeholder="10k images/month, 2M tokens/day, etc."
            className="h-11 rounded-lg border border-[var(--border)] px-3 text-sm"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-[var(--text)]">
          Providers/models
          <input
            name="providers"
            required
            maxLength={240}
            placeholder="fal, OpenAI, Replicate, Gemini..."
            className="h-11 rounded-lg border border-[var(--border)] px-3 text-sm"
          />
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold text-[var(--text)]">
          Main pain
          <input
            name="primaryPain"
            required
            maxLength={500}
            placeholder="Retries, latency tails, provider incidents, cost drift..."
            className="h-11 rounded-lg border border-[var(--border)] px-3 text-sm"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-[var(--text)]">
          Urgency
          <select
            name="urgency"
            required
            defaultValue="this_month"
            className="h-11 rounded-lg border border-[var(--border)] bg-white px-3 text-sm"
          >
            <option value="exploring">Exploring fit</option>
            <option value="this_month">Need this month</option>
            <option value="blocked_now">Blocked right now</option>
          </select>
        </label>
      </div>
      <label className="grid gap-2 text-sm font-semibold text-[var(--text)]">
        AI generation workflow
        <textarea
          name="useCase"
          required
          minLength={20}
          maxLength={1400}
          rows={5}
          className="resize-y rounded-lg border border-[var(--border)] px-3 py-3 text-sm leading-6"
        />
      </label>
      <label className="grid gap-2 text-sm font-semibold text-[var(--text)]">
        What would make a pilot successful?
        <textarea
          name="desiredOutcome"
          required
          maxLength={500}
          rows={3}
          className="resize-y rounded-lg border border-[var(--border)] px-3 py-3 text-sm leading-6"
        />
      </label>
      <input type="hidden" name="source" value="pilot-page" />
      <input
        aria-hidden="true"
        autoComplete="off"
        className="hidden"
        name="website"
        tabIndex={-1}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={state.status === "submitting"}
          className={cn(
            buttonVariants({ size: "lg" }),
            "h-11 rounded-lg bg-[var(--accent)] px-5 text-[13px] font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-60",
          )}
        >
          <Send className="mr-2 size-4" />
          Request pilot
        </button>
        {state.message ? (
          <p className={cn("text-sm", state.status === "error" ? "text-[var(--danger)]" : "text-[var(--text-dim)]")}>
            {state.message}
          </p>
        ) : null}
      </div>
      {fallbackPackage ? (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-mute)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-strong)]">Pilot request package</h2>
              <p className="mt-1 text-sm leading-6 text-[var(--text-dim)]">
                Delivery is not connected, so the server did not store this request.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={copyFallbackPackage}
                className="inline-flex h-9 items-center rounded-lg border border-[var(--border)] bg-white px-3 text-xs font-semibold text-[var(--text)]"
              >
                <Clipboard className="mr-2 size-4" />
                {copied ? "Copied" : "Copy"}
              </button>
              {fallbackMailto ? (
                <a
                  href={fallbackMailto}
                  className="inline-flex h-9 items-center rounded-lg bg-[var(--accent)] px-3 text-xs font-semibold text-white"
                >
                  <Mail className="mr-2 size-4" />
                  Email
                </a>
              ) : null}
            </div>
          </div>
          {fallbackQualification ? (
            <div className="mt-4 rounded-lg border border-[var(--border)] bg-white p-3">
              <p className="text-xs font-bold uppercase text-[var(--accent)]">Fit summary</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[var(--surface-mute)] px-3 py-1 text-xs font-semibold text-[var(--text)]">
                  {formatLabel(fallbackQualification.tier)}
                </span>
                {fallbackQualification.signals.map((signal) => (
                  <span
                    key={signal}
                    className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--text-dim)]"
                  >
                    {formatLabel(signal)}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-[#07122b] p-4 text-xs leading-6 text-white">
            {fallbackPackage}
          </pre>
        </section>
      ) : null}
    </form>
  );
}
