"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartData } from "./schema";

/**
 * 品牌冷调调色板，按 series 索引循环。引用 globals.css 的 chart token，
 * 避免在组件里散落裸色值；暗色模式下 token 明度仍与深背景保持可读对比。
 */
const CHART_PALETTE = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

const AXIS_TICK = { fontSize: 11, fill: "var(--color-deep-space)" };
const GRID_STROKE = "var(--color-morning-mist)";

function colorAt(i: number): string {
  return CHART_PALETTE[i % CHART_PALETTE.length];
}

/** 结构化图表块：按 type 路由到 recharts 的 bar / line / area / pie。 */
export function ChartBlock({ data }: { data: ChartData }) {
  if (data.type === "pie") return <PieView data={data} />;
  return <CartesianView data={data} />;
}

/** bar / line / area 共用笛卡尔坐标系。 */
function CartesianView({ data }: { data: ChartData }) {
  const xKey = data.xKey ?? Object.keys(data.data[0] ?? {})[0] ?? "name";
  const showLegend = data.series.length > 1;
  const grid = <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />;

  return (
    <div className="my-2 h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        {data.type === "line" ? (
          <LineChart data={data.data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            {grid}
            <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={36} />
            <Tooltip />
            {showLegend ? <Legend /> : null}
            {data.series.map((s, i) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label ?? s.key}
                stroke={colorAt(i)}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        ) : data.type === "area" ? (
          <AreaChart data={data.data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            {grid}
            <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={36} />
            <Tooltip />
            {showLegend ? <Legend /> : null}
            {data.series.map((s, i) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label ?? s.key}
                stroke={colorAt(i)}
                fill={colorAt(i)}
                fillOpacity={0.18}
              />
            ))}
          </AreaChart>
        ) : (
          <BarChart data={data.data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            {grid}
            <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={36} />
            <Tooltip />
            {showLegend ? <Legend /> : null}
            {data.series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.label ?? s.key} fill={colorAt(i)} radius={[4, 4, 0, 0]} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

function PieView({ data }: { data: ChartData }) {
  const valueKey = data.series[0]?.key;
  const nameKey = data.xKey ?? "name";
  return (
    <div className="my-2 h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip />
          {valueKey ? (
            <Pie data={data.data} dataKey={valueKey} nameKey={nameKey} outerRadius={80} label={{ fontSize: 11 }}>
              {data.data.map((_, i) => (
                <Cell key={i} fill={colorAt(i)} />
              ))}
            </Pie>
          ) : null}
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
