# 实施计划

1. 建立共享时间规则
   - 在 chat model 中新增纯日期判断/格式化函数。
   - 补首条今天/非今天、同日/跨日、昨天/前天、今年/跨年、显式时区和无效输入测试。

2. 贯通 Chat 时间字段
   - 扩展 `ChatMessage` 可选 ISO `createdAt`。
   - 历史会话 DTO 映射数据库时间。
   - 在 `/api/chat` 为新 user/assistant 使用稳定服务端创建时间，并通过现有身份 SSE 帧透传。
   - 更新 SSE parser 和 chat store 的 send/regenerate/edit/continue 路径，保留或回填正确时间。
   - 更新相关 route、SSE 和 store 测试。

3. 渲染 Chat 时间分隔
   - 新增 SSR 安全的 `MessageTimeSeparator`。
   - 在 `ChatMessageList` 对每条当前可见消息传入相邻时间，不改变 `MessageScroller.Item`、anchor 或消息 key 语义。

4. 贯通并渲染分享时间
   - 扩展分享快照类型、snapshot/live 投影和公开 DTO 的可选 ISO 时间。
   - 旧 snapshot 缺失时间时保持正文可读且不回查。
   - 在公开分享消息列表复用同一时间分隔组件。
   - 保留工作树中 `ReadonlyChatMessage` 的用户气泡右对齐改动及现有测试。

5. 验证与独立复核
   - 先运行与时间 helper、SSE、store、share action 和相关组件直接对应的 Vitest 测试。
   - 运行 `pnpm check`；根据改动风险运行 `pnpm test`，不执行无关 Java 全量编译。
   - 使用浏览器检查 Chat 与公开分享的本地时区展示、响应式、亮暗主题、滚动与 hydration 控制台。
   - 若为验证启动服务，完成后关闭本次启动的进程；不停止用户已有服务。
   - 加载 `trellis-check` 做独立复核，确认规范、类型、测试和现有未提交改动均未被覆盖。

## Risk Points

- `ChatMessageList` 的 MessageScroller 子项/anchor 结构不能改变。
- assistant 新建与 continue 更新必须区分，续写不得重置原消息创建时间。
- 分享 snapshot JSON 是兼容边界，新字段必须可选。
- 客户端本地时区只能在 hydration 后可靠取得，必须避免服务端时区格式化和 hydration mismatch。
- 当前工作树含分享弹窗、只读消息气泡和 i18n 的用户改动，实施时仅做必要的增量编辑。

## Rollback

移除时间分隔组件、共享 helper 和各 DTO/SSE 的可选字段即可恢复原展示；数据库无需回滚，已有快照 JSON 中的额外字段可被忽略。
