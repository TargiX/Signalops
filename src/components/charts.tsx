"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  ScatterChart,
  Scatter,
  ZAxis,
} from "recharts";
import { useEffect, useRef, useState } from "react";
import type { TimeBucket, Provider } from "@/lib/mock-data";
import { formatCurrency, formatMs, cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

const tooltipStyle = {
  background: "color-mix(in oklch, var(--surface) 95%, transparent)",
  backdropFilter: "blur(8px)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  boxShadow: "var(--shadow-3, 0 8px 24px rgba(20,20,30,0.08))",
  color: "var(--text)",
};

type GlowTone = "accent" | "warning";

type GlowingCursorProps = {
  x?: number;
  width?: number;
  height?: number;
  tone?: GlowTone;
};

function GlowingCursor({ x, width = 0, height = 0, tone = "accent" }: GlowingCursorProps) {
  if (typeof x !== "number") return null;
  
  return (
    <g style={{ transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)" }}>
      <defs>
        <linearGradient id={`glow-${tone}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={`var(--${tone})`} stopOpacity={0} />
          <stop offset="50%" stopColor={`var(--${tone})`} stopOpacity={0.15} />
          <stop offset="100%" stopColor={`var(--${tone})`} stopOpacity={0} />
        </linearGradient>
      </defs>
      <rect
        x={x}
        y={0}
        width={width}
        height={height + 20}
        fill={`url(#glow-${tone})`}
      />
      <rect
        x={x + width / 2 - 0.5}
        y={0}
        width={1}
        height={height + 20}
        fill={`var(--${tone})`}
        opacity={0.3}
      />
    </g>
  );
}

export function ThroughputChart({ data }: { data: TimeBucket[] }) {
  const [containerRef, width] = useChartWidth();

  return (
    <div ref={containerRef} className="h-[254px] min-w-0">
      {width > 0 ? (
        <BarChart
          data={data}
          height={254}
          margin={{ left: -22, right: 8, top: 12 }}
          width={width}
        >
          <CartesianGrid stroke="var(--border-soft)" vertical={false} />
          <XAxis dataKey="time" tickLine={false} axisLine={false} tick={{ fill: "var(--mute)", fontSize: 11 }} />
          <YAxis tickLine={false} axisLine={false} tick={{ fill: "var(--mute)", fontSize: 11 }} />
          <Tooltip
            contentStyle={tooltipStyle}
            labelStyle={{ color: "var(--text)" }}
            cursor={<GlowingCursor tone="accent" />}
            formatter={(value, name) => [
              name === "spend" ? formatCurrency(Number(value)) : value,
              name,
            ]}
          />
          <Bar
            dataKey="volume"
            fill="var(--accent)"
            isAnimationActive={false}
            name="generations"
            radius={[3, 3, 0, 0]}
          />
          <Bar
            dataKey="failures"
            fill="var(--danger)"
            isAnimationActive={false}
            name="failures"
            radius={[3, 3, 0, 0]}
          />
        </BarChart>
      ) : null}
    </div>
  );
}

export function LatencyChart({ data }: { data: TimeBucket[] }) {
  const [containerRef, width] = useChartWidth();

  return (
    <div ref={containerRef} className="h-[254px] min-w-0">
      {width > 0 ? (
        <BarChart
          data={data}
          height={254}
          margin={{ left: -18, right: 8, top: 12 }}
          width={width}
        >
          <CartesianGrid stroke="var(--border-soft)" vertical={false} />
          <XAxis dataKey="time" tickLine={false} axisLine={false} tick={{ fill: "var(--mute)", fontSize: 11 }} />
          <YAxis
            tickFormatter={(value) => `${Math.round(Number(value) / 1000)}s`}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--mute)", fontSize: 11 }}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            labelStyle={{ color: "var(--text)" }}
            cursor={<GlowingCursor tone="warning" />}
            formatter={(value) => [formatMs(Number(value)), "p95 latency"]}
          />
          <Bar
            dataKey="latency"
            fill="var(--warning)"
            isAnimationActive={false}
            radius={[3, 3, 0, 0]}
          />
        </BarChart>
      ) : null}
    </div>
  );
}

function useChartWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!ref.current) {
      return;
    }

    const element = ref.current;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.floor(entry.contentRect.width));
    });

    observer.observe(element);
    setWidth(Math.floor(element.getBoundingClientRect().width));

    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

export function SpendDonutChart({ data }: { data: Provider[] }) {
  const [containerRef, width] = useChartWidth();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const totalSpend = data.reduce((sum, item) => sum + item.spend, 0);
  const activeItem = activeIndex !== null ? data[activeIndex] : null;

  return (
    <div ref={containerRef} className="relative flex h-[254px] min-w-0 items-center justify-center">
      {width > 0 && (
        <>
          <PieChart width={width} height={254}>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={76}
              outerRadius={96}
              dataKey="spend"
              stroke="var(--surface)"
              strokeWidth={3}
              isAnimationActive={true}
              animationBegin={0}
              animationDuration={800}
              animationEasing="ease-out"
              paddingAngle={2}
            >
              {data.map((entry, index) => (
                <Cell 
                  key={entry.id} 
                  fill={entry.color} 
                  style={{ 
                    outline: "none", 
                    cursor: "pointer",
                    filter: activeIndex === index ? `drop-shadow(0 0 8px ${entry.color}80)` : "none",
                    transform: activeIndex === index ? "scale(1.04)" : "scale(1)",
                    transformOrigin: "center",
                    transition: "all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)"
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseLeave={() => setActiveIndex(null)}
                />
              ))}
            </Pie>
          </PieChart>
          
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <AnimatePresence mode="wait">
              {activeItem ? (
                <motion.div
                  key={activeItem.id}
                  initial={{ opacity: 0, y: 4, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="flex flex-col items-center"
                >
                  <span className="mb-0.5 text-[13px] font-medium text-[var(--text-dim)]">
                    {activeItem.name}
                  </span>
                  <span className="text-xl font-bold tracking-tight text-[var(--text)]">
                    {formatCurrency(activeItem.spend)}
                  </span>
                  <span 
                    className="mt-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" 
                    style={{ color: activeItem.color, backgroundColor: `${activeItem.color}15` }}
                  >
                    {((activeItem.spend / totalSpend) * 100).toFixed(1)}%
                  </span>
                </motion.div>
              ) : (
                <motion.div
                  key="total"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center"
                >
                  <span className="mb-0.5 text-[13px] font-medium text-[var(--text-dim)]">
                    Total Spend
                  </span>
                  <span className="text-xl font-bold tracking-tight text-[var(--text)]">
                    {formatCurrency(totalSpend)}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </>
      )}
    </div>
  );
}

export function TrafficAreaChart({ data }: { data: TimeBucket[] }) {
  const [containerRef, width] = useChartWidth();

  return (
    <div ref={containerRef} className="h-[254px] min-w-0">
      {width > 0 ? (
        <AreaChart
          data={data}
          height={254}
          margin={{ left: -22, right: 8, top: 12 }}
          width={width}
        >
          <defs>
            <linearGradient id="colorVolume" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.4} />
              <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border-soft)" vertical={false} />
          <XAxis dataKey="time" tickLine={false} axisLine={false} tick={{ fill: "var(--mute)", fontSize: 11 }} />
          <YAxis tickLine={false} axisLine={false} tick={{ fill: "var(--mute)", fontSize: 11 }} />
          <Tooltip
            contentStyle={tooltipStyle}
            labelStyle={{ color: "var(--text)" }}
            cursor={<GlowingCursor tone="accent" />}
          />
          <Area
            type="monotone"
            dataKey="volume"
            stroke="var(--accent)"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#colorVolume)"
            isAnimationActive={false}
          />
        </AreaChart>
      ) : null}
    </div>
  );
}

export function PerformanceScatterChart({ data }: { data: Provider[] }) {
  const [containerRef, width] = useChartWidth();
  const [isFirstHover, setIsFirstHover] = useState(true);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    // Keep transition disabled for the first 50ms so the initial jump is instant
    timeoutRef.current = setTimeout(() => {
      setIsFirstHover(false);
    }, 50);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    // Reset so the next time user enters the chart, it's instant again
    setIsFirstHover(true);
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "h-[254px] min-w-0",
        isFirstHover && "[&_.recharts-tooltip-wrapper]:!transition-none"
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {width > 0 ? (
        <ScatterChart
          height={254}
          margin={{ left: -18, right: 8, top: 12, bottom: 8 }}
          width={width}
        >
          <CartesianGrid stroke="var(--border-soft)" strokeDasharray="3 3" />
          <XAxis 
            type="number" 
            dataKey="p95Ms" 
            name="Latency" 
            tickFormatter={(value) => `${Math.round(value / 1000)}s`}
            tickLine={false} 
            axisLine={false} 
            tick={{ fill: "var(--mute)", fontSize: 11 }} 
            domain={['dataMin - 1000', 'dataMax + 1000']}
          />
          <YAxis 
            type="number" 
            dataKey="failureRate" 
            name="Failure Rate" 
            tickFormatter={(value) => `${value}%`}
            tickLine={false} 
            axisLine={false} 
            tick={{ fill: "var(--mute)", fontSize: 11 }} 
            domain={[0, 'dataMax + 2']}
          />
          <ZAxis type="number" dataKey="volume" range={[60, 400]} name="Volume" />
          <Tooltip 
            cursor={{ strokeDasharray: '3 3' }} 
            contentStyle={tooltipStyle}
            isAnimationActive={true}
            formatter={(value, name) => [
              name === "Latency" ? formatMs(Number(value)) : name === "Failure Rate" ? `${value}%` : value, 
              name
            ]}
          />
          {data.map((entry) => (
            <Scatter key={entry.id} name={entry.name} data={[entry]} fill={entry.color} opacity={0.8} />
          ))}
        </ScatterChart>
      ) : null}
    </div>
  );
}
