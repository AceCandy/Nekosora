# src/shared — 跨域共享层

跨特性复用的 UI、布局与工具。`features/*` 与 `app/*` 可按 Server/Client 边界引用。

```
shared/
  ├── ui/    # 原子 UI 组件(Button/Input/Modal/Badge/Select/StatusDot/ConfirmDialog)
  ├── components/ # AppShell、导航、markdown、文件预览等复合组件
  └── lib/   # 格式化、剪贴板工具、通用 hook（useClickOutside）
```

## 放入条件

- **ui/**:不含任何业务领域词汇(不出现 "chat"/"model"/"provider" 等),纯表现层组件。
- **components/**:跨特性复用的布局或复合呈现，不承载单一业务域的流程。
- **lib/**:通用工具与 hook；浏览器 API、React hook 必须遵守调用侧运行环境，不能假定都是无副作用纯函数。

含业务语义的组件/逻辑应放 `src/features/<domain>/`,不要污染 shared。
