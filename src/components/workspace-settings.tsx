"use client";

import {
  Activity,
  ArrowLeft,
  Check,
  Clipboard,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { getPostHogRequestHeaders, identifyProductUser } from "@/lib/product-analytics";

type Credential = {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  rotatedFromId: string | null;
  revokedAt: string | null;
};

type Session = {
  tenantId: string;
  tenantName: string;
  subject: string;
  role: "owner" | "operator" | "viewer";
};

function formatDate(value: string | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

function credentialState(credential: Credential): "active" | "expired" | "revoked" {
  if (credential.revokedAt) return "revoked";
  if (credential.expiresAt && Date.parse(credential.expiresAt) <= Date.now()) return "expired";
  return "active";
}

export function WorkspaceSettings() {
  const [session, setSession] = useState<Session | null>(null);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [name, setName] = useState("Production telemetry");
  const [secret, setSecret] = useState<{ token: string; label: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    try {
      const [sessionResponse, credentialsResponse] = await Promise.all([
        fetch("/api/cockpit/session", { cache: "no-store" }),
        fetch("/api/workspace/credentials", { cache: "no-store" }),
      ]);
      const sessionBody = (await sessionResponse.json()) as { session?: Session | null };
      const credentialBody = (await credentialsResponse.json()) as {
        code?: string;
        credentials?: Credential[];
      };
      if (!sessionBody.session) {
        setSession(null);
        setError("Sign in to manage workspace credentials.");
        return;
      }
      setSession(sessionBody.session);
      identifyProductUser({
        subject: sessionBody.session.subject,
        tenantId: sessionBody.session.tenantId,
        role: sessionBody.session.role,
      });
      if (!credentialsResponse.ok) {
        setError(
          credentialBody.code === "owner_required"
            ? "Only workspace owners can manage ingest credentials."
            : "Credential storage is currently unavailable.",
        );
        return;
      }
      setCredentials(credentialBody.credentials ?? []);
    } catch {
      setError("SignalOps could not load workspace settings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  function refresh() {
    setLoading(true);
    setError("");
    void load();
  }

  async function createCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyId("create");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/workspace/credentials", {
        method: "POST",
        headers: { "content-type": "application/json", ...getPostHogRequestHeaders() },
        body: JSON.stringify({ name, expiresInDays: 90 }),
      });
      const body = (await response.json()) as {
        code?: string;
        message?: string;
        credential?: Credential;
        token?: string;
      };
      if (!response.ok || !body.credential || !body.token) {
        setError(
          body.code === "credential_name_conflict"
            ? "An active key already uses that label."
            : body.message ?? "The credential could not be issued.",
        );
        return;
      }
      setCredentials((current) => [body.credential!, ...current]);
      setSecret({ token: body.token, label: body.credential.name });
      setNotice("Credential issued. Copy it now; the raw secret is not stored.");
    } catch {
      setError("SignalOps could not issue the credential.");
    } finally {
      setBusyId(null);
    }
  }

  async function rotateCredential(credential: Credential) {
    setBusyId(credential.id);
    setError("");
    setNotice("");
    const suffix = new Date().toISOString().slice(0, 10);
    try {
      const response = await fetch(`/api/workspace/credentials/${encodeURIComponent(credential.id)}/rotate`, {
        method: "POST",
        headers: { "content-type": "application/json", ...getPostHogRequestHeaders() },
        body: JSON.stringify({ name: `${credential.name} · ${suffix}`, expiresInDays: 90 }),
      });
      const body = (await response.json()) as {
        message?: string;
        credential?: Credential;
        token?: string;
      };
      if (!response.ok || !body.credential || !body.token) {
        setError(body.message ?? "The credential could not be rotated.");
        return;
      }
      setCredentials((current) => [
        body.credential!,
        ...current.map((item) =>
          item.id === credential.id
            ? { ...item, revokedAt: new Date().toISOString() }
            : item,
        ),
      ]);
      setSecret({ token: body.token, label: body.credential.name });
      setNotice("Replacement issued and the previous key revoked atomically.");
    } catch {
      setError("SignalOps could not rotate the credential.");
    } finally {
      setBusyId(null);
    }
  }

  async function revokeCredential(credential: Credential) {
    if (!window.confirm(`Revoke “${credential.name}”? Producers using it will stop ingesting immediately.`)) return;
    setBusyId(credential.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/workspace/credentials/${encodeURIComponent(credential.id)}`, {
        method: "DELETE",
        headers: getPostHogRequestHeaders(),
      });
      const body = (await response.json()) as { credential?: { revokedAt?: string } };
      if (!response.ok) {
        setError("The credential could not be revoked.");
        return;
      }
      setCredentials((current) =>
        current.map((item) =>
          item.id === credential.id
            ? { ...item, revokedAt: body.credential?.revokedAt ?? new Date().toISOString() }
            : item,
        ),
      );
      setNotice("Credential revoked. This action is recorded in the workspace audit log.");
    } catch {
      setError("SignalOps could not revoke the credential.");
    } finally {
      setBusyId(null);
    }
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.token);
      setNotice("Secret copied. Store it in a server-side secret manager.");
    } catch {
      setError("Clipboard access is unavailable.");
    }
  }

  const activeCredentials = credentials.filter((item) => credentialState(item) === "active");
  return (
    <main className="min-h-screen bg-[#f8faff] px-5 py-7 text-[var(--text)] sm:px-8">
      <div className="mx-auto max-w-[1120px]">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] pb-5">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg bg-[var(--accent)] text-white"><Activity className="size-4" /></span>
            <div>
              <p className="text-sm font-bold text-[var(--text-strong)]">SignalOps settings</p>
              <p className="mt-0.5 text-xs text-[var(--text-dim)]">{session?.tenantName ?? "Workspace access"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={refresh} disabled={loading} className="grid size-9 place-items-center rounded-lg border border-[var(--border)] bg-white text-[var(--text-dim)] hover:text-[var(--accent)]" aria-label="Refresh settings"><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /></button>
            <Link href="/cockpit" className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-3 text-xs font-bold text-[var(--text-dim)] hover:text-[var(--accent)]"><ArrowLeft className="size-3.5" /> Cockpit</Link>
          </div>
        </header>

        <section className="mt-8 grid gap-6 lg:grid-cols-[0.75fr_1.25fr] lg:items-start">
          <div className="rounded-xl border border-[var(--border)] bg-white p-6 shadow-sm">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--accent)]">Credential policy</p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-[var(--text-strong)]">Server-side ingest keys</h1>
            <p className="mt-3 text-sm leading-6 text-[var(--text-dim)]">Keys are tenant-scoped, revocable, and stored only as SHA-256 digests. Create separate keys per production service so rotation and incident response stay bounded.</p>
            <div className="mt-6 grid gap-3 text-xs text-[var(--text-dim)]">
              <PolicyLine text="Never expose a key in browser or mobile code" />
              <PolicyLine text="Rotate at least every 90 days" />
              <PolicyLine text="One key per independently deployed producer" />
              <PolicyLine text="Revocation is immediate and audit logged" />
            </div>
            {session?.role === "owner" ? (
              <form onSubmit={createCredential} className="mt-7 border-t border-[var(--border)] pt-6">
                <label htmlFor="new-key-name" className="text-xs font-bold text-[var(--text)]">New credential label</label>
                <input id="new-key-name" required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-[var(--border)] px-3 text-sm" />
                <button type="submit" disabled={busyId !== null} className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-sm font-bold text-white hover:bg-[var(--accent-hover)] disabled:opacity-60">
                  {busyId === "create" ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />} Issue 90-day credential
                </button>
              </form>
            ) : null}
          </div>

          <div className="min-w-0">
            {secret ? (
              <section className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-amber-950">One-time secret · {secret.label}</p>
                    <p className="mt-2 break-all font-mono text-xs leading-5 text-amber-900">{secret.token}</p>
                  </div>
                  <button type="button" onClick={() => void copySecret()} className="inline-flex h-9 items-center gap-2 rounded-lg bg-amber-950 px-3 text-xs font-bold text-white"><Clipboard className="size-3.5" /> Copy</button>
                </div>
              </section>
            ) : null}

            <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
                <div>
                  <h2 className="text-sm font-bold text-[var(--text-strong)]">Ingest credentials</h2>
                  <p className="mt-1 text-xs text-[var(--text-dim)]">{activeCredentials.length} active · {credentials.length} total</p>
                </div>
                <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200"><ShieldCheck className="size-3" /> Digest-only storage</span>
              </div>
              {loading ? (
                <div className="grid min-h-48 place-items-center text-sm text-[var(--text-dim)]"><LoaderCircle className="size-5 animate-spin" /></div>
              ) : credentials.length === 0 ? (
                <div className="p-8 text-center text-sm leading-6 text-[var(--text-dim)]">No credentials yet. Issue one for your first server-side producer.</div>
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {credentials.map((credential) => {
                    const state = credentialState(credential);
                    return (
                      <article key={credential.id} className="p-5">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-sm font-bold text-[var(--text-strong)]">{credential.name}</h3>
                              <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${state === "active" ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-slate-100 text-slate-600 ring-1 ring-slate-200"}`}>{state}</span>
                            </div>
                            <p className="mt-2 font-mono text-[11px] text-[var(--text-dim)]">{credential.tokenPrefix}••••••••</p>
                            <div className="mt-3 grid gap-1 text-[11px] leading-5 text-[var(--mute)] sm:grid-cols-2 sm:gap-x-6">
                              <span>Created · {formatDate(credential.createdAt)}</span>
                              <span>Expires · {formatDate(credential.expiresAt)}</span>
                              <span>Last used · {formatDate(credential.lastUsedAt)}</span>
                              <span>Scopes · {credential.scopes.join(", ")}</span>
                            </div>
                          </div>
                          {state === "active" && session?.role === "owner" ? (
                            <div className="flex items-center gap-2">
                              <button type="button" disabled={busyId !== null} onClick={() => void rotateCredential(credential)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-3 text-xs font-bold text-[var(--text-dim)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50">
                                {busyId === credential.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />} Rotate
                              </button>
                              <button type="button" disabled={busyId !== null} onClick={() => void revokeCredential(credential)} className="grid size-9 place-items-center rounded-lg border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 disabled:opacity-50" aria-label={`Revoke ${credential.name}`}><Trash2 className="size-3.5" /></button>
                            </div>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </section>
        {error ? <p role="alert" className="mt-5 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 ring-1 ring-rose-200">{error}</p> : null}
        {notice ? <p aria-live="polite" className="mt-5 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">{notice}</p> : null}
      </div>
    </main>
  );
}

function PolicyLine({ text }: { text: string }) {
  return <span className="flex items-start gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /> {text}</span>;
}
