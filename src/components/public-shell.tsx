import { ArrowRight, CircleDot, CodeXml } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

const navigation = [
  { label: "Product", href: "/#product" },
  { label: "Docs", href: "/docs" },
  { label: "Pricing", href: "/pricing" },
  { label: "Security", href: "/security" },
  { label: "Status", href: "/status" },
];

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_70%_0%,rgba(52,89,223,0.10),transparent_30%),#fbfcff] text-[var(--text)]">
      <div className="mx-auto w-full max-w-[1180px] px-5 sm:px-8 lg:px-10">
        <header className="flex min-h-20 flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] py-4">
          <Link href="/" className="inline-flex items-center gap-2 text-base font-bold text-[var(--accent)]">
            <CircleDot className="size-5" /> SignalOps
            <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.1em]">Public beta</span>
          </Link>
          <nav className="order-3 flex w-full items-center gap-5 overflow-x-auto text-xs font-semibold text-[var(--text-dim)] md:order-none md:w-auto" aria-label="Public navigation">
            {navigation.map((item) => <Link key={item.href} href={item.href} className="shrink-0 hover:text-[var(--accent)]">{item.label}</Link>)}
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/cockpit" className="hidden h-9 items-center rounded-lg border border-[var(--border)] bg-white px-3 text-xs font-bold text-[var(--text-dim)] hover:text-[var(--accent)] sm:inline-flex">Sign in</Link>
            <Link href="/onboarding" className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--accent)] px-3 text-xs font-bold text-white hover:bg-[var(--accent-hover)]">Start free <ArrowRight className="size-3.5" /></Link>
          </div>
        </header>
        {children}
        <footer className="mt-16 grid gap-8 border-t border-[var(--border)] py-9 sm:grid-cols-[1fr_auto]">
          <div>
            <Link href="/" className="inline-flex items-center gap-2 text-sm font-bold text-[var(--accent)]"><CircleDot className="size-4" /> SignalOps</Link>
            <p className="mt-3 max-w-md text-xs leading-5 text-[var(--text-dim)]">Privacy-safe observability for AI operations. Public beta; no unsupported certification or availability claims.</p>
            <a href="https://github.com/TargiX/signalops" className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-[var(--text-dim)] hover:text-[var(--accent)]" target="_blank" rel="noreferrer"><CodeXml className="size-3.5" /> GitHub</a>
          </div>
          <nav className="grid grid-cols-2 gap-x-8 gap-y-3 text-xs font-semibold text-[var(--text-dim)] sm:grid-cols-3" aria-label="Legal and support">
            <Link href="/docs">Docs</Link>
            <Link href="/contact">Contact</Link>
            <Link href="/security">Security</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/status">Status</Link>
          </nav>
        </footer>
      </div>
    </main>
  );
}

export function PublicPageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header className="max-w-3xl pb-10 pt-16 sm:pt-20">
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--accent)]">{eyebrow}</p>
      <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight text-[var(--text-strong)] sm:text-6xl">{title}</h1>
      <p className="mt-5 max-w-2xl text-base leading-7 text-[var(--text-dim)]">{description}</p>
    </header>
  );
}
