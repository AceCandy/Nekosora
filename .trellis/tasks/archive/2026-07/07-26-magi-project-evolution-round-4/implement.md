# Implementation Plan

1. 更新 `share.test.ts`，用失败测试约束客户端顺序、隐藏兄弟排除和无效集合不写库。
2. 修改 `createShare` 签名与集合校验，保留请求顺序写入两个快照字段。
3. 同步 `ChatHeader`、`ChatComposer` 与两个 page wrapper 的参数签名；不可完整分享时禁用按钮。
4. 运行分享定向测试与 typecheck，修正跨层签名遗漏。
5. 独立复核权限边界、部分匹配、排序、流式/缺 ID 状态和历史读取兼容性。
6. 运行 lint、typecheck、全量测试、生产构建与 `git diff --check`。
7. 更新分享/消息引用规范与 PRD 验收状态，提交工作改动，再归档任务并记录 journal。

## Validation Commands

- `pnpm exec vitest run src/features/chat/actions/share.test.ts`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `git diff --check`

## Risky Files And Rollback Points

- `src/features/chat/actions/share.ts`：权限与全集匹配的核心边界；任何无效 ID 都必须在 insert 前失败。
- `src/features/chat/components/ChatComposer.tsx`：必须从当前 runtime 派生顺序，不能退回 SSR 初始消息。
- `src/features/chat/components/ChatHeader.tsx` 与 page wrapper：签名必须全链路一致。
- 无迁移；若跨层签名无法稳定通过 typecheck，整体回滚本轮文件即可。
