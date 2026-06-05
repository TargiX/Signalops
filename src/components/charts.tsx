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
import { formatCurrency, formatMs } from "@/lib/utils";

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

  return (
    <div ref={containerRef} className="h-[254px] min-w-0 flex items-center justify-center">
      {width > 0 ? (
        <PieChart width={width} height={254}>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={70}
            outerRadius={95}
            dataKey="spend"
            stroke="var(--surface)"
            strokeWidth={3}
            isAnimationActive={false}
          >
            {data.map((entry) => (
              <Cell key={entry.id} fill={entry.color} />
            ))}
          </Pie>
        </PieChart>
      ) : null}
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

  return (
    <div ref={containerRef} className="h-[254px] min-w-0">
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
