# 管理员重置用户密码：执行计划

1. 加入 Server Action 与测试
   - 在现有管理员 Action 模块内加入 zod 边界校验、`requireAdmin`/自重置守卫及 Better Auth 两步调用。
   - 扩展现有 `actions.test.ts`，覆盖未授权、自重置、无效密码、不一致、完整成功、设密失败和会话撤销失败。
   - 验证：只运行 `actions.test.ts` 对应 Vitest 用例。

2. 加入管理员页交互与文案
   - 新建同目录 `ResetPasswordButton`，复用 `Modal`、`Input`、`Button` 和 Lucide 图标。
   - 在非当前用户操作区挂载入口，同步中英文 `admin.users` 文案。
   - 添加最小静态组件测试，锁定密码字段边界、可访问标签和双语 key。
   - 验证：只运行新增组件测试。

3. 独立复核与质量验证
   - 按调用链复核：UI 隐藏不是授权边界、鉴权与校验先于副作用、仅两步成功时报完整成功、敏感值未进入日志或 URL。
   - 运行针对性测试后，运行 Web 包的 lint/typecheck；不启动全仓构建。
   - 使用浏览器验证管理员页按钮、键盘焦点、两次输入不一致、pending 锁定、成功/失败反馈及窄屏无横向溢出；若启动服务，结束前关闭。
   - 运行 Impeccable detector 检查新增 UI 反模式。

## Rollback Points

- Server Action 测试不通过：只回退 Action 与对应测试，不进入 UI 接线。
- UI 验证不通过：保留已验证的服务端 Action，修正或撤销用户页入口后重新验证。
- Better Auth 调用发生版本行为差异：停止实现，不直接写 `account.password`，重新核对锁定包源码。
