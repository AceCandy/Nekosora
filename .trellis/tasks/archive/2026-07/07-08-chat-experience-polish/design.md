# 聊天体验打磨 · 技术设计

## 子项一：空闲态停止多余轮询

**根因**：侧栏组件（`Sidebar`）的会话状态轮询 effect 无条件每 6 秒调用一次 `getGeneratingStatusesAction`（server action + DB 查询），只要侧栏挂载就永不停歇。该轮询的唯一目的是检测「后台会话生成完成」并给蓝点提示，而会话列表 props 本身已携带 SSR 的 `generating` 字段。

**方案**：以「是否存在 generating 中会话」作为轮询开关。
- 派生 `hasGenerating = conversations.some(c => c.generating)`。
- 轮询 effect 改为依赖 `hasGenerating`：为 true 时才启动 6 秒轮询；为 false 时直接不轮询（并清空上一轮 generating 集合 ref）。
- 轮询发现某后台会话由 generating 变为完成时，在标记蓝点之余调用 `router.refresh()`，让 SSR 会话列表的 generating 字段同步 → `hasGenerating` 转为 false → effect 自然 cleanup、轮询停止。
- 当本轮查询结果已无任何 generating 会话时，同样 refresh 以同步状态。
- 侧栏需引入 `useRouter`（当前未引入）。

**自洽性**：当前会话开始生成时，`useChatRuntime` 的 streaming 翻转 refresh 已把 generating 同步进 SSR 列表，从而驱动 `hasGenerating=true`、轮询启动；当前会话与后台会话的完成检测都被覆盖。

**次要来源处理**：`useChatRuntime` 的 streaming 翻转 refresh、`ChatComposer` 的版本信息批量拉取，均非「空闲持续」源，保留不动。

## 子项二：流式中保留历史消息复制按钮

**根因**：消息项组件（`ChatMessageItem`）的 assistant 操作栏（版本切换 + 复制 + 重新生成 + 续写）整体渲染条件含 `!isStreaming`，而此处 `isStreaming` 是会话级流式标志——会话生成时，所有 assistant 消息（含历史轮次）的操作栏被整体隐藏。

**方案**：区分「正在生成的最后一条」与「历史消息」。
- 操作栏容器渲染条件由 `!isStreaming` 改为 `!(isStreaming && isLast)`：正在生成的最末条隐藏整个操作栏；历史消息或非流式时显示容器。
- 容器内保留「只读浏览类」操作——复制按钮、版本切换始终保留；会话流式期间仅隐藏「会触发生成」的操作（重新生成、续写），二者各加 `!isStreaming` 条件。
- 用户消息的编辑/删除按钮（条件含会话级 streaming）不在本次范围（用户未提及）。

## 子项三：回到最新按钮按需展示

**根因**：按钮显隐条件为 `!isAtBottom`，而 `isAtBottom` 用窄阈值（距底 < 24px）且仅在滚动事件中更新——既太严格（必须几乎贴底按钮才消失），又在流式状态转换（流结束、底部缓冲 `h-32→h-0`、虚拟滚动动态测量）未触发滚动事件时残留 false，导致「在最新对话时按钮仍显示」。

**方案**：分离「跟随」与「按钮」两套阈值。
- 跟随保持窄阈值（`isAtBottom`，距底 < 24px）不变——用户稍微上滑即停止跟随，避免流式输出抢回滚动。
- 新增宽阈值 `isNearBottom`（距底 ≤ 视口高度的 1/3）专供按钮：距底 ≤ 1/3 屏视为「在最新附近」、按钮隐藏；距底 > 1/3 屏才显示按钮。
- 在「消息变化跟随」effect 中 `scrollIntoView` 后用 `requestAnimationFrame` 重算并同步 `isAtBottom`/`isNearBottom`（等虚拟滚动测量稳定），校正流式后的状态残留。
- 消息列表按钮条件由 `!isAtBottom` 改为 `!isNearBottom`。

**不确定点**：流式结束（streaming 变、messages 不变）的边界场景，依赖浏览器 scrollTop clamp 触发滚动事件链路；实现后实测。宽阈值（1/3 屏）本身已大幅兜底测量误差。

## 子项四：流式生成时下方留白

**根因**：流式生成时底部缓冲固定为 `h-32`（约 128px），生成内容几乎贴近视口底部，缺少 Claude / GPT 式「内容停上部、下方留白跟随」的呼吸感。用户期望历史会话中发起一轮新对话时，生成内容下方预留约 2/3 屏空白。

**方案**：把流式时的底部缓冲由固定 `h-32` 改为相对滚动容器的 `h-2/3`（约 2/3 屏）。缓冲 div 同时是 `scrollIntoView` 的滚动锚点，撑高后生成内容自然停在视口上部、下方留出约 2/3 屏空白；流式结束缓冲收为 `h-0`，内容恢复正常贴底阅读。空态欢迎页不在本子项范围。

## 子项五：历史会话打开即贴底

**根因**：消息列表用 `@tanstack/react-virtual` 虚拟滚动，`estimateSize: () => 200` 为初始估计值。历史会话挂载时 `measureElement` 异步测量尚未收敛、`getTotalSize()` 偏小，而滚动控制器的消息变化 effect 在挂载瞬间仅做一次 `scrollIntoView`——此时底部锚点（`messagesEndRef`）落在偏小的总高度处，视口停在内容中部而非底部。

**方案**：在 `useChatScrollController` 增加挂载期（空依赖）稳定循环：用 `requestAnimationFrame` 反复执行 `el.scrollTop = el.scrollHeight` **无条件**贴底——不读 `isAtBottomRef`，因为同一挂载周期内「消息变化 effect」的 rAF 会在虚拟测量未完成时把 `isAtBottomRef` 误判为 `false`，若读取它循环会空转、不贴底。初始加载本就要到底，故无条件拉底，直到 `scrollHeight` 连续多帧不变或超时收敛，收敛后把贴底态（`isAtBottomRef` / `isNearBottom`）写回。会话切换令组件重挂 → 循环重跑；流式追加不触发挂载 effect，仍由既有消息变化 effect 单次跟随。

## 子项六：刷新历史会话不闪欢迎页

**根因**：`useChatRuntime` 的 `messages` 直接取自全局 `chatStreamStore`（`s.runtimes[key]?.messages`）。服务端渲染与客户端首屏时 store 尚未 `hydrate`、`messages` 为空 → 渲染空态（欢迎页）；客户端 `useEffect` 挂载后才 `hydrate(key, initialMessages)` 注入 → 闪一下才出现历史消息。

**方案**：`messages` 在 store 无该会话切片时回落到 SSR 注入的 `initialMessages`。SSR 与首屏直接用 `initialMessages` 渲染历史消息，`hydrate` 后无缝切到 store 数据。原为空态兜底引入的 `EMPTY_MESSAGES` 常量随之移除。

## 子项七：对话大纲摘要单行

**根因**：大纲浮层每项用户原话用 `line-clamp-2`（最多两行），用户希望每轮只占一行。**方案**：改为 `line-clamp-1`。

## 子项八：思考块点击展开 / 收起 + 动效

**根因**：思考条触发区 `flex-1` 撑满整行宽度，折叠箭头（`ChevronRight`）置于触发区**之外**且被推到行末 → 箭头远离左侧「已思考 N 秒」文字，且中间大段空白落在 hover 触发区内，鼠标移到空白处也会误触展开。展开仅由 hover 驱动、立即出现 / 消失，无过渡，手感僵硬。

**方案**：
- 触发区去掉 `flex-1`、改为 `inline-flex` 只包内容；`ChevronRight` 移入触发区内紧跟文字（位于吐字区之后）。
- 三种触发并存、共用一个 `reasoningPanelOpen`：① 点击触发区立即 toggle；② hover 进入 / 离开各延迟 0.5s 再展开 / 收起（用 `hoverTimerRef` 计时，点击与 hover 互不抢断，延迟避免鼠标划过误触）；③ 展开时监听 `document.mousedown`，点击触发区（含浮层，由 `reasoningRef` 包裹）以外任意位置即收起。弹层关闭按钮 `stopPropagation` 防冒泡触发外层 toggle。
- 弹层加进入动效（淡入 + 下滑 + 微缩放），展开不再瞬时僵硬。

## 子项九：对话大纲高亮当前轮次

**根因**：大纲仅静态展示所有轮次（横线列 + hover 浮层），无「当前正在看哪一轮」的定位标记，长会话里难以判断滚动位置。

**方案**：`ChatMessageList` 借虚拟项（`rowVirtualizer.getVirtualItems()`）算出「首个底边越过 `scrollTop` 的可见项 index」= 当前视口顶部对应的 msg index，传入 `ChatOutline`。`ChatOutline` 把它映射到所属轮次（向后找最近的 user 消息）：横线列该轮加长（`w-6`）+ 蓝色（`bg-sora-blue/70`）、hover 浮层该轮项加浅蓝底色（`bg-sora-blue/[0.10]`）+ 加粗，随滚动实时跟随。优先级：流式生成中（最末轮）> 当前轮 > hover。

## 不在本次范围
- `useChatRuntime` 的 streaming 翻转 refresh（功能合理，保留）。
- `ChatComposer` 版本信息批量拉取的批量化（一次性爆发、非持续；如需优化另开任务）。
- 用户消息编辑/删除按钮的流式可见性。

## 风险
- 子项一：`hasGenerating` 依赖 SSR 会话列表准确反映 generating；若 SSR 快照滞后，轮询启停可能短暂抖动（可接受，最坏退化为接近原行为但不再持续空转）。
- 子项三：根因为推断，虚拟滚动 × 贴底判定交互复杂，须实测验证。
