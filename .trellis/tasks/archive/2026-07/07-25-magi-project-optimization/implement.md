# MAGI 三脑项目优化：首轮实施计划

## 1. 审视基线

- [x] 确认分支 `opt0725` 基于 `496432b`。
- [x] 定位多工具消息序列：`src/lib/stream.ts:849`。
- [x] 定位网关取消信号断点：`src/app/v1/chat/completions/route.ts:98`、`:106`、`:149`、`:165`。
- [x] 确认基线 lint、类型检查及 531 个测试通过。

## 2. 执行：多工具调用

- [x] 在 `src/lib/stream-agent-loop.test.ts` 增加两个工具调用的失败回归测试，断言第二轮 `streamText` 请求的完整消息序列。
- [x] 最小修改 `streamChatWithTools`：执行时收集 tool 消息，循环后一次追加聚合 assistant 消息与全部 tool 消息。
- [x] 运行 `pnpm exec vitest run src/lib/stream-agent-loop.test.ts`。

## 3. 执行：网关取消

- [x] 新增 `src/app/v1/chat/completions/route.test.ts`，从 `POST` 公开入口创建流式响应并取消 body，断言 `abortSignal.aborted`。
- [x] 测试同时监测取消后的异步收尾没有未处理异常或多余写入。
- [x] 最小修改 `streamResponse`：透传信号，并按取消状态保护终态写入与 close。
- [x] 运行 `pnpm exec vitest run src/app/v1/chat/completions/route.test.ts`。

## 4. 提升：独立复核与质量门

- [x] 独立复核两个 diff，检查单工具、工具失败、正常 SSE 与错误 SSE 的兼容性。
- [x] 运行两个相关测试文件的组合测试。
- [x] 运行 `pnpm lint` 与 `pnpm exec tsc --noEmit --pretty false`。
- [x] 不默认运行全量构建；本轮没有依赖、Next 配置或产物链路变化。如定向验证暴露跨模块风险，再说明原因并请求批准。
- [x] 记录已验证项、未验证项、剩余风险与下一轮候选。

## 5. 回滚点

- 多工具改动可恢复为 `src/lib/stream.ts` 原消息追加块，并删除对应新增测试。
- 网关取消改动可独立恢复 `streamResponse` 原控制流，并删除新增 route 测试。

## 6. 验证记录

- RED：多工具用例仅新增测试失败，证明第二轮消息被拆成两组 assistant/tool。
- RED：取消测试证明 `streamChat` 未收到 signal；控制器边界随后证明取消后仍尝试写 `[DONE]` 与错误帧。
- RED：UA 等待竞态证明取消后仍会启动 `streamChat`。
- GREEN：`pnpm exec vitest run src/lib/stream-agent-loop.test.ts src/app/v1/chat/completions/route.test.ts`，2 个文件 14 个测试通过。
- 质量门：`pnpm lint`、`pnpm typecheck`、`pnpm test` 全通过；全量为 61 个文件、536 个测试。
- 独立复核：无阻断发现；确认工具消息顺序、取消传播与正常/异常 SSE 兼容性。
- 未验证：未运行 `pnpm build`，因为没有依赖、Next 配置或构建链路变化。
- 剩余风险：取消发生在 `streamChat` 内部路由数据库查询期间时，查询本身不能被 AbortSignal 中断；查询结束后信号会继续传到 AI SDK，上游生成不会持续。
- 下一轮候选：稳定消息 key、新会话侧栏刷新、非流式错误 HTTP 状态、多模态压缩输入，按影响与证据重新审视后选择。
