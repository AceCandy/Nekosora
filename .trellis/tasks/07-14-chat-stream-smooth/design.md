# Design — 聊天流式渲染丝滑化与跟随滚动

## 方案总览（三层，解耦）

```
上游 token（可能逐字 / 大块 / 同步整段）
        │
        ▼
[层1] store delta 合批（chatStreamStore）        ← 解决 R1：每帧最多 set 一次
        │  content(真相) 每帧更新一次
        ▼
[层2] streamdown animated + caret（Markdown.tsx） ← 解决 R2/R5：复用第三方逐字淡入 + 光标
        │  每帧增量以 fadeIn 逐字展现
        ▼
[层3] pinned 滚动跟随（useChatScrollController）  ← 解决 R3/R4：用户意图驱动贴底
```

**核心取舍：不自写 pacing/typewriter 引擎。** 调研发现 `streamdown` 已内置 `animated`(`AnimateOptions`: `animation`/`sep:word|char`/`stagger`/`duration`) + `caret:block|circle`，正是"逐字淡入流式展现 + 光标"的能力。自写引擎是重复造轮子且更重。正确顺序是 **先合批（让 `content` 每帧只变一次），再启用 streamdown animated**——animated 会对每帧的增量做 stagger 淡入，从而无论上游是逐字、大块还是同步整段，UI 都是匀速流出。

---

## 层1 · store delta 合批（R1）

**文件**：`src/features/chat/store/chatStreamStore.ts`

**问题**：`appendToMessageAt`(send) 与 `regenerate`/`editAndResend`/`continueGeneration` 三处内联 `onDelta`，每个 delta 都 `[...r.messages]` 整组替换 + `set`。中文逐字流 = 每秒几十次 setState。

**设计**：模块级合批缓冲，rAF flush。

```ts
// 模块级（client 域，"use client" 内）
type DeltaField = "content" | "reasoning";
const deltaBuffer = new Map<string, { key: string; idx: number; field: DeltaField; text: string }>();
let flushRaf = 0;

/** 累积一条增量，调度下一帧 flush。上游多高频都只累积不 set。 */
function enqueueDelta(key, idx, field, text) {
  const k = `${key}:${idx}:${field}`;
  const ex = deltaBuffer.get(k);
  if (ex) ex.text += text; else deltaBuffer.set(k, { key, idx, field, text });
  if (flushRaf) return;
  flushRaf = requestAnimationFrame(flushDeltas);
}

/** 每帧最多一次：把所有积压增量按 key 合并，单次 set 写回各 runtime。 */
function flushDeltas() {
  flushRaf = 0;
  if (!deltaBuffer.size) return;
  const entries = [...deltaBuffer.values()];
  deltaBuffer.clear();
  set((s) => {
    let next = s.runtimes;
    let changed = false;
    for (const d of entries) {
      const rt = next[d.key];
      if (!rt || d.idx < 0 || d.idx >= rt.messages.length) continue;
      const copy = [...rt.messages];
      const m = copy[d.idx];
      copy[d.idx] = { ...m, [d.field]: (m[d.field] ?? "") + d.text };
      if (!changed) { next = { ...next, [d.key]: { ...rt, messages: copy } }; changed = true; }
      else next = { ...next, [d.key]: { ...next[d.key], messages: copy } };
    }
    return changed ? { runtimes: next } : s;
  });
}

/** 同步强制 flush：流式结束/中断前调用，避免最后一帧积压丢失。 */
function flushDeltasNow() {
  if (flushRaf) { cancelAnimationFrame(flushRaf); flushRaf = 0; }
  flushDeltas();
}
```

四处 `onDelta`/`onReasoning` 改调 `enqueueDelta`；`send`/`regenerate`/`editAndResend`/`continueGeneration` 的 `finally` 块在置 `streaming:false` 前调 `flushDeltasNow()`。

**为何放 store 层而非 SSE 层**：合批的是「写状态」，与解析无关；放 store 内可被所有入口（send/regenerate/edit/continue）统一复用，且 `finally` 能精准兜底 flush。

**多会话隔离**：buffer 以 `key:idx:field` 为键，天然支持多会话并行流式。

**结果**：`content`（真相）每帧最多更新一次 → ChatComposer 每帧最多重渲染一次（而非每 token）。这是层2 animated 能流畅的前提。

---

## 层2 · streamdown animated + caret（R2/R5）

**文件**：`src/shared/components/markdown/Markdown.tsx`

**现状**：`MarkdownImpl` 只传 `mode/allowedTags/components/controls`，未启用 `animated`/`caret` → 流式内容"直接出现"，无淡入无光标。

**设计**：streaming 时启用 animated + caret。

```tsx
<Streamdown
  mode={isStreaming ? "streaming" : "static"}
  animated={isStreaming ? { animation: "fadeIn", sep: "char", stagger: 推荐值 } : false}
  caret={isStreaming ? "block" : undefined}
  allowedTags={ALLOWED_HTML_TAGS}
  components={STREAMDOWN_COMPONENTS}
  controls={MARKDOWN_CONTROLS}
>
  {content}
</Streamdown>
```

- 流式结束（`isStreaming=false`）→ `animated=false`、无 caret、`mode="static"`，与现状一致。
- 参数（`sep`/`stagger`/`duration`）**留实测调参**：目标——逐字流时手感跟手、大块/同步到达时不瞬现且能在 ~1s 内追上完整内容。
- `custom` 渲染器路径不受影响（流式中始终走 streamdown，见 `Markdown.tsx` 现有 `useCustom = renderer==="custom" && !isStreaming`）。

### ⚠️ 关键假设（implement 第一步必须实测验证）

1. streamdown `animated` **仅对内容增量做 stagger 淡入**，而非每次 re-render 对全量重做（否则高频会闪烁/卡顿）。
2. 配合层1「每帧一次 set」时，性能可接受（60fps 稳定）。
3. content 一次性从 `""` 跳到大段（同步响应）时，`sep:char + stagger` 能呈现"逐字流出"而非整段瞬现。

**Fallback（假设不成立时）**：在 `ChatMessageItem` 加轻量 `useStreamPacing(content, isStreaming)` hook——`useRef` 存 `displayed`，rAF 每帧按自适应步长（差距小→1~3 字；差距大→按比例加速）向 `content` 推进，流结束 snap 到全量；Markdown 渲染 `displayed`。`displayed` 是纯视觉派生，不进 store（切会话再切回直接 snap 到真相，不重播）。此 fallback 不影响层1/层3。

---

## 层3 · pinned 滚动跟随重构（R3/R4）

**文件**：`src/features/chat/hooks/useChatScrollController.ts`

**问题（根因3/4）**：`isAtBottomRef` 完全由 `measureBottom()` 翻转；虚拟滚动 `measureElement` 异步 → `scrollIntoView` 滚不到位 → `measureBottom` false → 永久停跟随。且无用户/程序滚动区分。

**设计**：改为 **`pinned`（用户意图）驱动**，跟随用直接赋值替代 `scrollIntoView`。

### pinned 语义

- `pinnedRef`（默认 true）= "用户想贴底跟随"。
- **只由用户主动操作翻 false**，程序滚动不翻：
  - `wheel` 且 `deltaY<0`（上滑）且当前不在底部阈值 → `pinnedRef=false`
  - `touchstart`/`touchmove`：标记触摸中；`touchend` 后若离开底部 → `pinnedRef=false`
  - `keydown`：`ArrowUp`/`PageUp`/`Home` 且不在底部 → `pinnedRef=false`
- **回到 true**：`onScroll` 里 `measureBottom()` 为真（滚回底部阈值内）→ `pinnedRef=true`；或用户点「回到最新」/发新消息（`forceFollow`）。

### 跟随实现（对齐 spec「流式高频用瞬时」）

去掉原 effect 里的 `endRef.scrollIntoView`，改为直接赋值，且只在 pinned 时执行：

```ts
// effect 仍依赖 [messages]（层1后每帧变一次=60fps）
useEffect(() => {
  const el = scrollRef.current;
  if (el && pinnedRef.current) {
    el.scrollTop = el.scrollHeight;  // 瞬时贴底，不用 scrollIntoView
  }
  // isNearBottom 仍延迟一帧重算（供按钮显隐）
  ...
}, [messages, ...]);
```

**为何不用 lerp 平滑插值**：层1合批 + 层2 animated 已让内容**匀速流出**，`scrollHeight` 每帧小幅平滑增长 → 每帧瞬时贴底在视觉上即平滑跟随。lerp 反而会**滞后**、追不上快速流出，且与 spec「流式高频用瞬时」冲突。

**为何 `scrollTop=scrollHeight` 比 `scrollIntoView` 可靠**：直接赋值基于 DOM 当前真实 `scrollHeight`（虚拟滚动撑高 div 的实测高度），立即贴到当前最底；下一帧内容再长再贴。`scrollIntoView` 在虚拟滚动 + measure 延迟下定位抖动、滚不到位——正是当前 bug 根源。

### 保留不变

- `smoothScrollToBottom`（easeOutCubic 280ms）：仅用于 `scrollToBottom`（点回到最新）/ `forceFollow`（发消息）这类**用户主动单次**回底，符合 spec。
- 初始挂载 `hide-until-settled`（opacity-0 收敛测量追赶 → 淡入）：保留，历史长会话打开即贴底。
- `isNearBottom`（宽阈值，按钮显隐）：保留语义。

### 事件监听

在 hook 内 `useEffect` 给 `scrollRef.current` 挂 `wheel`/`touchstart`/`touchmove`/`touchend`/`keydown`（keydown 挂 el 或 document，需判定焦点在滚动区内），卸载时移除。读取用 ref，避免闭包陈旧（遵循 hook spec）。

---

## 兼容性

- **custom 渲染器 / 输出样式**：层2 只动 streamdown 路径；custom 在 `!isStreaming` 时启用，不受影响。
- **reasoning 流**：层1 的 `enqueueDelta` 同时合批 `reasoning` 字段；reasoning 的单行横滚（`reasoningScrollRef.scrollLeft=scrollWidth`）不受影响。
- **虚拟滚动 measureElement**：streaming 消息高度随 content 增长每帧测量，与现状同；层3 直接赋值 scrollTop 不依赖 measure 完成。
- **多会话并行**：层1 buffer 按 `key:idx:field` 隔离；层3 每个 `useChatScrollController` 实例独立 pinnedRef。
- **中断/续写/重生成/编辑重发**：均经 `finally → flushDeltasNow()`，无积压丢失；`streaming` 状态机不变。
- **SSR hydrate / hide-until-settled**：层3 保留初始收敛逻辑，首次挂载路径不变。

## 回滚形状

- 层1：还原四处 `onDelta` 为直接 `set`，删合批三函数。
- 层2：`Markdown.tsx` 删 `animated`/`caret` 传参。
- 层3：还原 `useChatScrollController` 的 `isAtBottomRef` + `scrollIntoView` effect。
三层相互独立，可单独回滚。
