"use client";

import {
  Activity,
  ArrowRight,
  Bell,
  Bot,
  Box,
  CircleDollarSign,
  GitBranch,
  Layers,
  Lock,
  Network,
  Play,
  RadioTower,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Zap,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { motion, type Variants } from "framer-motion";

import { buttonVariants } from "@/components/ui/button";
import { getOpsSnapshot } from "@/lib/mock-data";
import { cn, formatCurrency, formatMs, formatNumber } from "@/lib/utils";

const navItems = ["Product", "Solutions", "Resources", "Pricing", "Docs"];

const providers: Array<{
  name: string;
  p95: string;
  pressure: string;
  tone: "blue" | "green" | "red";
  x: string;
  y: string;
}> = [
  { name: "OpenAI", p95: "11.2s", pressure: "Medium", tone: "blue", x: "58%", y: "12%" },
  { name: "Anthropic", p95: "8.7s", pressure: "Low", tone: "blue", x: "18%", y: "31%" },
  { name: "Gemini", p95: "13.8s", pressure: "High", tone: "red", x: "76%", y: "42%" },
  { name: "Mistral", p95: "6.1s", pressure: "Low", tone: "blue", x: "36%", y: "64%" },
  { name: "Cohere", p95: "9.4s", pressure: "Low", tone: "green", x: "68%", y: "69%" },
];

const loop = [
  {
    icon: SlidersHorizontal,
    title: "Detect",
    text: "Watch provider latency, failures, spend drift, and queue pressure in one view.",
  },
  {
    icon: Bell,
    title: "Triage",
    text: "Scope affected jobs, inspect model/provider patterns, and focus the queue.",
  },
  {
    icon: GitBranch,
    title: "Simulate",
    text: "Preview jobs moved, p95 reduction, failure cut, and cost impact.",
  },
  {
    icon: Network,
    title: "Verify",
    text: "Compare before/after provider health instantly.",
  },
  {
    icon: Activity,
    title: "Audit",
    text: "Keep the decision trail attached to incident and routing state.",
  },
];

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.08 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 320, damping: 30 },
  },
};

export function ProductHome() {
  const snapshot = getOpsSnapshot("24h");
  const incident = snapshot.incidents[0];
  const provider = snapshot.providers.find((item) => item.id === incident.providerId) ?? snapshot.providers[0];
  const activeJobs = snapshot.generations.filter((job) =>
    ["queued", "running", "retrying"].includes(job.status),
  ).length;
  const totalSpend = snapshot.providers.reduce((sum, item) => sum + item.spend, 0);
  const weightedP95 =
    snapshot.providers.reduce((sum, item) => sum + item.p95Ms * item.volume, 0) /
    snapshot.providers.reduce((sum, item) => sum + item.volume, 0);

  return (
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(ellipse_at_67%_8%,rgba(87,129,255,0.14),transparent_30%),linear-gradient(180deg,#fbfcff_0%,#ffffff_42%,#fbfdff_100%)] text-[var(--text)]">
      <div className="relative z-10 mx-auto w-full max-w-[1280px] px-5 py-5 sm:px-8 lg:px-10">
        <Header />

        <motion.section
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid min-h-[620px] items-center gap-8 pt-14 pb-8 lg:grid-cols-[0.88fr_1.12fr] lg:pt-16"
        >
          <div className="relative z-20 max-w-[530px]">
            <motion.p
              variants={itemVariants}
              className="mb-4 font-mono text-[11px] font-bold uppercase leading-none text-[var(--accent)]"
            >
              Agentic AI Infrastructure
            </motion.p>
            <motion.h1
              variants={itemVariants}
              className="text-[54px] font-semibold leading-[0.94] text-[var(--text-strong)] sm:text-[74px] lg:text-[78px]"
            >
              Operate generation{" "}
              <span className="block font-serif italic font-normal text-[var(--accent)]">before drift</span>
              becomes damage.
            </motion.h1>
            <motion.p variants={itemVariants} className="mt-6 max-w-[420px] text-[15px] leading-7 text-[var(--text-dim)]">
              SignalOps OS turns latency tails, retries, cost leakage, and provider incidents into one repeatable workflow. Detect, triage, and simulate routing rules in real time.
            </motion.p>
            <motion.div variants={itemVariants} className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/cockpit"
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "h-11 rounded-lg bg-[var(--accent)] px-5 text-[13px] font-semibold text-white shadow-[0_16px_30px_rgba(42,80,214,0.22)] hover:bg-[var(--accent-hover)]",
                )}
              >
                Enter Operations Cockpit
                <ArrowRight className="ml-2 size-4" />
              </Link>
              <Link
                href="/cockpit?replay=alibaba-p95&step=0"
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "h-11 rounded-lg border-[var(--border)] bg-white/90 px-5 text-[13px] font-semibold text-[var(--text)] shadow-sm hover:bg-white",
                )}
              >
                <span className="mr-2 grid size-5 place-items-center rounded-full border border-[var(--border)] text-[var(--accent)]">
                  <Play className="size-3 fill-current" />
                </span>
                Watch guided replay
              </Link>
            </motion.div>
            <motion.div variants={itemVariants} className="mt-4">
              <Link
                href="/validate"
                className="inline-flex items-center gap-2 text-[13px] font-semibold text-[var(--text-dim)] transition-colors hover:text-[var(--accent)]"
              >
                Validate an event payload
                <ArrowRight className="size-4" />
              </Link>
            </motion.div>
            <motion.div variants={itemVariants} className="mt-14">
              <p className="font-mono text-[10px] font-bold uppercase text-[var(--mute)]">Trusted by leading AI teams</p>
              <div className="mt-5 flex flex-wrap items-center gap-x-7 gap-y-3 text-[12px] font-semibold text-[#8c97ad]">
                <span>LUMEN</span>
                <span>▲ Vercel</span>
                <span>◇ CURSOR</span>
                <span>perplexity</span>
                <span>syntheisa</span>
              </div>
            </motion.div>
          </div>

          <motion.div variants={itemVariants} className="relative min-h-[360px] sm:min-h-[460px] lg:min-h-[520px]">
            <SignalCartography />
          </motion.div>
        </motion.section>

        <motion.section
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid gap-5 lg:grid-cols-[1.35fr_0.9fr]"
        >
          <motion.div variants={itemVariants}>
            <section className="rounded-lg border border-[var(--border)] bg-white/90 p-6 shadow-[var(--shadow-panel)]">
              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-[10px] font-bold uppercase text-[var(--mute)]">Live Snapshot</p>
                  <h2 className="mt-2 text-xl font-bold text-[var(--text-strong)]">Current operating picture</h2>
                </div>
                <QuietStatus />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <MetricTile icon={RadioTower} label="Provider p95" value={formatMs(weightedP95)} />
                <MetricTile icon={Bot} label="Active jobs" value={formatNumber(activeJobs)} />
                <MetricTile icon={CircleDollarSign} label="Spend (today)" value={formatCurrency(totalSpend)} />
              </div>
              <div className="mt-5 rounded-lg border border-[var(--border)] bg-white/72 p-5 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded px-2 py-1 text-[10px] font-bold text-[#e45f5f] ring-1 ring-[#ffd8d8]">critical</span>
                  <span className="rounded px-2 py-1 font-mono text-[10px] font-bold text-[var(--mute)] ring-1 ring-[var(--border)]">
                    {incident.id}
                  </span>
                  <span className="text-[11px] font-semibold text-[var(--mute)]">Opened {incident.age} ago</span>
                </div>
                <h3 className="mt-4 text-[15px] font-bold text-[var(--text-strong)]">{incident.title}</h3>
                <p className="mt-1 text-[13px] leading-6 text-[var(--text-dim)]">{incident.detail}</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <MiniStat label="Provider" value={provider.name} />
                  <MiniStat label="p95" value={formatMs(provider.p95Ms)} />
                  <MiniStat label="Failure rate" value={`${provider.failureRate}%`} />
                </div>
                <Link href="/incidents/inc_411" className="mt-5 inline-flex items-center gap-2 text-[13px] font-semibold text-[var(--accent)]">
                  View incident
                  <ArrowRight className="size-4" />
                </Link>
              </div>
            </section>
          </motion.div>

          <motion.div variants={itemVariants}>
            <section className="h-full rounded-lg border border-[var(--border)] bg-white/90 p-7 shadow-[var(--shadow-panel)]">
              <p className="font-mono text-[10px] font-bold uppercase text-[var(--mute)]">Product Loop</p>
              <h2 className="mt-2 text-xl font-bold text-[var(--text-strong)]">From signal to change</h2>
              <ol className="relative mt-7 space-y-5">
                <span className="absolute left-[13px] top-4 h-[calc(100%-32px)] w-px bg-[#dce5fb]" />
                {loop.map((item, index) => (
                  <li key={item.title} className="relative grid grid-cols-[28px_36px_1fr] gap-4">
                    <span className="grid size-7 place-items-center rounded-full border border-[#d7e1fb] bg-white font-mono text-[11px] font-bold text-[var(--accent)]">
                      {index + 1}
                    </span>
                    <span className="grid size-8 place-items-center rounded-lg bg-[#eef3ff] text-[var(--accent)]">
                      <item.icon className="size-4" />
                    </span>
                    <span>
                      <span className="block text-[13px] font-bold text-[var(--text-strong)]">{item.title}</span>
                      <span className="mt-1 block text-[12px] leading-5 text-[var(--text-dim)]">{item.text}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          </motion.div>
        </motion.section>

        <motion.section
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="mt-5 grid gap-5 lg:grid-cols-3"
        >
          <PillarCard
            icon={ShieldCheck}
            title="Stateful incidents"
            text="Incidents aren't decoration: they link to affected jobs, provider data, mitigation state, and audit context natively."
            visual={<IncidentTimeline />}
          />
          <PillarCard
            icon={GitBranch}
            title="Routing rules"
            text="Rules move through draft, simulated, optimistic, and active states using modern server-state patterns."
            visual={<RuleRows />}
          />
          <PillarCard
            icon={Activity}
            title="Dense cockpit"
            text="The cockpit keeps charts, virtualized queue inspection, saved views, and provider analysis one click away."
            visual={<CockpitCharts />}
          />
        </motion.section>

        <motion.section
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="py-5"
        >
          <motion.div
            variants={itemVariants}
            className="relative grid min-h-[280px] overflow-hidden rounded-lg border border-[#cfe0f6] bg-[linear-gradient(110deg,#dcebff_0%,#f8fbff_47%,#d9f6ec_100%)] p-9 shadow-[0_24px_70px_rgba(74,104,163,0.14)] lg:grid-cols-[0.86fr_1.14fr]"
          >
            <div className="relative z-10">
              <p className="font-mono text-[10px] font-bold uppercase text-[var(--accent)]">Regain Control</p>
              <h2 className="mt-4 text-3xl font-extrabold text-[var(--text-strong)]">Ready to regain control?</h2>
              <p className="mt-4 max-w-[390px] text-[14px] leading-6 text-[var(--text-dim)]">
                Stop guessing why jobs fail and start operating your AI generation stack with confidence and precision.
              </p>
              <div className="mt-7 flex flex-wrap gap-4">
                <Link
                  href="/cockpit"
                  className={cn(
                    buttonVariants({ size: "lg" }),
                    "h-11 rounded-lg bg-[var(--accent)] px-5 text-[13px] font-semibold text-white hover:bg-[var(--accent-hover)]",
                  )}
                >
                  Enter Operations Cockpit
                  <ArrowRight className="ml-2 size-4" />
                </Link>
                <Link
                  href="/cockpit"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "lg" }),
                    "h-11 rounded-lg border-[var(--border)] bg-white/72 px-5 text-[13px] font-semibold text-[var(--text)] hover:bg-white",
                  )}
                >
                  Book a demo
                </Link>
              </div>
            </div>
            <GlassSignalModule />
          </motion.div>
        </motion.section>

        <Footer />
      </div>
    </main>
  );
}

function Header() {
  return (
    <header className="flex h-12 items-center justify-between gap-5">
      <Link href="/" className="flex items-center gap-3">
        <span className="grid size-7 place-items-center text-[var(--accent)]">
          <SignalGlyph className="size-6" />
        </span>
        <span className="text-lg font-bold text-[var(--accent)]">SignalOps OS</span>
        <span className="text-xs font-semibold text-[var(--mute)]">v2.0</span>
      </Link>
      <nav className="hidden items-center gap-9 text-[12px] font-semibold text-[var(--text-dim)] lg:flex">
        {navItems.map((item) => (
          <Link key={item} href="/cockpit" className="hover:text-[var(--text)]">
            {item}
          </Link>
        ))}
      </nav>
      <div className="flex items-center gap-3">
        <Link
          href="/cockpit"
          className="hidden h-9 items-center rounded-lg border border-[var(--border)] bg-white/90 px-4 text-[12px] font-semibold text-[var(--text-dim)] shadow-sm hover:bg-white sm:inline-flex"
        >
          Log in
        </Link>
        <Link
          href="/cockpit"
          className={cn(
            buttonVariants({ size: "sm" }),
            "h-9 rounded-lg bg-[var(--accent)] px-4 text-[12px] font-semibold text-white shadow-[0_12px_24px_rgba(42,80,214,0.18)] hover:bg-[var(--accent-hover)]",
          )}
        >
          Book a demo
          <ArrowRight className="ml-2 size-4" />
        </Link>
      </div>
    </header>
  );
}

function SignalCartography() {
  return (
    <div className="relative h-[360px] w-full overflow-visible sm:h-[460px] lg:h-[540px]">
      <div className="absolute left-0 top-0 h-[520px] w-[720px] origin-top-left scale-[0.52] rounded-lg border border-[#e9eefb] bg-white/72 shadow-[inset_0_1px_0_rgba(255,255,255,0.86)] sm:scale-[0.76] lg:left-[5%] lg:w-full lg:scale-100">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(74,109,240,0.12),transparent_24%),radial-gradient(circle_at_50%_50%,transparent_0_25%,rgba(93,126,225,0.08)_25.3%,transparent_25.8%,transparent_37%,rgba(93,126,225,0.07)_37.3%,transparent_37.8%,transparent_49%,rgba(93,126,225,0.06)_49.3%,transparent_49.8%)]" />
        <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(#7fa0ff_1px,transparent_1.2px)] [background-size:18px_18px]" />
        <div className="absolute left-5 top-5 z-10 flex items-center gap-4">
          <p className="font-mono text-[11px] font-bold uppercase text-[var(--text-dim)]">Live Signal Cartography</p>
        </div>
        <div className="absolute right-3 top-16 z-20 grid gap-3">
          {[Zap, Layers, Lock, Box].map((Icon, index) => (
            <span key={index} className="grid size-8 place-items-center rounded-lg border border-[var(--border)] bg-white/82 text-[var(--text-dim)] shadow-sm">
              <Icon className="size-4" />
            </span>
          ))}
        </div>

        <svg className="absolute inset-0 z-0 h-full w-full" viewBox="0 0 720 520" fill="none" aria-hidden="true">
          <path d="M360 260 C265 206 208 158 112 190" stroke="#5578ff" strokeWidth="2" />
          <path d="M362 260 C256 255 206 272 84 260" stroke="#62bd94" strokeWidth="2" />
          <path d="M364 262 C300 344 255 366 164 366" stroke="#5578ff" strokeWidth="2" />
          <path d="M364 260 C466 180 526 165 644 182" stroke="#5578ff" strokeWidth="2" strokeDasharray="6 8" />
          <path d="M366 262 C508 278 557 306 668 310" stroke="#f26f63" strokeWidth="2" strokeDasharray="6 8" />
          <path d="M365 265 C462 362 520 390 632 382" stroke="#61bd96" strokeWidth="2" />
          {[112, 184, 248, 474, 566, 646, 164, 632].map((cx, index) => (
            <circle key={index} cx={cx} cy={[190, 236, 342, 196, 166, 182, 366, 382][index]} r="5" fill="#4774ff" opacity="0.85" />
          ))}
        </svg>

        <div className="absolute left-1/2 top-1/2 z-20 grid size-[68px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/86 shadow-[0_20px_46px_rgba(58,92,205,0.24)] ring-1 ring-[#dbe5ff]">
          <span className="grid size-11 place-items-center rounded-full bg-[#eef4ff] text-[var(--accent)]">
            <SignalGlyph className="size-7" />
          </span>
        </div>

        {providers.map((item) => (
          <ProviderCard key={item.name} {...item} />
        ))}

        <div className="absolute bottom-8 left-4 z-20 w-[176px] rounded-lg border border-[var(--border)] bg-white/94 p-4 shadow-[0_22px_52px_rgba(62,88,145,0.16)] lg:left-[-3%]">
          <ControlSlider label="Latency (p95)" left="0ms" right="20s+" tone="blue" />
          <ControlSlider label="Queue Pressure" left="Low" right="High" tone="green" />
          <div className="mt-4 space-y-2">
            {[
              ["Active", "#4774ff", "4 3"],
              ["Simulated", "#62bd94", "0"],
              ["Degraded", "#f26f63", "5 4"],
            ].map(([label, color, dash]) => (
              <div key={label} className="flex items-center gap-2 text-[10px] font-semibold text-[var(--text-dim)]">
                <svg width="18" height="6" viewBox="0 0 18 6">
                  <path d="M1 3H17" stroke={color} strokeWidth="2" strokeDasharray={dash} />
                </svg>
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProviderCard({
  name,
  p95,
  pressure,
  tone,
  x,
  y,
}: {
  name: string;
  p95: string;
  pressure: string;
  tone: "blue" | "green" | "red";
  x: string;
  y: string;
}) {
  const colors = {
    blue: "text-[#4774ff]",
    green: "text-[#35a979]",
    red: "text-[#ef635b]",
  };
  return (
    <div
      className="absolute z-30 w-[148px] rounded-lg border border-[var(--border)] bg-white/95 p-4 shadow-[0_18px_42px_rgba(71,94,148,0.14)]"
      style={{ left: x, top: y }}
    >
      <div className="flex items-center gap-2">
        <span className={cn("grid size-5 place-items-center rounded-full bg-[#eef3ff]", colors[tone])}>
          <Sparkles className="size-3.5" />
        </span>
        <span className="text-[12px] font-bold text-[var(--text-strong)]">{name}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <span>
          <span className="block text-[10px] font-semibold text-[var(--mute)]">p95</span>
          <span className="block text-[15px] font-bold text-[var(--text-strong)]">{p95}</span>
        </span>
        <span>
          <span className="block text-[10px] font-semibold text-[var(--mute)]">Q Pressure</span>
          <span className={cn("block text-[10px] font-bold", colors[tone])}>{pressure}</span>
        </span>
      </div>
      <Waveform tone={tone} />
    </div>
  );
}

function ControlSlider({ label, left, right, tone }: { label: string; left: string; right: string; tone: "blue" | "green" }) {
  return (
    <div className="mb-4">
      <p className="mb-2 font-mono text-[9px] font-bold uppercase text-[var(--mute)]">{label}</p>
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-bold text-[var(--mute)]">{left}</span>
        <span className="relative h-1 flex-1 rounded-full bg-[#e9eef8]">
          <span className={cn("absolute inset-y-0 left-0 rounded-full", tone === "blue" ? "w-[78%] bg-[#4774ff]" : "w-[64%] bg-[#62bd94]")} />
          <span className={cn("absolute top-1/2 size-2 -translate-y-1/2 rounded-full", tone === "blue" ? "left-[78%] bg-[#4774ff]" : "left-[64%] bg-[#ef635b]")} />
        </span>
        <span className="text-[9px] font-bold text-[var(--mute)]">{right}</span>
      </div>
    </div>
  );
}

function QuietStatus() {
  return (
    <span className="inline-flex items-center gap-2 pt-1 text-[11px] font-semibold text-[#4b9d72]">
      <span className="size-1.5 rounded-full bg-[#31c97d]" />
      Live
    </span>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-white/74 p-4 shadow-sm">
      <div className="mb-4 flex items-center gap-2 font-mono text-[10px] font-bold uppercase text-[var(--mute)]">
        <Icon className="size-4 text-[var(--accent)]" />
        {label}
      </div>
      <div className="text-2xl font-extrabold text-[var(--text-strong)] [font-variant-numeric:tabular-nums]">{value}</div>
      <Waveform tone="blue" />
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-[var(--border)] bg-white/72 px-4 py-3">
      <div className="font-mono text-[9px] font-bold uppercase text-[var(--mute)]">{label}</div>
      <div className="mt-1 text-[13px] font-bold text-[var(--text-strong)]">{value}</div>
    </div>
  );
}

function PillarCard({
  icon: Icon,
  title,
  text,
  visual,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  text: string;
  visual: React.ReactNode;
}) {
  return (
    <motion.section variants={itemVariants} className="rounded-lg border border-[var(--border)] bg-white/90 p-6 shadow-[var(--shadow-panel)]">
      <div className="flex gap-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-[#d8e3ff] bg-[#eef4ff] text-[var(--accent)]">
          <Icon className="size-5" />
        </span>
        <div>
          <h2 className="text-[17px] font-bold text-[var(--text-strong)]">{title}</h2>
          <p className="mt-4 text-[12px] leading-5 text-[var(--text-dim)]">{text}</p>
        </div>
      </div>
      <div className="mt-7">{visual}</div>
    </motion.section>
  );
}

function IncidentTimeline() {
  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-[var(--border)] bg-white/72 p-3">
        <div className="mb-3 flex items-center justify-between text-[10px] font-bold text-[var(--mute)]">
          Incident timeline
          <span className="text-[#35a979]">Live</span>
        </div>
        <div className="flex items-center gap-2">
          {Array.from({ length: 9 }).map((_, index) => (
            <span key={index} className={cn("h-1.5 flex-1 rounded-full", index % 3 === 0 ? "bg-[var(--accent)]" : "bg-[#e0e7f6]")} />
          ))}
          <ArrowRight className="size-3 text-[var(--mute)]" />
        </div>
      </div>
      {["Mitigations", "Impacted jobs"].map((label, index) => (
        <div key={label} className="flex items-center justify-between rounded border border-[var(--border)] bg-white/64 px-3 py-2 text-[11px] font-semibold text-[var(--text-dim)]">
          <span>{label}</span>
          <span>{index === 0 ? "3 active" : "1,204"}</span>
        </div>
      ))}
    </div>
  );
}

function RuleRows() {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-white/72 p-3">
      {[
        ["Tier 1 fallback", "Active"],
        ["EU low-latency bias", "Simulated"],
        ["Cost guardrail", "Draft"],
        ["Vision model spillover", "Optimistic"],
      ].map(([name, state]) => (
        <div key={name} className="flex items-center justify-between border-b border-[var(--border-soft)] py-2 last:border-0">
          <span className="text-[11px] font-semibold text-[var(--text-dim)]">{name}</span>
          <span className="text-[10px] font-bold text-[var(--accent)]">{state}</span>
        </div>
      ))}
    </div>
  );
}

function CockpitCharts() {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-[var(--border)] bg-white/72 p-3">
        <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-[var(--text-dim)]">
          Latency distribution (p95)
          <Box className="size-3 text-[var(--accent)]" />
        </div>
        <div className="flex h-12 items-end gap-1">
          {[18, 24, 34, 42, 27, 38, 48, 33, 39, 52, 44, 35, 46, 58, 51, 43, 36, 31, 26].map((height, index) => (
            <span key={index} className="flex-1 rounded-t bg-[#5b80ff]" style={{ height: `${height}%` }} />
          ))}
        </div>
      </div>
      <div className="rounded-lg border border-[var(--border)] bg-white/72 p-3">
        <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-[var(--text-dim)]">
          Queue pressure
          <Box className="size-3 text-[var(--accent)]" />
        </div>
        <Waveform tone="green" />
      </div>
    </div>
  );
}

function GlassSignalModule() {
  const tags: Array<{
    label: string;
    pos: string;
    Icon: React.ComponentType<{ className?: string }>;
  }> = [
    { label: "Detect", pos: "left-[10%] top-[22%]", Icon: SlidersHorizontal },
    { label: "Verify", pos: "left-[4%] top-[60%]", Icon: ShieldCheck },
    { label: "Simulate", pos: "right-[9%] top-[24%]", Icon: CircleDollarSign },
    { label: "Triage", pos: "right-[5%] top-[59%]", Icon: Activity },
    { label: "Audit", pos: "right-[23%] bottom-[8%]", Icon: GitBranch },
  ];

  return (
    <div className="relative mt-10 min-h-[250px] lg:mt-0">
      <Image
        src="/cta-glass-signal-v2.png"
        alt=""
        width={1716}
        height={916}
        className="absolute left-1/2 top-1/2 h-auto w-[118%] max-w-none -translate-x-1/2 -translate-y-1/2 object-contain"
        sizes="(min-width: 1024px) 680px, 100vw"
        style={{ maskImage: "linear-gradient(to left, rgba(0, 0, 0, 1) 76%, rgba(0, 0, 0, 0))" }}
      />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 620 260" fill="none" aria-hidden="true">
        <path d="M96 70 C184 74 228 90 292 108" stroke="rgba(83,120,255,0.3)" />
        <path d="M68 154 C166 144 224 133 294 124" stroke="rgba(83,120,255,0.3)" />
        <path d="M336 108 C420 84 473 75 536 78" stroke="rgba(83,120,255,0.3)" />
        <path d="M337 126 C426 140 487 153 558 155" stroke="rgba(83,120,255,0.3)" />
        <path d="M333 138 C394 178 438 202 492 209" stroke="rgba(83,120,255,0.26)" />
      </svg>

      {tags.map(({ label, pos, Icon }) => (
        <span
          key={label}
          className={cn("absolute z-20 inline-flex h-8 items-center gap-2 rounded-lg border border-[var(--border)] bg-white/94 px-3 text-[11px] font-bold text-[var(--text-dim)] shadow-[0_8px_20px_rgba(65,88,140,0.11)]", pos)}
        >
          <Icon className="size-3.5 text-[var(--accent)]" />
          {label}
        </span>
      ))}
    </div>
  );
}

function Footer() {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-5 py-6">
      <Link href="/" className="flex items-center gap-3">
        <SignalGlyph className="size-6 text-[var(--accent)]" />
        <span className="text-[15px] font-bold text-[var(--accent)]">SignalOps OS</span>
        <span className="text-[11px] font-semibold text-[var(--mute)]">v2.0</span>
      </Link>
      <nav className="hidden gap-12 text-[11px] font-semibold text-[var(--mute)] md:flex">
        {navItems.map((item) => (
          <Link key={item} href="/cockpit">
            {item}
          </Link>
        ))}
      </nav>
      <div className="flex gap-6 text-[11px] font-semibold text-[var(--mute)]">
        <span>SOC 2</span>
        <span>GDPR</span>
        <span>99.9% SLA</span>
      </div>
    </footer>
  );
}

function Waveform({ tone }: { tone: "blue" | "green" | "red" }) {
  const stroke = tone === "green" ? "#62bd94" : tone === "red" ? "#f26f63" : "#5578ff";
  return (
    <svg className="mt-3 h-7 w-full" viewBox="0 0 130 28" fill="none" aria-hidden="true">
      <path d="M1 18 C9 19 14 17 21 18 C28 19 32 21 39 17 C45 13 51 13 57 16 C65 20 72 20 79 15 C86 10 94 13 99 17 C106 22 111 21 118 16 C123 12 127 14 129 16" stroke={stroke} strokeWidth="2" />
    </svg>
  );
}

function SignalGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="2.3" fill="currentColor" />
      <path
        d="M8.7 8.8a4.7 4.7 0 0 0 0 6.4M15.3 8.8a4.7 4.7 0 0 1 0 6.4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <path
        d="M5.7 6a8.8 8.8 0 0 0 0 12M18.3 6a8.8 8.8 0 0 1 0 12"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}
