import { z } from "zod";
import { jsonrepair } from "jsonrepair";

/**
 * 结构化代码块 schema —— AI 在 ```chart / ```metric / ```table 代码块内输出 JSON，
 * 经此处的 zod 边界校验后交给受控 React 组件渲染。
 *
 * AI 输出属不可信外部输入（可被 prompt 注入），因此：
 *  - 颜色一律由前端按品牌调色板分配，schema 不收 AI 色值；
 *  - 校验失败统一返回 { ok: false }，由 MarkdownCodeBlock 入口降级为源码展示。
 */

/** 结构化代码块类型，与 html/svg/mermaid 的 PreviewableKind 互斥。 */
export type StructuredKind = "chart" | "metric" | "table" | "callout";

/** chart 单条系列：数据字段 key + 可选展示名。 */
const ChartSeriesSchema = z.object({
  key: z.string(),
  label: z.string().optional(),
});

const ChartSchema = z.object({
  type: z.enum(["bar", "line", "pie", "area"]),
  title: z.string().optional(),
  /** bar / line / area 的横轴字段名；pie 可省略。 */
  xKey: z.string().optional(),
  series: z.array(ChartSeriesSchema).min(1),
  data: z.array(z.record(z.string(), z.unknown())),
});

const MetricItemSchema = z.object({
  label: z.string(),
  value: z.union([z.string(), z.number()]),
  unit: z.string().optional(),
  trend: z.enum(["up", "down", "flat", "high", "medium", "low"]).optional(),
  delta: z.string().optional(),
});

/** metric 兼容单对象与数组：单指标渲染一张卡，多指标数组横排多张卡。 */
const MetricSchema = z.union([MetricItemSchema, z.array(MetricItemSchema).min(1)]);

const TableColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  align: z.enum(["left", "center", "right"]).optional(),
  emphasis: z.boolean().optional(),
});

const TableSchema = z.object({
  title: z.string().optional(),
  columns: z.array(TableColumnSchema).min(1),
  rows: z.array(z.record(z.string(), z.unknown())),
});

/** callout 类型:warning 警告 / tip 提示 / note 注意 / error 错误,配图标与类型色。 */
const CalloutSchema = z.object({
  type: z.enum(["warning", "tip", "note", "error"]),
  title: z.string().optional(),
  body: z.string(),
});

export type ChartData = z.infer<typeof ChartSchema>;
export type MetricItem = z.infer<typeof MetricItemSchema>;
export type MetricData = z.infer<typeof MetricSchema>;
export type TableData = z.infer<typeof TableSchema>;
export type CalloutData = z.infer<typeof CalloutSchema>;

export type StructuredParseFailure = "invalid_json" | "schema_mismatch";

export type StructuredParseResult =
  | { ok: true; kind: StructuredKind; data: ChartData | MetricData | TableData | CalloutData }
  | { ok: false; kind: StructuredKind; reason: StructuredParseFailure };

const STRUCTURED_SCHEMAS = {
  chart: ChartSchema,
  metric: MetricSchema,
  table: TableSchema,
  callout: CalloutSchema,
} as const;

/**
 * 宽容 JSON 解析:先用 strict JSON.parse;失败再用 jsonrepair 兜底修复后 parse。
 * AI 产出的结构化块 JSON 常见格式错误(数字加引号、逗号关进引号、末尾多余逗号、
 * 单引号、未闭合等),jsonrepair 能修绝大多数;两者都失败时抛错,由调用方决定降级。
 */
function looseJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(jsonrepair(text));
  }
}

/**
 * 解析结构化代码块内容：宽容 JSON.parse + zod 校验。
 * 成功返回强类型数据；失败返回降级原因，交由入口回退源码展示。
 */
export function parseStructured(kind: StructuredKind, raw: string): StructuredParseResult {
  let json: unknown;
  try {
    json = looseJsonParse(raw);
  } catch {
    return { ok: false, kind, reason: "invalid_json" };
  }
  const parsed = STRUCTURED_SCHEMAS[kind].safeParse(json);
  if (!parsed.success) return { ok: false, kind, reason: "schema_mismatch" };
  return { ok: true, kind, data: parsed.data };
}

/**
 * 流式增量解析:从半截的 metric 数组 JSON 里切出已闭合、字段齐全的指标项,
 * 用于流式态逐张画卡,无需等整个 fenced 块闭合。
 *
 * 仅处理数组形态;单对象半截无法可靠切字段,仍走块闭合渲染。
 * 按括号深度扫描,字符串内的引号/括号被正确跳过,不被 JSON 字符串内容误导。
 */
export function parsePartialMetricItems(raw: string): MetricItem[] {
  const start = raw.indexOf("[");
  if (start < 0) return [];
  const items: MetricItem[] = [];
  let depth = 0;
  let inStr = false;
  let esc = false;
  let elemStart = -1;
  for (let i = start + 1; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") {
      if (depth === 0) elemStart = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && elemStart >= 0) {
        try {
          const parsed = MetricItemSchema.safeParse(looseJsonParse(raw.slice(elemStart, i + 1)));
          if (parsed.success) items.push(parsed.data);
        } catch {
          // 切出的闭合对象 strict + jsonrepair 都失败时跳过(含坏 JSON 逐项修复)
        }
        elemStart = -1;
      }
    }
  }
  return items;
}
