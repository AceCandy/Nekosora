# 结构化代码块 JSON 宽容修复(metric 块模型坏 JSON 渲染失败)

## 背景

聊天里 ```metric 结构化块频繁显示降级态「内容解析失败，已显示源码」。诊断(临时 console 日志抓到运行时 raw)确认根因:**模型产出的 JSON 本身是坏的**,不是渲染器 bug、不是 chat-stream-smooth 改动、也不是中断/隐藏字符。

典型坏结构(控制台实测):
```
{"label":"海岸线长度","value":"18039,"unit":"km","trend":"flat"}
```
即:数字 `value` 被加了引号、且字段分隔逗号被关进了引号里(`"18039,"`),下一字段 `unit` 丢了逗号和 key 引号 → `JSON.parse` 失败 → `invalid_json` 降级。

`parseStructured` 返回 `reason: invalid_json`(非 schema_mismatch),`suspicious` 码点全是中文(无隐藏字符)。

## Goal

让结构化块对模型常见的 JSON 格式错误具备**宽容修复**能力,把"模型轻微坏 JSON 就整块降级"变成"能修就修、修不了再降级";同时在产出层压低出错率。

## Requirements

1. **方向 2(主)宽容修复层**:在 `src/shared/components/structured-blocks/schema.ts` 的 `parseStructured` 中,当 strict `JSON.parse` 失败时,用 `jsonrepair` 兜一道再 parse;两者都失败才返回 `invalid_json`。
   - 流式增量 `parsePartialMetricItems` 的逐项 parse 同样接入修复(避免流式少卡、终态多卡的跳动)。
   - 抽出统一的 `looseJsonParse` helper,避免重复。
2. **方向 1(辅)强化提示词**:在 `src/lib/infra/db/bootstrap.ts` 的 `BUILTIN_STRUCTURED_OUTPUT_PROMPT` 增加反例,明确"数值不加引号、逗号写在字段之间(引号外)",压低模型产出坏 JSON 的概率。
3. **删除临时诊断**:移除 `index.tsx` 里 `[TEMP-DIAG]` 的 `console.warn` 块。
4. **测试**:`schema.test.ts` 补 jsonrepair 路例(逗号关进引号、数字被引、末尾多余逗号等)。

## 范围与约束

- 仅结构化块解析层 + 产出提示词,不动 chat-stream-smooth 的流式/合批改动。
- `jsonrepair` 已实测可修上述坏结构(A/B 样本通过,C 极端"两对象糊一起"修不了——可接受,降级兜底仍在)。
- 宽容修复仅作用于结构化块(`parseStructured` / `parsePartialMetricItems`),不扩散到其它 JSON 解析。
- 修出来的 value 若是字符串(如 `"18039"`),metric schema 已接受 `string|number`,无需额外处理。

## Acceptance Criteria

- [ ] 模型产出 `"value":"18039,"unit"` 这类坏 JSON 时,metric 块能正常渲染成指标卡(不再降级)。
- [ ] strict JSON 合法时行为不变(不经过 jsonrepair)。
- [ ] 流式增量路径同样能修(流式与终态卡数一致,无明显跳动)。
- [ ] `schema.test.ts` 新增修复用例通过;既有用例不回归。
- [ ] 临时诊断 `console.warn` 已删除。
- [ ] 改动文件与 chat-stream-smooth 不重叠,可独立提交。

## Notes

- jsonrepair 3.15.0 已通过 `pnpm add jsonrepair` 装入。
- 修复仅作为"strict 失败后的兜底",不改变 schema 校验严格性;schema 不合仍正常返回 `schema_mismatch`。
