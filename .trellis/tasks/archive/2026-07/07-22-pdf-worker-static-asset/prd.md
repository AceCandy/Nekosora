# 修复 PDF worker 静态资源加载

## Goal

确保 PDF 预览使用的 pdf.js worker 在本地、Docker 和 CI 安装后都由应用同源静态提供，消除当前 worker URL 404 导致的 PDF 渲染失败。

## Background

- `PreviewPdf.tsx` 当前把 worker 指向 `/pdfjs-dist/build/pdf.worker.min.mjs`。
- 本地 Next 15.5.20 运行时实测该 URL 返回 404；同一服务下 `/pdfjs/cmaps/...` 与 `/pdfjs/standard_fonts/...` 返回 200。
- `sync-pdfjs-assets.cjs` 已在 `postinstall` 同步 CMap 与标准字体，但没有复制 worker 文件。

## Requirements

- R1：`postinstall` 从当前安装的 `pdfjs-dist/build/pdf.worker.min.mjs` 同步 worker 到 `public/pdfjs/`。
- R2：`PreviewPdf` 使用稳定的同源静态 URL，不依赖 CDN 或运行时暴露 `node_modules`。
- R3：保留 CMap、标准字体同步和“同步失败不阻断 install”的既有策略。
- R4：补齐 `PreviewPdf` effect 的 `t` 依赖，避免 locale 更新时闭包继续使用旧翻译函数。
- R5：不修改 PDF 渲染策略、缩放、样式或其他文件预览组件。
- R6：worker 作为 `postinstall` 生成的第三方产物必须被精确忽略，不提交到仓库。

## Acceptance Criteria

- [x] AC1：运行同步脚本后，`public/pdfjs/pdf.worker.min.mjs` 存在且与当前依赖 worker 内容一致。
- [x] AC2：本地 Next 服务请求 `/pdfjs/pdf.worker.min.mjs` 返回 200 和 JavaScript 内容类型。
- [x] AC3：旧的 `/pdfjs-dist/build/pdf.worker.min.mjs` 引用从源码中消失。
- [x] AC4：lint 不再报告 `PreviewPdf.tsx` 的 Hook 依赖 warning，且没有新增 warning/error。
- [x] AC5：typecheck、全量测试、`git diff --check` 通过。
- [x] AC6：调试服务在验收后关闭，端口无残留监听。

## Out of Scope

- 文本预览 Range 请求与 512KB 截断。
- PDF 分页懒加载、渲染性能或视觉样式调整。
- 修改上传大小限制或文件下载 API。
