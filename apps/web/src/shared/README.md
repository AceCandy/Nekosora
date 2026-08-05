# src/shared — 跨域共享层

无业务语义的通用资产,任何 `features/*` 与 `app/*` 都可安全 import。

```
shared/
  ├── ui/    # 原子 UI 组件(Button/Input/Modal/Badge/Select/StatusDot/ConfirmDialog)
  └── lib/   # 跨域纯工具函数(无 React 依赖)
```

## 放入条件

- **ui/**:不含任何业务领域词汇(不出现 "chat"/"model"/"provider" 等),纯表现层组件。
- **lib/**:无副作用的纯函数(格式化、校验、通用算法)。

含业务语义的组件/逻辑应放 `src/features/<domain>/`,不要污染 shared。
