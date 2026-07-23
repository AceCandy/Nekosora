"use client";
/**
 * 用量图表组件 —— 基于 recharts。
 * 三张图:请求量趋势(堆叠面积)、Token 消耗(分组柱)、模型分布(饼)。
 *
 * 设计贴合 DESIGN.md:莫兰迪灰调、无彩色侧条、静止无投影。
 */
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { useTranslations } from "next-intl";

export interface TimeSeriesPoint {
  bucket: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
}
export interface ModelRow { model: string; calls: number; promptTokens: number; completionTokens: number; }
export interface SourceRow { source: string; calls: number; }

const PROMPT_COLOR = "var(--color-chart-1)";
const COMPLETION_COLOR = "var(--color-chart-2)";
const CALLS_COLOR = "var(--color-chart-3)";
const PIE_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-chart-6)",
];
const CHART_CAPTION_FONT_SIZE = 12;

const tooltipStyle = {
  fontSize: CHART_CAPTION_FONT_SIZE,
  borderRadius: 6,
  border: "1px solid var(--color-chart-tooltip-border)",
  backgroundColor: "var(--color-chart-tooltip-bg)",
  color: "var(--color-chart-tooltip-text)",
};
const legendStyle = { fontSize: CHART_CAPTION_FONT_SIZE };

// recharts v3 formatter 类型严格(value 可能为 undefined/非 number),用宽类型兼容。
const formatNumber = (v: unknown): string => Number(v ?? 0).toLocaleString();

function formatBucket(b: string): string {
  // "2026-06-19 14:00" → "06-19 14:00";"2026-06-19" → "06-19"
  const parts = b.split(" ");
  const date = parts[0]?.slice(5) ?? b;
  return parts[1] ? `${date} ${parts[1]}` : date;
}

export function RequestsTrendChart({ data }: { data: TimeSeriesPoint[] }) {
  const t = useTranslations("admin.usage");
  const chartData = data.map((d) => ({
    bucket: formatBucket(d.bucket),
    prompt: d.promptTokens,
    completion: d.completionTokens,
  }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="gPrompt" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={PROMPT_COLOR} stopOpacity={0.35} />
            <stop offset="95%" stopColor={PROMPT_COLOR} stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="gCompletion" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={COMPLETION_COLOR} stopOpacity={0.35} />
            <stop offset="95%" stopColor={COMPLETION_COLOR} stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" vertical={false} />
        <XAxis dataKey="bucket" tick={{ fontSize: CHART_CAPTION_FONT_SIZE, fill: "var(--color-chart-axis)" }} interval="preserveStartEnd" minTickGap={32} />
        <YAxis tick={{ fontSize: CHART_CAPTION_FONT_SIZE, fill: "var(--color-chart-axis)" }} width={48} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={formatNumber}
        />
        <Legend wrapperStyle={legendStyle} />
        <Area type="monotone" dataKey="prompt" name={t("legendPromptTokens")} stackId="1" stroke={PROMPT_COLOR} fill="url(#gPrompt)" strokeWidth={1.5} />
        <Area type="monotone" dataKey="completion" name={t("legendCompletionTokens")} stackId="1" stroke={COMPLETION_COLOR} fill="url(#gCompletion)" strokeWidth={1.5} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ModelTokensChart({ data }: { data: ModelRow[] }) {
  const t = useTranslations("admin.usage");
  // 仅取 Top 6 模型,避免柱子过多。
  const top = data.slice(0, 6).map((d) => ({
    model: d.model.length > 16 ? d.model.slice(0, 14) + "…" : d.model,
    prompt: d.promptTokens,
    completion: d.completionTokens,
  }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={top} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" vertical={false} />
        <XAxis dataKey="model" tick={{ fontSize: CHART_CAPTION_FONT_SIZE, fill: "var(--color-chart-axis)" }} interval={0} />
        <YAxis tick={{ fontSize: CHART_CAPTION_FONT_SIZE, fill: "var(--color-chart-axis)" }} width={48} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={formatNumber}
        />
        <Legend wrapperStyle={legendStyle} />
        <Bar dataKey="prompt" name={t("legendPromptTokens")} fill={PROMPT_COLOR} radius={[3, 3, 0, 0]} />
        <Bar dataKey="completion" name={t("legendCompletionTokens")} fill={COMPLETION_COLOR} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ModelCallsPie({ data }: { data: ModelRow[] }) {
  const pieData = data.slice(0, 6).map((d) => ({ name: d.model, value: d.calls }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={pieData}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={88}
          innerRadius={44}
          paddingAngle={2}
        >
          {pieData.map((_, i) => (
            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="none" />
          ))}
        </Pie>
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={formatNumber}
        />
        <Legend wrapperStyle={legendStyle} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function SourceBar({ data }: { data: SourceRow[] }) {
  const t = useTranslations("admin.usage");
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" vertical={false} />
        <XAxis dataKey="source" tick={{ fontSize: CHART_CAPTION_FONT_SIZE, fill: "var(--color-chart-axis)" }} />
        <YAxis tick={{ fontSize: CHART_CAPTION_FONT_SIZE, fill: "var(--color-chart-axis)" }} width={48} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={formatNumber}
        />
        <Bar dataKey="calls" name={t("legendCalls")} fill={CALLS_COLOR} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
