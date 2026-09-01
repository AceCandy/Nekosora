# 管理员重置用户密码：技术设计

## Boundary

本功能只扩展 `/admin/users` 账号管理页：新增一个行级 Client Component 和一个 Server Action。继续复用现有 Better Auth、管理员守卫和共享 UI 原语，不增加数据库表、依赖、邮件流程或跨页面状态。

## Data Flow

```text
UsersPage(Server Component)
  -> 非当前用户的“重置密码”按钮
  -> ResetPasswordButton(Client Component)
  -> resetUserPassword(Server Action)
  -> requireAdmin()
  -> zod 校验 userId/newPassword/confirmPassword
  -> 拒绝当前管理员重置自己
  -> auth.api.setUserPassword(..., request headers)
  -> auth.api.revokeUserSessions(..., same request headers)
  -> 结果码回到当前 Modal 的 aria-live 状态区
```

## Contracts

### Server Action

- 输入：绑定的目标 `userId`，以及包含 `newPassword`、`confirmPassword` 的 `FormData`。
- 鉴权顺序：先 `requireAdmin()`，再解析并使用客户端输入；任何 Better Auth 副作用前完成自重置限制和输入校验。
- 密码长度与现有认证配置对齐为 8–128 位，不 trim 密码。
- 两次密码必须一致。
- 通过当前请求 `headers` 调用 Better Auth，保留 admin 插件的权限校验。
- 只返回稳定状态码，不把 Better Auth 原始错误或密码带回客户端。

结果分支：

| 状态码 | 含义 |
| --- | --- |
| `success` | 密码更新且现有会话全部撤销 |
| `invalidPassword` | 密码缺失或长度不在 8–128 位 |
| `passwordMismatch` | 两次输入不一致 |
| `selfResetForbidden` | 当前管理员尝试通过列表重置自己 |
| `resetFailed` | Better Auth 未能更新目标用户密码 |
| `sessionRevokeFailed` | 密码已更新，但目标用户会话撤销失败 |

### Non-atomic Failure

Better Auth 1.6.23 的设密与撤销会话是两个独立接口，无法组成数据库事务。执行顺序为先设密、后撤销会话：只有两步都成功才返回 `success`。第二步失败时返回 `sessionRevokeFailed`，保留表单输入并要求管理员立即重试；不尝试恢复旧密码，因为旧密码不可得且回滚会扩大安全风险。

### UI

- 在现有操作单元格中，与删除按钮并列放置钥匙图标按钮；当前登录管理员不渲染该入口。
- 点击后打开共享 `Modal`，显示目标用户名、两个受控密码输入框和取消/提交按钮。
- 输入框使用 `type="password"`、`autoComplete="new-password"`、`minLength=8`、`maxLength=128`，首个输入获得初始焦点。
- pending 时禁用输入和提交，阻止重复请求；错误留在 Modal 内并使用 `role="alert"`，成功使用 `role="status"`。
- 完整成功后清空密码字段并保留明确成功反馈；关闭后卸载表单以清除局部敏感状态。
- 不增加密码强度计、随机密码生成器、复制按钮或 Toast。

## Files

- `apps/web/src/app/(dash)/admin/actions.ts`：Server Action 与边界校验。
- `apps/web/src/app/(dash)/admin/actions.test.ts`：鉴权、输入、调用顺序和失败分支。
- `apps/web/src/app/(dash)/admin/users/ResetPasswordButton.tsx`：按钮、Modal 和提交状态。
- `apps/web/src/app/(dash)/admin/users/ResetPasswordButton.test.tsx`：表单结构与双语文案目录断言。
- `apps/web/src/app/(dash)/admin/users/page.tsx`：挂载行级入口。
- `apps/web/messages/zh-CN.json`、`apps/web/messages/en.json`：用户可见文案。

## Compatibility And Rollback

- 无数据库迁移；OAuth/credential 账号结构继续由 Better Auth 管理。
- `setUserPassword` 会在目标用户没有 credential account 时创建凭据，符合“管理员设置新密码”的语义。
- 回滚只需撤销上述代码和文案；已重置的密码与已撤销会话属于用户触发后的预期持久化结果，代码回滚不会恢复它们。

## Risks

- 部分失败无法原子回滚；通过独立结果码、准确文案和可重试路径降低风险。
- 静态组件测试不能覆盖原生 `<dialog>` 的真实焦点与提交行为，因此实现后必须做浏览器级验证。
