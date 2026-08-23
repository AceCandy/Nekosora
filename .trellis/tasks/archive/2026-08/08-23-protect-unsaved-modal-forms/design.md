# 保护弹窗未保存表单：技术设计

## 边界

- 保留 `apps/web/src/shared/ui/Modal.tsx` 现有关闭契约：遮罩、Esc、X 和原生 close 统一调用 `onClose`。
- 在业务表单与 `Modal` 之间增加共享未保存关闭守卫，不让 `Modal` 推测 children 是否为持久化表单。
- 仅接入 PRD R1 列出的 9 类表单；`ShareDialog` 保留现有业务快照实现。

## 共享契约

新增 `apps/web/src/shared/ui/UnsavedChangesDialog.tsx`，同一文件导出：

- `useUnsavedChanges<T extends HTMLElement>(onClose)`：返回内容根节点 callback ref、`requestClose` 和确认弹窗状态/回调。
- `UnsavedChangesDialog`：基于现有 `ConfirmDialog`，使用 `common` 命名空间的共享文案渲染“继续编辑/放弃修改”。

调用方仍保留现有真正关闭函数（如 `handleClose`）：

- `Modal.onClose` 和取消按钮改用 `requestClose`。
- 保存成功、确认添加或确认重命名继续调用原关闭函数，不经 dirty 拦截。
- 用户确认放弃时，守卫调用原关闭函数，复用各组件现有卸载/重置逻辑。

## 快照算法

内容根节点挂载时，守卫查询其中的 `input, select, textarea`，生成有序快照：

- 普通 input/textarea/select：记录标签、类型和当前 `value`。
- checkbox/radio：额外记录 `checked`。
- multiple select：记录全部已选 option 值。
- submit/reset/button 不进入快照。

关闭请求时重新生成快照并与基线比较。按 DOM 顺序比较可同时覆盖：

- 有/无 `name` 的控件。
- React 受控与 `defaultValue`/`defaultChecked` 非受控控件。
- 条件渲染导致的字段增删。
- 修改后再恢复基线值的情况。

callback ref 在每次内容根节点重新挂载时采集新基线，利用现有 `Modal open=false` 卸载内容的特性，不增加 effect 或额外基线 key。

## 接入点

| 业务 | 内容根 | 真正关闭路径 |
| --- | --- | --- |
| 指令卡 | 字段内容容器 | `onClose` |
| 模型 | `<form>` | `handleClose` |
| 路由 | `<form>` | `handleClose` |
| 供应商 | `<form>` | `handleClose` |
| 密钥备注 | 弹窗内容容器 | 清空 `noteDialog` |
| 密钥批量添加 | 弹窗内容容器 | 关闭 `batchOpen` 并清空草稿 |
| 输出模式 | `<form>` | `handleClose` |
| 渲染样式 | `<form>` | `handleClose` |
| 会话重命名 | `<form>` | 清空 `renameTarget` |

## 国际化

在 `messages/zh-CN.json` 和 `messages/en.json` 的 `common` 命名空间增加 4 个对齐键：

- `unsavedChangesTitle`
- `unsavedChangesMessage`
- `discardChanges`
- `continueEditing`

## 测试

- 为共享守卫增加单测，覆盖 clean 直接关闭、dirty 拦截、改回基线、继续编辑和确认放弃。
- 增加共享 `Modal` 的关闭入口契约测试，确认遮罩、Esc、X 都调用同一 `onClose`。
- 保留并运行 `ShareDialog` 现有 dirty 回归测试。
- 使用类型检查和独立人工审查确认 9 类表单的所有关闭入口已改走 `requestClose`。

## 兼容性与风险

- 无数据库、API、路由或共享 `Modal` props 变更。
- 原生 `<dialog>` 叠层行为保持不变；密钥备注/批量确认继续作为供应商弹窗上方的独立 `ConfirmDialog`。
- 快照只读取本地 DOM 表单控件，表单规模很小，关闭时线性扫描的成本可忽略。
- 主要风险是遗漏某个取消/关闭入口；通过文件清单复核和共享契约测试控制。

## 回滚

回滚时删除共享守卫与新国际化键，并将 9 类表单的 `Modal.onClose`/取消处理恢复为原关闭函数；不涉及数据回滚。
