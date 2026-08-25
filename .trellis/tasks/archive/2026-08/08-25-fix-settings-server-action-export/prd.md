# 修复设置页 Server Action 非法导出

## Goal

恢复管理端设置页的 Server Action 加载，使设置页提交请求不再因非法模块导出返回 500。

## Background

- `apps/web/src/app/(dash)/admin/settings/settings-control-actions.ts:1` 使用了模块级 `"use server"`。
- 同一文件在第 30 行导出了普通对象 `INITIAL_SETTINGS_CONTROL_ACTION_STATE`，违反 Next.js 对该类模块只能导出异步函数的约束。
- `createSettingsRollback` 本身是异步函数；堆栈指向它是生成的 Server Action 加载器在模块求值阶段暴露错误，并非该函数返回了对象。

## Requirements

- 保留现有设置应用、放弃草稿和创建回滚的业务行为与函数签名。
- Server Action 模块不得继续暴露普通对象运行时导出。
- `INITIAL_SETTINGS_CONTROL_ACTION_STATE` 的值保持 `{ status: "idle", code: null }`，现有客户端和测试继续复用同一份定义。
- 仅修改修复该模块边界所需的文件，不调整设置中心 UI 或其他 Server Action。

## Out of Scope

- 设置中心交互或视觉改版。
- 重构其他 Server Action 文件。
- 修改设置变更、回滚或缓存失效业务逻辑。

## Acceptance Criteria

- [x] 设置页不再因 `settings-control-actions.ts` 的非异步导出触发 `invalid-use-server-value`。
- [x] `settings-control-actions.ts` 的运行时导出全部为异步函数。
- [x] 设置控制相关单元测试通过，初始状态及三项操作的既有行为不变。
- [x] TypeScript/静态检查未发现更新引用造成的导入或类型错误。

## Notes

- 本任务范围小、边界明确，采用 PRD-only 轻量流程。
- 未发现更早会话对该导出另有约定；当前证据以源码和 Next.js 运行时错误为准。
