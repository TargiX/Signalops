"use client";

import {
  ArrowRight,
  Building2,
  Check,
  CircleDot,
  Clipboard,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  RadioTower,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  captureProductEvent,
  getPostHogRequestHeaders,
  identifyProductUser,
} from "@/lib/product-analytics";
import { buildSignalOpsRawHttpQuickstartV1 } from "@/lib/signalops/v1/quickstart";

type Stage = "account" | "workspace" | "credential" | "signal";

type AuthOptions = {
  emailOtp: boolean;
  providers: string[];
  publicSignup: boolean;
};

type SessionBody = {
  ok: boolean;
  auth: AuthOptions;
  session: null | {
    tenantId: string;
    tenantName: string;
    subject: string;
    role: "owner" | "operator" | "viewer";
  };
};

type CredentialSummary = {
  id: string;
  name: string;
  tokenPrefix: string;
  expiresAt: string | null;
};

const stages: Array<{ key: Stage; label: string; icon: typeof ShieldCheck }> = [
  { key: "account", label: "Account", icon: ShieldCheck },
  { key: "workspace", label: "Workspace", icon: Building2 },
  { key: "credential", label: "Credential", icon: KeyRound },
  { key: "signal", label: "First signal", icon: RadioTower },
];

function stageIndex(stage: Stage): number {
  return stages.findIndex((item) => item.key === stage);
}

function authMessage(code: string | null): string {
  if (!code) return "";
  return {
    "signup-disabled": "Public signup is closed on this deployment.",
    "not-configured": "Account authentication is not configured yet.",
    "provider-not-allowed": "That identity provider is not enabled.",
    "rate-limited": "Too many attempts. Wait a moment and try again.",
    "callback-invalid": "The secure sign-in callback was incomplete.",
    "callback-failed": "The identity provider could not complete signup.",
  }[code] ?? "Signup could not be completed.";
}

export function OnboardingFlow() {
  const [stage, setStage] = useState<Stage>("account");
  const [auth, setAuth] = useState<AuthOptions>({
    emailOtp: false,
    providers: [],
    publicSignup: false,
  });
  const [email, setEmail] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspace, setWorkspace] = useState<{ id: string; name: string } | null>(null);
  const [credentialName, setCredentialName] = useState("Production telemetry");
  const [credential, setCredential] = useState<CredentialSummary | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(() =>
    typeof window === "undefined"
      ? ""
      : authMessage(new URLSearchParams(window.location.search).get("auth")),
  );
  const [busy, setBusy] = useState(false);
  const [signalDetected, setSignalDetected] = useState(false);
  const [checkingSignal, setCheckingSignal] = useState(false);

  const quickstart = useMemo(() => {
    const origin = typeof window === "undefined" ? "https://signalops.cc" : window.location.origin;
    return buildSignalOpsRawHttpQuickstartV1({ endpoint: `${origin}/v1/events` });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        const response = await fetch("/api/cockpit/session", { cache: "no-store" });
        const body = (await response.json()) as SessionBody;
        if (cancelled) return;
        setAuth(body.auth);
        if (body.session) {
          identifyProductUser({
            subject: body.session.subject,
            tenantId: body.session.tenantId,
            role: body.session.role,
          });
          setWorkspace({ id: body.session.tenantId, name: body.session.tenantName });
          setStage(body.session.role === "owner" ? "credential" : "signal");
          return;
        }
        const requested = new URLSearchParams(window.location.search).get("state");
        if (requested === "workspace") {
          const account = await fetch("/api/onboarding/workspace", { cache: "no-store" });
          if (account.ok && !cancelled) setStage("workspace");
        }
      } catch {
        if (!cancelled) setError("SignalOps could not load signup readiness.");
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  async function requestSignupLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    captureProductEvent("signup_started", { auth_method: "email_otp" });
    try {
      const response = await fetch("/api/cockpit/auth/email", {
        method: "POST",
        headers: { "content-type": "application/json", ...getPostHogRequestHeaders() },
        body: JSON.stringify({ email, intent: "signup" }),
      });
      const body = (await response.json()) as { code?: string };
      if (!response.ok) {
        setError(
          response.status === 429
            ? "Too many signup links were requested. Try again later."
            : body.code === "invalid_email"
              ? "Enter a valid work email address."
              : body.code === "public_signup_disabled"
                ? "Public signup is not enabled on this deployment."
                : "The secure signup link could not be sent.",
        );
        return;
      }
      setNotice("Check your inbox. The secure link returns here to create your workspace.");
    } catch {
      setError("SignalOps could not be reached. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/onboarding/workspace", {
        method: "POST",
        headers: { "content-type": "application/json", ...getPostHogRequestHeaders() },
        body: JSON.stringify({ workspaceName }),
      });
      const body = (await response.json()) as {
        code?: string;
        message?: string;
        workspace?: { tenantId: string; tenantName: string };
      };
      if (!response.ok || !body.workspace) {
        setError(body.message ?? "The workspace could not be created.");
        return;
      }
      setWorkspace({ id: body.workspace.tenantId, name: body.workspace.tenantName });
      const sessionResponse = await fetch("/api/cockpit/session", { cache: "no-store" });
      const sessionBody = (await sessionResponse.json()) as SessionBody;
      if (sessionBody.session) {
        identifyProductUser({
          subject: sessionBody.session.subject,
          tenantId: sessionBody.session.tenantId,
          role: sessionBody.session.role,
        });
      }
      setStage("credential");
    } catch {
      setError("SignalOps could not be reached. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function createCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/workspace/credentials", {
        method: "POST",
        headers: { "content-type": "application/json", ...getPostHogRequestHeaders() },
        body: JSON.stringify({ name: credentialName, expiresInDays: 90 }),
      });
      const body = (await response.json()) as {
        code?: string;
        message?: string;
        credential?: CredentialSummary;
        token?: string;
      };
      if (!response.ok || !body.credential || !body.token) {
        setError(
          body.code === "credential_name_conflict"
            ? "An active credential already uses that name. Choose another name."
            : body.message ?? "The credential could not be created.",
        );
        return;
      }
      setCredential(body.credential);
      setToken(body.token);
      setStage("signal");
    } catch {
      setError("SignalOps could not be reached. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string, kind: "credential" | "quickstart") {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(kind === "credential" ? "Credential copied. Store it in a server-side secret manager." : "Quickstart copied.");
      if (kind === "quickstart") captureProductEvent("quickstart_copied", { integration: "raw_http_node" });
    } catch {
      setError("Clipboard access is unavailable. Select and copy the value manually.");
    }
  }

  async function checkForSignal() {
    setCheckingSignal(true);
    setError("");
    try {
      const response = await fetch("/v1/ops/snapshot?range=24h", { cache: "no-store" });
      const body = (await response.json()) as { snapshot?: { totals?: { operations?: number } } };
      const detected = response.ok && Number(body.snapshot?.totals?.operations ?? 0) > 0;
      setSignalDetected(detected);
      setNotice(detected ? "First production signal detected. Your live cockpit is ready." : "No operation yet. Run the quickstart, then check again.");
    } catch {
      setError("SignalOps could not check the live snapshot.");
    } finally {
      setCheckingSignal(false);
    }
  }

  const activeIndex = stageIndex(stage);
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_50%_0%,rgba(52,89,223,0.15),transparent_36%),#f8faff] px-5 py-7 text-[var(--text)] sm:px-8">
      <div className="mx-auto max-w-[1120px]">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-bold text-[var(--accent)]">
            <CircleDot className="size-5" /> SignalOps
          </Link>
          <Link href="/cockpit" className="text-xs font-semibold text-[var(--text-dim)] hover:text-[var(--accent)]">Already have a workspace? Sign in</Link>
        </header>

        <section className="mt-10 grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
          <aside className="lg:sticky lg:top-8">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--accent)]">Public beta · activation rail</p>
            <h1 className="mt-3 max-w-md text-4xl font-semibold leading-tight tracking-tight text-[var(--text-strong)] sm:text-5xl">From account to first signal in minutes.</h1>
            <p className="mt-4 max-w-md text-sm leading-6 text-[var(--text-dim)]">One isolated workspace, one revocable server credential, and a canonical integration that does not expose prompts, media, identities, or provider secrets.</p>
            <ol className="relative mt-8 grid gap-1" aria-label="SignalOps onboarding progress">
              <span className="absolute bottom-6 left-[17px] top-6 w-px bg-[var(--border)]" />
              {stages.map((item, index) => {
                const complete = index < activeIndex || (item.key === "signal" && signalDetected);
                const active = index === activeIndex;
                return (
                  <li key={item.key} className="relative flex items-center gap-3 rounded-xl px-2 py-3">
                    <span className={`z-10 grid size-8 place-items-center rounded-full border ${complete ? "border-emerald-500 bg-emerald-500 text-white" : active ? "border-[var(--accent)] bg-[var(--accent)] text-white shadow-[0_0_0_5px_rgba(52,89,223,0.10)]" : "border-[var(--border)] bg-white text-[var(--mute)]"}`}>
                      {complete ? <Check className="size-4" /> : <item.icon className="size-3.5" />}
                    </span>
                    <span className={active ? "text-sm font-bold text-[var(--text-strong)]" : "text-sm font-semibold text-[var(--text-dim)]"}>{item.label}</span>
                  </li>
                );
              })}
            </ol>
          </aside>

          <section className="min-h-[560px] rounded-2xl border border-[var(--border)] bg-white p-6 shadow-[var(--shadow-panel)] sm:p-9">
            {stage === "account" ? (
              <div>
                <StepLabel value="01" text="Account" />
                <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--text-strong)]">Create your operator identity</h2>
                <p className="mt-3 text-sm leading-6 text-[var(--text-dim)]">Use a secure email link or an enabled identity provider. SignalOps analytics never receive your email address.</p>
                {auth.publicSignup ? (
                  <>
                    {auth.emailOtp ? (
                      <form className="mt-8" onSubmit={requestSignupLink}>
                        <label htmlFor="signup-email" className="text-xs font-semibold text-[var(--text)]">Work email</label>
                        <input id="signup-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 h-12 w-full rounded-lg border border-[var(--border)] px-3 text-sm shadow-sm" placeholder="you@company.com" />
                        <PrimaryButton busy={busy} label="Email me a secure link" />
                      </form>
                    ) : null}
                    {auth.providers.length > 0 ? (
                      <div className="mt-5 grid gap-2">
                        {auth.providers.map((provider) => (
                          <a key={provider} href={`/api/cockpit/auth/start?provider=${encodeURIComponent(provider)}&intent=signup`} onClick={() => captureProductEvent("signup_started", { auth_method: `oauth_${provider}` })} className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-white text-sm font-semibold text-[var(--text-strong)] hover:border-[var(--accent)] hover:text-[var(--accent)]">
                            Continue with {provider.charAt(0).toUpperCase() + provider.slice(1)} <ExternalLink className="size-4" />
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-900">Public signup is not enabled on this deployment. <Link href="/contact" className="font-bold underline">Request beta access</Link>.</div>
                )}
              </div>
            ) : null}

            {stage === "workspace" ? (
              <form onSubmit={createWorkspace}>
                <StepLabel value="02" text="Workspace" />
                <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--text-strong)]">Name the operating boundary</h2>
                <p className="mt-3 text-sm leading-6 text-[var(--text-dim)]">This creates an isolated tenant and makes you its owner. Use your product or team name; adapters remain client-agnostic.</p>
                <label htmlFor="workspace-name" className="mt-8 block text-xs font-semibold text-[var(--text)]">Workspace name</label>
                <input id="workspace-name" required minLength={2} maxLength={120} autoFocus value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} className="mt-2 h-12 w-full rounded-lg border border-[var(--border)] px-3 text-sm shadow-sm" placeholder="Acme AI Operations" />
                <PrimaryButton busy={busy} label="Create isolated workspace" />
              </form>
            ) : null}

            {stage === "credential" ? (
              <form onSubmit={createCredential}>
                <StepLabel value="03" text="Credential" />
                <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--text-strong)]">Issue a production ingest key</h2>
                <p className="mt-3 text-sm leading-6 text-[var(--text-dim)]">The raw key appears once. SignalOps stores only its SHA-256 digest and a safe prefix. Keep it in your server-side secret manager.</p>
                {workspace ? <p className="mt-5 rounded-lg bg-[var(--surface-mute)] px-3 py-2 font-mono text-xs text-[var(--text-dim)]">Workspace · {workspace.name}</p> : null}
                <label htmlFor="credential-name" className="mt-7 block text-xs font-semibold text-[var(--text)]">Credential label</label>
                <input id="credential-name" required minLength={2} maxLength={120} value={credentialName} onChange={(event) => setCredentialName(event.target.value)} className="mt-2 h-12 w-full rounded-lg border border-[var(--border)] px-3 text-sm shadow-sm" />
                <p className="mt-2 text-xs text-[var(--mute)]">Full validate + write scopes · expires in 90 days · owner-revocable</p>
                <PrimaryButton busy={busy} label="Issue credential" />
              </form>
            ) : null}

            {stage === "signal" ? (
              <div>
                <StepLabel value="04" text="First signal" />
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--text-strong)]">Send one complete operation</h2>
                    <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--text-dim)]">Run this zero-dependency Node script from a server or worker. It sends accepted, attempt, and terminal boundaries so charts are useful immediately.</p>
                  </div>
                  {signalDetected ? <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200"><Check className="size-3.5" /> Live signal detected</span> : null}
                </div>

                {token ? (
                  <div className="mt-7 rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold text-amber-950">Copy this credential now</p>
                        <p className="mt-1 font-mono text-[11px] text-amber-800">{token.slice(0, 16)}••••••••••••••••••••••••</p>
                      </div>
                      <button type="button" onClick={() => void copy(token, "credential")} className="inline-flex h-9 items-center gap-2 rounded-lg bg-amber-950 px-3 text-xs font-bold text-white"><Clipboard className="size-3.5" /> Copy secret</button>
                    </div>
                  </div>
                ) : credential ? (
                  <div className="mt-7 rounded-xl border border-[var(--border)] bg-[var(--surface-mute)] p-4 text-xs leading-5 text-[var(--text-dim)]">Credential {credential.tokenPrefix}… exists, but its secret is no longer recoverable. Create a replacement in <Link href="/settings" className="font-bold text-[var(--accent)]">workspace settings</Link> if you did not save it.</div>
                ) : null}

                <div className="mt-5 overflow-hidden rounded-xl border border-[#1d2b52] bg-[#07122b] shadow-lg">
                  <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-white">
                    <span className="inline-flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em]"><TerminalSquare className="size-4 text-[#79a0ff]" /> quickstart.mjs</span>
                    <button type="button" onClick={() => void copy(quickstart, "quickstart")} className="inline-flex items-center gap-2 text-xs font-bold text-[#b7c9ff] hover:text-white"><Clipboard className="size-3.5" /> Copy</button>
                  </div>
                  <pre className="max-h-[310px] overflow-auto p-4 text-[11px] leading-5 text-[#dce6ff]"><code>{quickstart}</code></pre>
                </div>
                <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-mute)] px-4 py-3 font-mono text-[11px] leading-5 text-[var(--text-dim)]">
                  SIGNALOPS_INGEST_CREDENTIAL=&quot;your-one-time-secret&quot; node quickstart.mjs
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button type="button" disabled={checkingSignal} onClick={() => void checkForSignal()} className="inline-flex h-11 items-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-sm font-bold text-white hover:bg-[var(--accent-hover)] disabled:opacity-60">
                    {checkingSignal ? <LoaderCircle className="size-4 animate-spin" /> : <RadioTower className="size-4" />} Check for first signal
                  </button>
                  <Link href="/cockpit" className="inline-flex h-11 items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-4 text-sm font-bold text-[var(--text-strong)] hover:border-[var(--accent)] hover:text-[var(--accent)]">Open live cockpit <ArrowRight className="size-4" /></Link>
                  <Link href="/docs" className="inline-flex h-11 items-center px-2 text-sm font-semibold text-[var(--text-dim)] hover:text-[var(--accent)]">Read integration docs</Link>
                </div>
              </div>
            ) : null}

            {error ? <p role="alert" className="mt-5 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium leading-5 text-rose-700 ring-1 ring-rose-200">{error}</p> : null}
            {notice ? <p aria-live="polite" className="mt-5 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium leading-5 text-emerald-700 ring-1 ring-emerald-200">{notice}</p> : null}
          </section>
        </section>
      </div>
    </main>
  );
}

function StepLabel({ value, text }: { value: string; text: string }) {
  return <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--accent)]">Stage {value} · {text}</p>;
}

function PrimaryButton({ busy, label }: { busy: boolean; label: string }) {
  return (
    <button type="submit" disabled={busy} className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-sm font-bold text-white transition hover:bg-[var(--accent-hover)] disabled:cursor-wait disabled:opacity-60">
      {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}{label}<ArrowRight className="size-4" />
    </button>
  );
}
