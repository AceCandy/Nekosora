# 自动同步主流模型

## Goal

让 `sync:pi-models` 在保留既有模型元数据对齐能力的同时，自动发现并为缺失的主流聊天模型生成可审查、可复现的 PostgreSQL `INSERT` 迁移，避免每次由人工先建目录行才能同步最新模型。

## Background

- 当前 planner 只遍历数据库已有 `model_catalog` 行，只能生成 `UPDATE`；pi 中新增但本库缺失的模型不会进入 `accepted`、`reference` 或 `unmatched`。
- `pi.dev/api/models` 同时包含官方 Provider、聚合商、地区变体和专项模型，不能全量无差别导入。
- 当前工作树已有用户生成且未提交的 `0014_model_catalog_sync`、journal entry 与 snapshot；本任务必须保留这些文件原样，在其后追加迁移。

## Requirements

- R1. 主流家族集中定义为：`claude`、`gpt`、`gemini`、`glm`、`minimax`、`kimi`、`mimo`、`grok`、`qwen`、`deepseek`。
- R2. 家族识别规则与官方主 Provider 映射必须集中在单独模块或单一导出配置中；后续新增家族只改这一处及相应测试，不在 planner、CLI 或 SQL renderer 重复判断。
- R3. 只允许官方主 Provider 条目成为新增候选；聚合商、地区变体和模糊匹配不得生成 `INSERT`。
- R4. `preview` 型号属于收录范围；排除 `batch`、`live`、`image`、`customtools`、`computer-use`、`robotics`、`realtime` 等专项变体，以及日期快照和 `*-latest` 重复别名。
- R5. `pi.dev` 官方主 Provider 当前仍列出的、符合 R1-R4 的缺失通用 chat 型号均可成为新增候选；不自动删除 pi 已不再列出的存量目录行。
- R6. 除 R13 经用户确认的两个业务默认能力外，新增目录行的 ID、名称、输入能力、推理能力、思考格式、档位、上下文窗口和最大输出长度只能来自已解码并通过现有不变量校验的 pi 数据；未知能力不得按家族名猜测。
- R7. `--write` 仍只接受已审查的本地 `PI_MODELS_FILE`，生成带 source SHA-256 的增量迁移，不直接修改数据库。
- R8. 新增 SQL 必须幂等并受 `canonical_model_id` 唯一键保护；同一 snapshot 重跑不得重复插入。
- R9. 保留现有 direct UPDATE、reference、rejection、脱敏和原子写文件行为。
- R10. 保留当前未提交的 `0014` SQL/journal/snapshot 原样；本任务如生成目录数据迁移，使用下一连续 slot 并让 snapshot `prevId` 指向 `0014_snapshot`。
- R11. 目录数据变更必须同步 PostgreSQL migration、Drizzle journal/snapshot，并补模型候选识别、排除规则、INSERT SQL、幂等性、推理不变量和迁移连续性测试。
- R12. 自动新增的目录行默认 `enabled=true`，应用迁移后立即进入目录选择范围；`--write` 的本地 snapshot、人工 SQL 审查和显式迁移继续作为发布闸门。
- R13. 自动新增的主流通用 chat 模型统一写入 `tools=true`、`systemPrompt=true`；这是经用户确认的业务默认值。输入图像能力继续只由 pi 的 `input` 字段决定。
- R14. 新模型的 reasoning bundle 只有在 pi 提供足够且合法的档位/格式证据时写入；不完整或违反现有不变量时，保留模型新增但省略 reasoning bundle，并输出 rejection，不得伪造档位。
- R15. pi 只负责发现和提出候选；实际生成迁移后，新增模型的 ID、名称、输入与推理能力必须逐项核对厂商官方资料，未核实项不得作为已确认能力发布。

## Acceptance Criteria

- [ ] AC1. 给定官方 `google/gemini-3.7-flash` 且数据库没有该 canonical ID，planner 产生一个新增候选，`--write` 生成对应 `INSERT`。
- [ ] AC2. 上述规则同样适用于十个主流家族，并包含 `preview` 型号与 `deepseek`。
- [ ] AC3. 聚合商、地区变体和专项变体不会生成 `INSERT`；缺少新增必需字段的条目被拒绝；仅 reasoning bundle 不完整时仍新增基础模型但省略整包推理能力。审计输出能区分新增、参考与拒绝。
- [ ] AC4. 数据库已有 canonical ID 时不重复新增，既有 UPDATE 对齐行为保持不变。
- [ ] AC5. 家族/Provider/排除规则只有一个维护入口，并有表驱动测试证明扩展点。
- [ ] AC6. 新迁移、journal 与 snapshot 连续且不改写 `0014`；迁移重复执行不会新增重复行或无意义改写已有行。
- [ ] AC7. 相关定向测试、类型检查和独立复核通过。
- [ ] AC8. 新增模型迁移显式或通过数据库默认值保持 `enabled=true`，无需迁移后再次人工启用。
- [ ] AC9. 新增模型默认具备 tools/system prompt；vision 与 reasoning 分别遵守 pi 输入证据和 reasoning bundle 闸门。
- [ ] AC10. 新迁移中的新增模型具有可追溯的官方核对结果；pi direct match 不被当作官方核验替代品。

## Out of Scope

- 自动删除、禁用或重命名 pi 已移除的存量模型。
- 自动创建 Provider、route 或管理员上游绑定。
- 收录主流家族之外的模型。
- 直接连接生产数据库应用迁移。
