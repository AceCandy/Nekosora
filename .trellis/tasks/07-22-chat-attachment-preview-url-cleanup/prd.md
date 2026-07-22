# 回收聊天附件预览 URL

## Goal

确保聊天图片附件创建的本地 blob preview URL 在手动移除或 Composer 卸载时及时释放，避免长会话、频繁切换会话造成浏览器内存累积。

## Background

- `useChatAttachments` 为图片调用 `URL.createObjectURL(file)`。
- 已消费附件会 revoke，但 `removeAttachment` 只过滤 state，组件卸载也没有 cleanup。
- 仓库其他 object URL 调用点均有显式 revoke。

## Requirements

- R1：创建 preview URL 时立即登记到未释放 URL Set；附件离开 state 后由 effect revoke 并从 Set 删除。
- R2：hook 卸载时 revoke Set 中仍保留的所有 preview URL。
- R3：state updater 必须保持纯函数；同步 effect 只回收“不在当前 active URL 集合”的资源，不能清理仍在展示的 URL。
- R4：保持上传、消费回调、错误项保留和 UI 行为不变。

## Acceptance Criteria

- [x] AC1：源码复核证明 `removeAttachment(id)` 只移除目标，effect 只 revoke 不再 active 的 URL。
- [x] AC2：源码复核证明 unmount cleanup 遍历未释放 URL Set 并清空。
- [x] AC3：rg 证明聊天附件所有 createObjectURL 生命周期都有消费、手动移除或卸载回收路径。
- [x] AC4：lint、typecheck、全量测试、生产构建与 `git diff --check` 通过。

## Out Of Scope

- 删除服务器存储对象。
- 引入 DOM/hook 测试依赖。
- 改变附件预览样式或交互。
