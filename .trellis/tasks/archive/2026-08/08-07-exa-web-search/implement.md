# Exa 联网搜索后端实施计划

## 1. 实现 Provider

- 新增 `packages/core/src/lib/web-search/exa.ts`，实现固定端点、`x-api-key`、Zod 响应边界、highlights 映射、日期范围和 AbortSignal。
- 在 `provider-freshness.test.ts` 增加 Exa 请求体、header、普通/自定义日期范围、highlights 与发布日期映射测试；覆盖非 2xx 和取消可沿现有错误/信号语义工作。
- 验证：
  - `pnpm --filter @nekusora/core exec vitest run src/lib/web-search/provider-freshness.test.ts`

## 2. 接入配置与界面

- 在 `types.ts`、`registry.ts`、web-search page 输入 schema 和 `WebSearchManager` 类型列表中加入 `exa`。
- 在 `registry.test.ts` 用 Exa 覆盖配置解析、密文存储、DTO 脱敏和 round-trip，避免只测试 TypeScript 枚举。
- 增加中英文 Exa 类型/提示文案并更新 Provider 描述，复用现有 API Key 表单，不增加新控件。
- 验证：
  - `pnpm --filter @nekusora/core exec vitest run src/lib/web-search/registry.test.ts`
  - 中英文消息 JSON 可解析且 key 对齐。

## 3. 集成验证

- 运行聚焦测试：
  - `pnpm --filter @nekusora/core exec vitest run src/lib/web-search/provider-freshness.test.ts src/lib/web-search/registry.test.ts src/lib/web-search/service.test.ts`
- 运行项目质量门槛：
  - `pnpm check`
  - `pnpm test`
  - `pnpm build`
  - `git diff --check`
- 若全量命令被其他未提交任务影响，保留完整失败输出并区分本任务回归与既有工作树问题，不修改无关文件。

## 4. 独立复核

- 按 PRD/设计逐项核对请求字段、时间边界、密钥脱敏、旧配置兼容和回退行为。
- 检查本任务 diff 只包含 Exa Provider、注册点、设置入口、文案、测试和任务档案；不包含数据库迁移、依赖变化、`public-http.ts` 或 Markdown/link-preview 改动。
- 确认没有启动遗留服务、临时导出、密钥或本地调试产物。

## 风险点与回滚点

- `apps/web/messages/en.json`、`zh-CN.json` 当前已有其他任务改动，必须做局部补丁并检查最终 JSON。
- Provider enum 同时存在于 core registry 和 Server Action schema，任何漏改会造成配置无法保存或读取。
- 已保存 Exa 配置后回滚旧版本存在严格 enum 不兼容风险；发布前若要求可回滚，需在回滚流程先清理 Exa 配置项。
- 不通过增加抽象解决单个 Provider；若未来第三个 Provider 重复同一日期/内容请求结构，再单独评估提取共享逻辑。
