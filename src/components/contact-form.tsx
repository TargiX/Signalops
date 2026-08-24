"use client";

import { ArrowRight, Check, LoaderCircle } from "lucide-react";
import { FormEvent, useState } from "react";

import { captureProductEvent, getPostHogRequestHeaders } from "@/lib/product-analytics";

export function ContactForm({ fallbackEmail }: { fallbackEmail?: string }) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const payload = {
      email: form.get("email"),
      company: form.get("company"),
      role: form.get("role"),
      category: form.get("category"),
      monthlyOperations: form.get("monthlyOperations"),
      useCase: form.get("useCase"),
      website: form.get("website"),
      sourcePath: window.location.pathname,
    };
    try {
      const response = await fetch("/api/pilot-requests", {
        method: "POST",
        headers: { "content-type": "application/json", ...getPostHogRequestHeaders() },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { code?: string; message?: string };
      if (!response.ok) {
        setError(
          response.status === 429
            ? "Too many requests were submitted from this network. Try again later."
            : body.code === "pilot_delivery_not_configured"
              ? "The request channel is temporarily unavailable. Use the direct email below."
              : body.message ?? "The request could not be delivered.",
        );
        return;
      }
      captureProductEvent("pilot_request_completed", {
        category: String(payload.category),
        monthly_operations: String(payload.monthlyOperations),
      });
      setSent(true);
    } catch {
      setError("SignalOps could not be reached. Try again or use the direct email below.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-emerald-900">
        <span className="grid size-10 place-items-center rounded-full bg-emerald-600 text-white"><Check className="size-5" /></span>
        <h2 className="mt-5 text-2xl font-semibold">Request received</h2>
        <p className="mt-3 text-sm leading-6">We have enough context to respond without another qualification form. Expect a direct reply about fit and the fastest integration path.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-[var(--border)] bg-white p-6 shadow-[var(--shadow-panel)] sm:p-8">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Work email" name="email" type="email" autoComplete="email" required />
        <Field label="Company or product" name="company" autoComplete="organization" required />
        <Field label="Your role" name="role" autoComplete="organization-title" />
        <label className="text-xs font-bold text-[var(--text)]">Primary goal
          <select name="category" defaultValue="observability" className="mt-2 h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm font-normal">
            <option value="observability">AI operations visibility</option>
            <option value="reliability">Provider reliability and incidents</option>
            <option value="cost">Cost evidence and leakage</option>
            <option value="migration">Replace or consolidate tooling</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="text-xs font-bold text-[var(--text)] sm:col-span-2">Monthly AI operations
          <select name="monthlyOperations" defaultValue="unknown" className="mt-2 h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm font-normal">
            <option value="unknown">Not sure yet</option>
            <option value="under_10k">Under 10,000</option>
            <option value="10k_100k">10,000 – 100,000</option>
            <option value="100k_1m">100,000 – 1 million</option>
            <option value="over_1m">More than 1 million</option>
          </select>
        </label>
        <label className="text-xs font-bold text-[var(--text)] sm:col-span-2">What should SignalOps help you decide or fix?
          <textarea name="useCase" required minLength={10} maxLength={2000} rows={6} className="mt-2 w-full resize-y rounded-lg border border-[var(--border)] bg-white p-3 text-sm font-normal leading-6" placeholder="For example: distinguish provider failures from application failures across retries and fallbacks…" />
        </label>
        <label className="hidden" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <button type="submit" disabled={busy} className="mt-6 inline-flex h-11 items-center gap-2 rounded-lg bg-[var(--accent)] px-5 text-sm font-bold text-white hover:bg-[var(--accent-hover)] disabled:opacity-60">
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : null} Request beta access <ArrowRight className="size-4" />
      </button>
      <p className="mt-4 text-[11px] leading-5 text-[var(--mute)]">Contact details are used only to respond to this request. Free-form text is never sent to product analytics.</p>
      {error ? <p role="alert" className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700 ring-1 ring-rose-200">{error}{fallbackEmail ? <> Email <a className="font-bold underline" href={`mailto:${fallbackEmail}`}>{fallbackEmail}</a>.</> : null}</p> : null}
    </form>
  );
}

function Field({ label, name, ...input }: { label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <label className="text-xs font-bold text-[var(--text)]">{label}<input name={name} {...input} className="mt-2 h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm font-normal" /></label>;
}
