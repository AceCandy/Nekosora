# 实施清单 — 结构化块 JSON 宽容修复

> 任务路径:`.trellis/tasks/07-14-structured-json-repair`
> 上下文顺序:`prd.md` → 本文件。研究/验证结论已并入 prd「Notes」。

## 1. schema.ts:加宽容修复层

文件:`src/shared/components/structured-blocks/schema.ts`

- [ ] 新增 helper:
  ```ts
  import { jsonrepair } from "jsonrepair";
  /** strict JSON.parse 失败时用 jsonrepair 兜底;都失败返回 null。 */
  function looseJsonParse(text: string): unknown | null {
    try { return JSON.parse(text); } catch { /* 走修复 */ }
    try { return JSON.parse(jsonrepair(text)); } catch { return null; }
  }
  ```
- [ ] `parseStructured`:把 `JSON.parse(raw)` 包进 `looseJsonParse`;`null` → `invalid_json`,否则继续 zod。schema 不合仍 `schema_mismatch`。
- [ ] `parsePartialMetricItems`:逐项的 `JSON.parse(slice)` 改用 `looseJsonParse`(切出的闭合对象可能也是坏 JSON)。

> 验证:`node --import tsx` 跑一次,确认 `parseStructured("metric", '{"label":"x","value":"18039,"unit":"km"}')` 返回 `ok:true`。

## 2. bootstrap.ts:强化提示词(反例)

文件:`src/lib/infra/db/bootstrap.ts`,`BUILTIN_STRUCTURED_OUTPUT_PROMPT`(约 360-392 行)

- [ ] 在 metric 示例后、或在文末「代码块内必须是合法 JSON」前,加反例段落:
  - 数值不要加引号:写 `"value":18039`,不要写 `"value":"18039"`。
  - 字段间逗号写在引号外:写 `"value":18039,"unit":"km"`,不要写成 `"value":"18039,"unit"`(逗号被关进引号会导致 JSON 失效)。
  - 仅产出一个 JSON 根对象/数组,不要把多个对象连写。

> 注意:此 prompt 经 `ensureBuiltinOutputModes` 幂等 upsert,改常量后下次启动即刷新 DB 中既有行;仅在使用「结构化输出」outputMode 时注入。

## 3. 删除临时诊断

文件:`src/shared/components/structured-blocks/index.tsx`

- [ ] 移除 `[TEMP-DIAG]` 注释包裹的 `console.warn("[structured-fail]", ...)` 代码块(降级路径前)。

## 4. 测试

文件:`src/shared/components/structured-blocks/schema.test.ts`

- [ ] 新增:逗号关进引号(`"value":"18039,"unit"`)→ metric 解析成功。
- [ ] 新增:数字被引号(`"value":"35"`)→ 成功(本就合法,确认不破坏)。
- [ ] 新增:末尾多余逗号 / 单引号 等 jsonrepair 可修形态 → 成功。
- [ ] 既有用例不回归。

## 5. 验证(整体)

- [ ] `pnpm vitest run src/shared/components/structured-blocks/schema.test.ts` 通过。
- [ ] `pnpm exec tsc --noEmit`(或项目既定 typecheck)无新增错误。
- [ ] 手测:浏览器复现原坏 metric 消息,`[structured-fail]` 不再出现、指标卡正常渲染(诊断删前最后一次确认)。

## 提交边界

仅提交:`package.json`、`pnpm-lock.yaml`、`src/shared/components/structured-blocks/schema.ts`、`schema.test.ts`、`index.tsx`(仅删诊断)、`src/lib/infra/db/bootstrap.ts`。
**不包含** chat-stream-smooth 的任何文件(Markdown.tsx / chatStreamStore.ts / stream.ts / route.ts / ChatComposer / ChatMessageList / useChatScrollController)。
