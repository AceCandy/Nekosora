# PDF Worker 静态资源设计

## Resource Flow

```text
pdfjs-dist/build/pdf.worker.min.mjs
        |
        | pnpm install -> postinstall
        v
public/pdfjs/pdf.worker.min.mjs
        |
        | Next static serving
        v
/pdfjs/pdf.worker.min.mjs -> PreviewPdf
```

## Decisions

- 复用 `sync-pdfjs-assets.cjs`，因为 CMap 和字体已经通过同一机制保证本地、Docker、CI 一致。
- 不使用第三方 CDN，避免预览依赖外网、版本漂移和 CSP 问题。
- 不使用以 `window.location.origin` 为 base 的包内路径，因为浏览器不会从 `node_modules` 解析包名。
- worker 是安装生成物，继续由 `.gitignore` 排除，不提交第三方构建产物。

## Compatibility And Rollback

- 组件接口、PDF 渲染参数和 API 均不变。
- `postinstall` 仍以警告降级，不因可选 PDF 资源缺失阻断安装。
- 回滚只涉及同步脚本和 `PreviewPdf.tsx`，无数据迁移。
