# 实施计划

1. 更新主聊天时间上下文为每轮必注入，并补当前时间与搜索相对时间规则。
2. 收紧搜索词重写和 `web_search` 工具说明，禁止推断年份范围。
3. 将 Hosted Search 的动态时间语义统一到 `Asia/Shanghai`。
4. 修正 mem0 ADD-only 相关代码注释与后端规范。
5. 更新定向单测，运行相关 Vitest 与 `git diff --check`。

## 预期改动文件

- `packages/core/src/lib/chat/orchestrator.ts` 与测试：主聊天动态时间上下文。
- `packages/core/src/lib/chat/completion-coordinator.ts` 与测试：工具参数语义。
- `packages/core/src/lib/web-search/query-rewrite.ts` 与测试：搜索词时间提示。
- `packages/core/src/lib/web-search/hosted-model.ts` 与测试：Hosted Search 上海时区时间。
- `packages/core/src/lib/memory/extract.ts`、`.trellis/spec/backend/memory-system.md`：修正 mem0 行为描述。

## 验证

- 运行上述模块的定向 Vitest。
- 运行 `git diff --check`。
- 按项目 Java 规则不涉及 Java，也不执行无关全量编译。
