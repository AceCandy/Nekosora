# 修复前端已确认技术债

## Goal

修复 Modal、ImageStudio 和文本预览的已确认问题

## Requirements

- Modal 使用现有标题作为可访问名称，只有无标题弹窗才使用显式 `ariaLabel`。
- Modal 关闭按钮使用现有 `common.close` 翻译，不硬编码语言。
- ImageStudio 在模型 props 更新后不得继续使用空或已失效 model id。
- ImageStudio 历史加载只保留一个实现，组件卸载时取消首屏请求，生成后刷新不得被过期响应覆盖。
- PreviewText 在 URL 变化或组件卸载时取消旧 fetch，保持 512 KiB 有界预览行为。
- 不引入新状态库、请求库或 UI 依赖。

## Acceptance Criteria

- [x] 所有现有 Modal 调用都有可访问名称，关闭按钮随 locale 翻译。
- [x] ImageStudio 始终使用当前 `models` 中有效的 model id；无模型时保持现有空状态。
- [x] 历史和文本预览请求在清理时触发 abort，AbortError 不显示为用户错误。
- [x] 相关 Web 单测、lint、typecheck 通过。

## Notes

- 复用 React 派生值、`AbortController` 和 next-intl；不增加抽象层。
