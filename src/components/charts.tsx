"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useEffect, useRef, useState } from "react";
import type { TimeBucket } from "@/lib/mock-data";
import { formatCurrency, formatMs } from "@/lib/utils";

const tooltipStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  boxShadow: "var(--shadow-3, 0 8px 24px rgba(20,20,30,0.08))",
  color: "var(--text)",
};

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
