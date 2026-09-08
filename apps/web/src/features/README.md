# src/features — 业务域切片(feature-sliced)

每个子目录聚合一个业务域的前端资产，按实际需要组织，简单特性可直接放组件：

```
features/<domain>/
  ├── components/   # 该域的 UI 组件(可按 sections / shared 再分)
  ├── hooks/        # 该域的业务 hooks
  ├── model/        # 类型、协议与状态逻辑
  ├── actions/      # 服务端动作
  ├── store/        # 客户端状态
  ├── context/      # 该域的 React Context
  └── types/        # 该域的类型定义
```

## 边界规则

- **域间禁止横向 import**:features/chat 不应直接 import features/admin。跨域共享逻辑放 `src/shared/`。
- **域可 import shared**:任何 features/* 都可 import `@shared/ui/*` 和 `@shared/lib/*`。
- **app 路由层是组装层**:`src/app/<route>/page.tsx` 负责 Next.js 路由装配,业务从 `@features/<domain>` 引入。

## 当前布局

`chat/` 已包含组件、hooks、actions、store、model 与 lib；`providers/`、
`models/`、`artifacts/`、`image/`、`output-modes/`、`render-styles/` 和
`web-search/` 已按特性放置。`panel/cards/` 承载指令卡组件与动作。

管理与个人面板路由/部分动作仍在 `src/app/(dash)/admin/` 和
`src/app/(dash)/panel/`；共享后端领域逻辑位于 `packages/core/src/lib/`。
