# 实施计划

1. 为 `chatStreamStore.send` hooks 增加消费回调，在成功 response 边界调用。
2. 新增 store 回归测试：成功、非 2xx、SSE 失败三条时序。
3. 将附件 hook 的未使用全量 reset 改为只消费 uploaded 项，并释放对应 preview URL。
4. 由 `useChatRuntime` 透传，在 ChatComposer 绑定消费动作。
5. 运行目标测试、lint、typecheck，独立复核成功/失败边界。
6. 运行全量测试、生产构建与 `git diff --check`，更新 frontend 状态契约规范。
