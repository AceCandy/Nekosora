# 自动同步主流模型：实施计划

1. [x] 新增主流模型策略模块与表驱动测试。
   - 实现十个家族的官方 Provider/前缀映射。
   - 覆盖 preview 收录、专项/日期/latest/地区/聚合商排除和 Qwen 混合 Provider 前缀隔离。
   - Verify: 策略纯函数定向测试。

2. [x] 扩展 pi decoder 与 planner 的 addition 合约。
   - 解码新增模型必需的 name 与 adaptive-thinking 证据。
   - 从现有匹配结果记录 source 占用，生成稳定、去重的 additions。
   - 构造 tools/systemPrompt、vision、reasoning 与 token 元数据；非法/不完整 reasoning 原子省略并审计。
   - Verify: decoder、planner、排序、去重、existing-row 不重复、Gemini 3.7 Flash、DeepSeek 与 reasoning 闸门测试。

3. [x] 扩展审计输出与 SQL renderer。
   - dry-run 显示 new/additions，保留现有 accepted/reference/rejected 输出。
   - additions 生成 enabled chat `INSERT ... ON CONFLICT DO NOTHING`，changes 继续生成幂等 UPDATE。
   - Verify: SQL escaping、默认字段、capabilities、token 列、顺序、幂等与 reference/rejection 不入 SQL 测试。

4. [x] 使用已审查的最新 pi snapshot 生成下一条目录迁移。
   - 保留用户未提交的 0014 三件套原样并记录生成前 hash。
   - 生成下一连续 SQL/journal/snapshot，逐条审查新增 family、排除项、capabilities 和 source digest。
   - 对迁移中的新增模型逐项核对厂商官方资料，记录 ID、名称、输入和推理能力证据；未核实能力从 migration 中移除。
   - 删除本任务临时 snapshot，不提交缓存或调试产物。
   - Verify: 0014 hash 不变；新 journal idx/time/tag、snapshot prevId/schema、migration statement 目标连续。

5. [x] 更新模型目录同步规范和 README 行为说明。
   - 将旧“禁止 bulk import”契约更新为“仅允许策略筛选后的官方主流 additions”；继续禁止 live write/direct apply。
   - 记录单一策略入口、能力默认、reasoning 闸门与测试矩阵。
   - Verify: 文档与实现术语、命令和审计输出一致。

6. [x] 运行质量门禁并独立复核。
   - 定向 Vitest：mainstream policy、sync planner/CLI、reasoning、model catalog migration。
   - 运行受影响 workspace typecheck；不启动长期服务、不执行生产迁移。
   - `git diff --check`；复核所有 changed line 可追溯至本任务，0014 未改写，无临时/隐私/密钥产物。
   - 若测试或复核发现候选误收，回到策略/decoder 修正并重复验证。

## 风险文件与回滚点

- `packages/core/src/lib/mainstream-models.ts`：主流候选唯一策略入口。
- `packages/core/src/lib/sync-pi-models.ts`：外部 decoder、planner 与 SQL 的核心信任边界。
- `apps/web/scripts/sync-pi-models.ts`：只扩展审计呈现，不复制识别逻辑。
- `drizzle/pg/**`：只追加新迁移；0014 及更早文件不得改写。
- `.trellis/spec/backend/chat-generation-params.md`：同步契约必须与新 additions 行为一致。

代码阶段若需撤销，优先回滚本任务代码与尚未应用的新迁移文件；不删除或重写用户已有 0014。
