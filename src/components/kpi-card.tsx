import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function KpiCard({
  title,
  value,
  delta,
  icon: Icon,
  tone = "neutral",
}: {
  title: string;
  value: string;
  delta: string;
  icon: LucideIcon;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  return (
    <section
      className={cn(
        "relative min-h-[132px] min-w-0 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-1)]",
        tone === "good" && "border-l-[var(--success)]",
        tone === "warn" && "border-l-[var(--warning)]",
        tone === "bad" && "border-l-[var(--danger)]",
        tone === "neutral" && "border-l-[var(--accent)]",
      )}
    >
      <div className="absolute inset-x-0 bottom-0 grid h-8 grid-cols-12 opacity-80">
        {Array.from({ length: 12 }).map((_, index) => (
          <span
            key={index}
            className={cn(
              "self-end border-r border-[var(--surface)]",
              tone === "good" && "bg-[var(--success-soft)]",
              tone === "warn" && "bg-[var(--warning-soft)]",
              tone === "bad" && "bg-[var(--danger-soft)]",
              tone === "neutral" && "bg-[var(--accent-soft)]",
            )}
            style={{ height: `${26 + ((index * 17) % 58)}%` }}
          />
        ))}
      </div>
      <div className="flex items-start justify-between gap-4">
        <div className="relative">
          <p className="text-[11px] font-medium uppercase tracking-[0.03em] text-[var(--mute)]">
            {title}
          </p>
          <p className="mt-3 text-4xl font-medium leading-none tracking-[-0.03em] text-[var(--text)] [font-variant-numeric:tabular-nums]">
            {value}
          </p>
        </div>
        <span
          className={cn(
            "relative grid size-10 place-items-center rounded-lg border",
            tone === "good" && "border-transparent bg-[var(--success-soft)] text-[var(--success)]",
            tone === "warn" && "border-transparent bg-[var(--warning-soft)] text-[var(--warning)]",
            tone === "bad" && "border-transparent bg-[var(--danger-soft)] text-[var(--danger)]",
            tone === "neutral" && "border-transparent bg-[var(--accent-soft)] text-[var(--accent)]",
          )}
        >
          <Icon className="size-4" />
        </span>
      </div>
      <p
        className={cn(
          "relative mt-4 text-[12.5px]",
          tone === "good" && "text-[var(--success)]",
          tone === "warn" && "text-[var(--warning)]",
          tone === "bad" && "text-[var(--danger)]",
          tone === "neutral" && "text-[var(--text-dim)]",
        )}
      >
        {delta}
      </p>
    </section>
  );
}
