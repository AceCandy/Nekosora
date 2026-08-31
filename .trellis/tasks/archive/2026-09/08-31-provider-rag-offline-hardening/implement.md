# 三项加固集成实施计划

## Success Gate

- 三个子任务分别通过 PRD 验收、定向测试和独立复核。
- 集成后无新增依赖、数据库迁移、敏感日志或匿名分享泄露。
- `pnpm check`、相关测试和 `git diff --check` 通过。

## Step 1: Provider

- 启动并完成 `08-31-upstream-model-list-hardening`。
- 核对 admin/panel 均继续走共享 `fetchUpstreamModels`，失败保持旧缓存。

## Step 2: Offline

- 启动并完成 `08-31-offline-request-preflight`。
- 核对四个聊天动作、附件上传和 Sidebar 使用同一纯判定，且 Server Action 之前拒绝。

## Step 3: RAG

- 启动并完成 `08-31-rag-structured-sources`。
- 核对实时 SSE、最终快照、刷新/版本切换和私有预览共用同一来源契约。
- 用带敏感 sentinel 的分享测试确认匿名响应完全排除来源。

## Step 4: Integration Review

1. 运行三个子任务的定向测试。
2. 运行 `pnpm check` 和 `pnpm test`。
3. 运行 `git diff --check`，检查无迁移、依赖、临时文件和敏感信息。
4. 独立复核三个失败边界互不覆盖：Provider 缓存、离线状态、RAG 分享隐私。

## Rollback

- 每个子任务独立回滚；父任务没有直接业务代码。
- 若 RAG UI 回滚，保留可忽略的 JSON 可选字段不会影响旧客户端。
- 若离线误判，回滚纯函数调用即可恢复原网络行为，不涉及持久数据修复。
