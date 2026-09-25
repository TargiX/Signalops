import Link from "next/link";
import { redirect } from "next/navigation";

import { hasValidCockpitSession, isCockpitAuthRequired, sanitizeNextPath } from "@/lib/signalops/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const next = sanitizeNextPath(params.next);

  if (!isCockpitAuthRequired() || (await hasValidCockpitSession())) {
    redirect(next);
  }

  return (
    <main className="min-h-screen bg-[var(--background)] px-5 py-8 text-[var(--text)] sm:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md flex-col justify-center">
        <Link href="/" className="text-sm font-semibold text-[var(--accent)]">
          Back to SignalOps
        </Link>
        <section className="mt-8 rounded-lg border border-[var(--border)] bg-white p-6 shadow-[var(--shadow-1)]">
          <p className="font-mono text-[11px] font-bold uppercase text-[var(--accent)]">Operator access</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-[var(--text-strong)]">
            Cockpit sign in
          </h1>
          <p className="mt-3 text-sm leading-6 text-[var(--text-dim)]">
            The public demo and API docs stay open. The cockpit, incidents, and source-event snapshot
            require operator access when production auth is enabled.
          </p>
          <form action="/api/auth/login" method="post" className="mt-6 grid gap-4">
            <input type="hidden" name="next" value={next} />
            <label className="grid gap-2 text-sm font-semibold text-[var(--text-strong)]">
              Password
              <input
                required
                autoComplete="current-password"
                name="password"
                type="password"
                className="h-11 rounded-lg border border-[var(--border)] bg-white px-3 text-sm outline-none focus:border-[var(--accent)]"
              />
            </label>
            {params.error ? (
              <p className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
                {params.error === "session_secret"
                  ? "Production cockpit sessions require SIGNALOPS_SESSION_SECRET before a browser session can be issued."
                  : "Password did not match the configured cockpit secret."}
              </p>
            ) : null}
            <button
              type="submit"
              className="inline-flex h-11 items-center justify-center rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white"
            >
              Sign in
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
