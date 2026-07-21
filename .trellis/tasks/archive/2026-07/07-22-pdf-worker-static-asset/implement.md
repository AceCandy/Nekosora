# 实施计划

1. 保留当前运行时失败证据：旧 worker URL 404，CMap/字体控制 URL 200。
2. 修改 `sync-pdfjs-assets.cjs`，同步 worker 并在日志中报告结果。
3. 运行同步脚本，校验目标文件与依赖源文件内容一致。
4. 修改 `PreviewPdf.tsx` 使用 `/pdfjs/pdf.worker.min.mjs`，并补 effect 的 `t` 依赖。
5. 运行 `pnpm lint`、`pnpm typecheck`、`pnpm test` 和 `git diff --check`。
6. 短暂启动 Next 到空闲端口，请求新 worker URL 验证 200，随后关闭服务并确认端口释放。
7. 独立复核改动范围、生成物状态和回滚边界。
