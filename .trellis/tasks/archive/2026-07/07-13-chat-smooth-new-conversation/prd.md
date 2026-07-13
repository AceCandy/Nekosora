# 新会话发消息丝滑进入会话页(静默换URL)

## Goal

新会话发送首条消息后，URL 平滑切换到 `/chat/{id}`，消除当前「先跳首页(欢迎态闪烁)再进入会话页」的割裂感，对齐 GPT / Claude / DEEIX-Chat 的丝滑体验。

## Background

- 现状链路：新会话发消息 → `chatStreamStore.send` 创建会话 → `migrate(NEW_CONVERSATION_KEY → newId)` 删除临时键 → `router.replace('/chat/{id}')` 触发 `/chat/[id]` server component 重新查库加载。
- 根因：`migrate` 已清空 `/chat` 组件订阅的键，而 `router.replace` 触发的 RSC 重载有延迟；这段窗口里 `/chat` 的 `ChatComposer` 订阅到空 → 闪现欢迎态(看起来像"首页")→ 新组件挂载后才恢复。
- 三因素叠加：「靠路由切换重挂组件来衔接 store key」+「migrate 提前删 key」+「server component 加载延迟」。

## Requirements

- 新会话建会后用 `window.history.replaceState` 静默换 URL，**不触发** Next.js RSC 重载。
- `ChatComposer` 不重挂载：输入框、模型选择、滚动位置等本地状态连续保留。
- 消息流连续，无空态/欢迎态闪烁。
- `ChatComposer` 持有可变「活动会话 id」，建会后切换订阅键；后续切换模型/参数/推理/输出模式等能持久化到正确会话。
- 兼容性不变：直接访问/刷新 `/chat/{id}` 仍正常加载历史；分享链接 `/chat/[id]` 结构不变。
- 既有路由导航不受影响:侧栏「新对话」、点击历史会话、regenerate、edit、停止生成等。

## Acceptance Criteria

- [ ] 新会话发首条消息:URL 立即变为 `/chat/{id}`，全程无欢迎态闪烁。
- [ ] user 消息与 assistant 流式内容连续显示,不中断。
- [ ] 建会后切换模型/推理/输出模式/参数等,能正确持久化到新建会话(DB 落库可查)。
- [ ] 刷新当前页(URL 已是 `/chat/{id}`)能正确加载完整历史。
- [ ] 浏览器后退按钮不会退回一个空的、带残留的新会话页(replace 不入历史栈)。
- [ ] 历史会话切换、regenerate、edit、停止生成等既有流程行为不变。
- [ ] 侧栏「新对话」按钮仍能进入干净的新会话页(无上一轮残留消息)。
- [ ] `pnpm lint && pnpm typecheck` 通过。

## Out of Scope

- 需求 1(工具栏顺序调整)、需求 2(新会话推理强度缺失)单独处理,不在本任务。需求 2 根因已定位:`src/app/chat/page.tsx:19-24` models 映射漏 `capabilities` 字段,导致新会话页 `ReasoningPicker` 拿不到 `capabilities.reasoning` 直接 `return null`;留待后续任务。
- 不做单页化重构(方案 C)。

## Notes

- 参考实现(同栈 Next.js):`docs/cankao/DEEIX-Chat/frontend/features/chat/hooks/use-chat-message-submit.ts:639-641`,`window.history.replaceState(null, "", '/chat?conversation_id=...')`,注释明说「Update the URL without triggering Next.js RSC navigation, which can interrupt an active stream」。
- SPA 版同理:`docs/cankao/AMC-WebUI/src/stores/sessionRouteSync.ts` 用 History API 静默同步。
- 本项目已具备全局 `chatStreamStore` + `migrate` 机制,架构上支持「不切路由也能保持消息显示」,只差衔接方式。
