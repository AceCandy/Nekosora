# src/features — 业务域切片(feature-sliced)

每个子目录是一个**业务域**(domain),内部自包含该域的全部前端资产:

```
features/<domain>/
  ├── components/   # 该域的 UI 组件(可按 sections / shared 再分)
  ├── hooks/        # 该域的业务 hooks
  ├── model/        # 纯逻辑/类型/计算(无 React 依赖)
  ├── context/      # 该域的 React Context
  └── types/        # 该域的类型定义
```

## 边界规则

- **域间禁止横向 import**:features/chat 不应直接 import features/admin。跨域共享逻辑放 `src/shared/`。
- **域可 import shared**:任何 features/* 都可 import `@shared/ui/*` 和 `@shared/lib/*`。
- **app 路由层是组装层**:`src/app/<route>/page.tsx` 负责 Next.js 路由装配,业务从 `@features/<domain>` 引入。

## 当前状态(渐进迁移中)

| 域 | 状态 | 说明 |
|---|---|---|
| chat | 🚧 待迁移 (I-07a) | 业务逻辑仍在 src/app/chat/ |
| admin | 🚧 待迁移 | 业务逻辑在 src/app/admin/ |
| panel | 🚧 待迁移 | 业务逻辑在 src/app/panel/ |
| providers | 🚧 待迁移 (I-13) | 组件在 src/components/providers/ |
| models | 🚧 待迁移 (I-13) | 组件在 src/components/models/ |
| artifacts | 🚧 待迁移 (I-13) | 组件在 src/components/artifacts/ |

迁移完成后 `src/components/` 将被移除。
