# 增加浏览器离线预检

## Goal

当浏览器明确报告离线时，立即阻止聊天流和附件上传请求，以一致、可恢复的状态反馈替代必然失败的网络请求。

## Background

- `chatStreamStore` 的发送、重新生成、编辑重发和续写分别直接请求 `/api/chat`。
- `useChatAttachments` 直接请求 `/api/upload`，失败后把附件置为 error。
- `Sidebar` 已有 `navigator.onLine` 单点预检，但项目没有共享网络状态或通用 API client。
- 其他 Client fetch 还包括 Image Studio、文件预览和链接预览；本任务不扩展为全站离线框架。

## Requirements

- R1：提供一个 SSR 安全的纯函数，以 `navigator.onLine === false` 作为“明确离线”；没有 `navigator` 或状态未知时视为可尝试请求。
- R2：聊天发送、重新生成、编辑重发、续写和附件上传在调用 `fetch` 前统一执行预检。
- R3：复用该纯函数替换 Sidebar 的本地判断，避免出现第四份离线判定。
- R4：离线失败使用稳定错误标识和 next-intl 用户文案；不得伪装成服务端、协议或模型错误。
- R5：离线拒绝必须收敛现有 optimistic 状态：不残留 spinner，不消费附件，不追加伪 assistant 错误正文，并允许在线后手动重试。
- R6：保留现有 AbortController、真实网络失败和 SSE 中断处理；`navigator.onLine === true` 不代表网络可达。

## Acceptance Criteria

- [ ] 浏览器明确离线时，聊天四个入口和附件上传均不调用 `fetch`。
- [ ] 新会话离线发送不会创建会话或乐观侧栏项，既有会话不会追加持久消息。
- [ ] 离线附件进入可重试错误态；恢复在线后再次发送能够重新上传。
- [ ] 离线重试、编辑重发和续写不破坏原消息或版本树，streaming 最终为 false。
- [ ] SSR、测试环境或缺少 `navigator.onLine` 时不误判离线。
- [ ] Sidebar 使用同一判定函数，现有分页失败状态保持不变。
- [ ] 定向测试断言 `fetch` 和前置 Server Action 未被调用，并覆盖恢复在线后的成功路径和状态清理。

## Out of Scope

- 通用 Server Actions、Image Studio、文件预览、链接预览和服务端 Provider 请求。
- Service Worker、PWA 缓存、自动排队、自动重放或“在线”探活。
- 全局在线状态 Store 或新增网络请求依赖。
