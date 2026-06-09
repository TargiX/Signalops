"use client";

import {
  Activity,
  ArrowRight,
  BadgeDollarSign,
  GitBranch,
  RadioTower,
  ShieldCheck,
  Siren,
  Terminal,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { motion, type Variants } from "framer-motion";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getOpsSnapshot } from "@/lib/mock-data";
import { cn, formatCurrency, formatMs, formatNumber } from "@/lib/utils";

const loop = [
  {
    title: "Detect",
    text: "Watch provider latency, failures, spend drift, and queue pressure in one view.",
  },
  {
    title: "Triage",
    text: "Scope affected jobs, inspect model/provider patterns, and focus the queue.",
  },
  {
    title: "Simulate",
    text: "Preview jobs moved, p95 reduction, failure cut, and cost impact.",
  },
  {
    title: "Verify",
    text: "Compare before/after provider health instantly.",
  },
  {
    title: "Audit",
    text: "Keep the decision trail attached to incident and routing state.",
  },
];

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.1 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 15 },
  visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 28 } },
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
    <main className="min-h-screen overflow-x-hidden bg-[var(--background)] text-[var(--text)] font-sans">
      {/* Clean Light Background Effects */}
      <div className="pointer-events-none fixed inset-0 opacity-80 z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-[var(--accent-soft)] blur-[100px] rounded-full opacity-50" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(31,34,48,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(31,34,48,0.02)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_40%,black_20%,transparent_80%)]" />
      </div>

      <div className="relative mx-auto flex w-full max-w-[1200px] flex-col gap-14 px-6 py-8 md:px-10 lg:px-12 z-10">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3 group">
            <span className="grid size-10 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)] group-hover:scale-105 transition-transform duration-300 shadow-[var(--shadow-1)]">
              <Activity className="size-5" />
            </span>
            <span>
              <span className="block text-xl font-bold tracking-tight text-[var(--text)]">SignalOps</span>
            </span>
          </Link>
          <nav className="flex items-center gap-4">
            <Link
              href="/incidents/inc_411"
              className="hidden rounded-lg px-4 py-2 text-sm font-medium text-[var(--text-dim)] hover:text-[var(--text)] transition-colors sm:inline-flex"
            >
              Active Incidents
            </Link>
            <Link href="/cockpit" className={cn(buttonVariants({ size: "sm" }), "rounded-full px-5 shadow-sm font-medium bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] border-0")}>
              Open Cockpit
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </nav>
        </header>

        <motion.section 
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] pb-10"
        >
          <div className="max-w-xl">
            <motion.div variants={itemVariants} className="inline-flex items-center gap-2 rounded-full border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)] mb-6 shadow-[var(--shadow-1)]">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-50"></span>
                <span className="relative inline-flex size-2 rounded-full bg-[var(--accent)]"></span>
              </span>
              SignalOps OS v2.0
            </motion.div>
            <motion.h1 variants={itemVariants} className="text-balance text-5xl sm:text-6xl font-bold leading-[1.08] tracking-[-0.03em] text-[var(--text)]">
              Operate generation <span className="text-[var(--accent)]">before drift</span> becomes damage.
            </motion.h1>
            <motion.p variants={itemVariants} className="mt-6 text-lg leading-relaxed text-[var(--text-dim)] max-w-lg">
              Turn latency tails, retries, cost leakage, and provider incidents into one repeatable workflow. Detect, triage, and simulate routing rules in real-time.
            </motion.p>
            <motion.div variants={itemVariants} className="mt-8 flex flex-col gap-4 sm:flex-row">
              <Link href="/cockpit" className={cn(buttonVariants({ size: "lg" }), "rounded-full px-8 h-12 text-base shadow-[var(--shadow-2)] font-medium bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] border-0")}>
                <Terminal className="mr-2 size-5" />
                Enter Operations Cockpit
              </Link>
              <Link
                href="/incidents/inc_411"
                className={cn(buttonVariants({ variant: "outline", size: "lg" }), "rounded-full px-8 h-12 text-base bg-[var(--surface)] border-[var(--border)] text-[var(--text)] hover:bg-[var(--surface-mute)] shadow-[var(--shadow-1)] font-medium")}
              >
                Review Active Incident
              </Link>
            </motion.div>
          </div>

          <motion.div variants={itemVariants} className="relative w-full max-w-lg mx-auto lg:max-w-none flex items-center justify-center">
             <div className="absolute inset-0 bg-[var(--accent-soft)] rounded-full blur-[100px] opacity-40 scale-75" />
             <div className="relative aspect-[4/3] w-full lg:scale-[1.33] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_50%,transparent_100%)]">
                <Image 
                  src="/hero-light.png" 
                  alt="SignalOps Dashboard Visualization" 
                  fill
                  className="object-contain mix-blend-darken"
                  priority
                />
             </div>
          </motion.div>
        </motion.section>

        <motion.section 
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]"
        >
          <motion.div variants={itemVariants}>
            <Card className="h-full border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-2)] ring-0 overflow-hidden relative">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <CardDescription className="font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--mute)] font-semibold mb-1">
                      Live Snapshot
                    </CardDescription>
                    <CardTitle className="text-2xl font-bold tracking-[-0.02em] text-[var(--text)]">Current operating picture</CardTitle>
                  </div>
                  <div className="flex items-center gap-2 rounded-full border border-[var(--success-soft)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--success)] shadow-sm">
                    <span className="relative flex size-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--success)] opacity-75"></span>
                      <span className="relative inline-flex size-1.5 rounded-full bg-[var(--success)]"></span>
                    </span>
                    System Operational
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-3 mb-6">
                  <SnapshotMetric icon={RadioTower} label="Provider p95" value={formatMs(weightedP95)} />
                  <SnapshotMetric icon={Siren} label="Active Jobs" value={formatNumber(activeJobs)} />
                  <SnapshotMetric icon={BadgeDollarSign} label="Spend" value={formatCurrency(totalSpend)} />
                </div>
                <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-mute)] p-5 relative overflow-hidden">
                  <div className="flex flex-wrap items-center gap-2 relative z-10">
                    <Badge variant="destructive" className="shadow-none">{incident.severity}</Badge>
                    <Badge variant="outline" className="bg-[var(--surface)]">{incident.id}</Badge>
                    <span className="font-mono text-xs text-[var(--mute)]">opened {incident.age} ago</span>
                  </div>
                  <h2 className="mt-4 text-lg font-semibold tracking-[-0.02em] text-[var(--text)] relative z-10">{incident.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--text-dim)] relative z-10">{incident.detail}</p>
                  <div className="mt-5 grid gap-3 sm:grid-cols-3 relative z-10">
                    <MiniStat label="provider" value={provider.name} />
                    <MiniStat label="p95" value={formatMs(provider.p95Ms)} />
                    <MiniStat label="failure rate" value={`${provider.failureRate}%`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={itemVariants}>
            <section className="h-full flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-1)] p-6 md:p-8 relative">
              <div className="mb-6 flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--mute)] font-semibold mb-1">
                    Product Loop
                  </p>
                  <h2 className="text-2xl font-bold tracking-[-0.02em] text-[var(--text)]">From signal to change</h2>
                </div>
                <div className="size-10 rounded-xl bg-[var(--accent-soft)] flex items-center justify-center shadow-sm">
                  <GitBranch className="size-5 text-[var(--accent)]" />
                </div>
              </div>
              <ol className="flex flex-col flex-1 justify-between gap-4 relative">
                <div className="absolute left-[13px] top-4 bottom-4 w-[2px] bg-[var(--border-soft)] rounded-full" />
                {loop.map((item, index) => (
                  <li key={item.title} className="relative flex gap-4 items-start group">
                    <span className="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-[var(--border)] bg-[var(--surface)] font-mono text-xs font-bold text-[var(--mute)] group-hover:border-[var(--accent)] group-hover:text-[var(--accent)] group-hover:bg-[var(--accent-soft)] transition-all duration-300">
                      {index + 1}
                    </span>
                    <div className="pt-1">
                      <span className="block text-sm font-semibold text-[var(--text)]">{item.title}</span>
                      <span className="mt-1 block text-[13px] leading-relaxed text-[var(--text-dim)]">{item.text}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </motion.div>
        </motion.section>

        <motion.section 
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="grid gap-6 lg:grid-cols-3"
        >
          <ProductPillar
            icon={ShieldCheck}
            title="Stateful incidents"
            text="Incidents are not decoration: they link to affected jobs, provider data, mitigation state, and audit context natively."
          />
          <ProductPillar
            icon={GitBranch}
            title="Routing rules"
            text="Rules move through draft, simulated, optimistic, and active states using modern server-state patterns."
          />
          <ProductPillar
            icon={Activity}
            title="Dense cockpit"
            text="The cockpit keeps charts, virtualized queue inspection, saved views, and provider analysis one click away."
          />
        </motion.section>

        <motion.section 
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="mt-6 pb-24 text-center"
        >
          <motion.div variants={itemVariants} className="rounded-[2rem] bg-[var(--surface)] border border-[var(--border)] p-12 lg:p-16 relative overflow-hidden shadow-[var(--shadow-2)]">
            <div className="absolute inset-0 bg-[var(--accent-soft)] opacity-30 mix-blend-multiply" />
            <div className="absolute top-0 right-0 w-96 h-96 bg-[var(--success-soft)] blur-[80px] rounded-full opacity-60 translate-x-1/3 -translate-y-1/3" />
            <div className="absolute bottom-0 left-0 w-96 h-96 bg-[var(--info-soft)] blur-[80px] rounded-full opacity-60 -translate-x-1/3 translate-y-1/3" />
            <div className="relative z-10 flex flex-col items-center">
              <div className="size-16 rounded-2xl bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center mb-6 shadow-sm">
                <RadioTower className="size-8 text-[var(--accent)]" />
              </div>
              <h2 className="text-3xl md:text-4xl font-bold tracking-[-0.02em] text-[var(--text)] mb-4">
                Ready to regain control?
              </h2>
              <p className="text-[var(--text-dim)] mb-8 max-w-lg mx-auto text-lg">
                Stop guessing why jobs fail and start operating your AI generation stack with confidence and precision.
              </p>
              <Link href="/cockpit" className={cn(buttonVariants({ size: "lg" }), "rounded-full px-10 h-14 text-base shadow-lg font-medium bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] hover:scale-105 transition-transform duration-300 border-0")}>
                Enter Operations Cockpit
                <ArrowRight className="ml-2 size-5" />
              </Link>
            </div>
          </motion.div>
        </motion.section>
      </div>
    </main>
  );
}

function SnapshotMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm transition-shadow hover:shadow-[var(--shadow-1)]">
      <Icon className="size-5 text-[var(--accent)] mb-3" />
      <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--mute)] mb-1">{label}</div>
      <div className="text-2xl font-bold tracking-tight text-[var(--text)] [font-variant-numeric:tabular-nums]">
        {value}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string; }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 shadow-sm">
      <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--mute)] mb-1">{label}</div>
      <div className="text-sm font-semibold text-[var(--text)]">{value}</div>
    </div>
  );
}

function ProductPillar({
  icon: Icon,
  title,
  text,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  text: string;
}) {
  return (
    <motion.section variants={itemVariants} className="group rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 lg:p-8 transition-all hover:shadow-[var(--shadow-2)] hover:border-[var(--accent)] overflow-hidden relative">
      <div className="absolute -right-12 -top-12 size-40 bg-[var(--accent-soft)] blur-[40px] rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      <div className="relative z-10">
        <div className="size-10 rounded-xl bg-[var(--accent-soft)] border border-[var(--accent-soft)] flex items-center justify-center mb-5 group-hover:scale-105 transition-all duration-300">
          <Icon className="size-5 text-[var(--accent)]" />
        </div>
        <h2 className="text-lg font-bold tracking-[-0.02em] text-[var(--text)] mb-2">{title}</h2>
        <p className="text-sm leading-relaxed text-[var(--text-dim)]">{text}</p>
      </div>
    </motion.section>
  );
}
