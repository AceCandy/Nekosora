# 优化 Chat 输出样式切换性能

## Goal

降低 Chat 切换「输出样式」时的同步渲染范围，让样式选择控件优先反馈，避免与输出样式无关的用户消息参与重渲染，并让超长会话的历史 assistant 回复渐进切换 CSS 与 renderer；消息高度变化时保持当前可见消息及其视口内偏移，同时保持最终渲染结果和会话持久化行为不变。

## Background

- `ChatComposer` 当前把活动样式的 `cssClass` 与 `renderer` 传给 `ChatMessageList`。
- `ChatMessageList` 再把两个值传给每个 `ChatMessageItem`，样式变化会击穿默认浅比较的 `React.memo`。
- assistant 的 `Markdown` 需要根据 renderer 切换 Streamdown/custom；`renderStyleClass` 在 Markdown 内仅用于识别内置 `paper` 的代码块表现。
- 输出样式 CSS 已由 Chat layout 聚合注入，切换时不需要重新获取 CSS。
- 项目规范明确禁止消息虚拟化，现有 MessageScroller 依赖普通列表维持流式跟随、锚点和滚动记忆。

## Requirements

1. 输出样式的 `rs-*` class 恢复挂在既有 assistant 正文容器，与该条消息的 renderer/paper 语义同批更新；禁止在整段历史祖先一次切换 class。
2. Chat 工具栏继续使用即时选择状态；消息正文使用同一个延迟后的样式对象派生 cssClass、renderer 与 paper 标记，避免同一消息内 class/renderer 短暂错配。
3. user 消息不接收会随输出样式变化的 renderer、paper 或 class props。
4. assistant 在 renderer 改变时仍正确切换 Streamdown/custom；`paper` 特有代码块行为保持不变。
5. 不改变输出样式的会话持久化时机、数据库契约和流式消息行为；样式批次导致高度变化时，以首个可见消息及其相对视口顶部偏移作为逻辑锚点，底部跟随仍交给 MessageScroller。
6. 修改保持在 Chat 展示链路内，不引入新依赖、缓存层、虚拟列表或新配置项。
7. 默认与纸面杂志切换时，当前可视 assistant 优先使用目标 CSS/renderer，屏幕外 assistant 分批收敛；连续快速切换必须取消旧批次，不能让旧选择覆盖最新选择。初次打开会话直接使用已保存样式，不触发渐进换肤。

## Acceptance Criteria

- [x] 切换两个 renderer 相同的样式时，assistant 的 `rs-*` class 仍按可视优先、屏外分批更新，Markdown 不因 cssClass 变化重渲染。
- [x] 切换 renderer 时，所有 assistant 回复仍使用所选 renderer；流式中的 custom 样式仍沿用既有 Streamdown 行为。
- [x] 切换到或离开 `paper` 时，paper 专属代码块表现仍能正确更新。
- [x] user 消息收到的输出样式相关 props 始终为空，不因样式切换失效 memo。
- [x] 工具栏选中状态不等待历史消息树完成换肤后才反馈；延迟阶段 class、renderer 与 paper 标记来自同一份样式对象。
- [x] 现有 ChatComposer、ChatMessageItem、Markdown 相关回归测试通过，并新增一个最小测试锁定样式 props 的传递边界。
- [x] 针对改动文件的 lint/type-check 无新增错误。
- [x] 超长会话切换样式时，可视 assistant 在首批同时更新 CSS/renderer，屏幕外 assistant 分批收敛，最终全部使用最新样式。
- [x] 连续快速切换时旧批次失效；初次打开已有会话不出现二次换肤。
- [ ] 位于历史中段时来回切换样式，首个可见消息及其相对视口顶部偏移保持稳定；位于底部时仍保持 MessageScroller 自动跟随。（代码与单测已覆盖，待登录态真实长会话浏览器验收。）

## Out of Scope

- Markdown 解析结果缓存、模块级 LRU 或第三方缓存依赖。
- `content-visibility`、消息虚拟化或 MessageScroller 行为调整。
- 输出样式持久化防抖、数据库更新契约调整。
- Streamdown/Shiki 内部配置优化及输出样式 CSS 拆分加载。
- 管理端输出样式配置、公开分享渲染链路。

## Risks and Deferred Items

- `useDeferredValue` 改善交互优先级，不减少 renderer 真正变化时的总 Markdown 计算量；第二批通过可视优先、屏外分批降低单次同步工作量。
- 渐进换肤期间，屏幕外历史消息可短暂保留上一个 renderer；用户已确认接受，全部批次最终必须收敛到最新选择。
- 当前用户反馈已确认祖先 class 会造成整页同步样式重算，且分批高度变化会让禁用原生 overflow anchor 的视口漂移；CSS 与逻辑锚点必须纳入同一 rollout。
- 当前相关 Chat 文件存在用户未提交改动；实现必须基于工作树现状做小范围补丁，不覆盖或整理无关变更。
