import Link from "next/link";

import { PilotRequestForm } from "@/components/pilot-request-form";

export default function PilotPage() {
  return (
    <main className="min-h-screen bg-[var(--background)] px-5 py-8 text-[var(--text)] sm:px-8">
      <div className="mx-auto max-w-4xl">
        <Link href="/" className="text-sm font-semibold text-[var(--accent)]">
          Back to SignalOps
        </Link>
        <section className="mt-10">
          <h1 className="max-w-3xl text-4xl font-semibold tracking-[-0.03em] text-[var(--text-strong)]">
            Request a SignalOps pilot
          </h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[var(--text-dim)]">
            SignalOps is for teams running AI image or generation workflows who need provider,
            latency, retry, and cost visibility. A pilot starts with event validation, then a
            scoped source connection once durable intake and ingest auth are configured. The request
            asks for volume, providers, pain, urgency, and success criteria so the pilot can stay
            narrow and useful.
          </p>
        </section>
        <PilotRequestForm />
        <section className="mt-5 grid gap-5 md:grid-cols-2">
          <div className="rounded-lg border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)]">
            <h2 className="text-lg font-semibold text-[var(--text-strong)]">No production claim yet</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">
              The public demo remains a hosted demo until durable storage, real workspace identity,
              delivery, ingest auth, redacted privacy mode, and first real source traffic are
              connected. If delivery is not connected, the form gives the requester a copyable pilot
              package instead of silently dropping the request.
            </p>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-1)]">
            <h2 className="text-lg font-semibold text-[var(--text-strong)]">Try the contract first</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-dim)]">
              Use <Link href="/docs" className="font-semibold text-[var(--accent)]">the source docs</Link> to dry-run an event without storing data.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
