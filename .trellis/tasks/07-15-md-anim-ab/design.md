# Design — Markdown 逐 token 动画 A/B 验证

## 方案总览

单一变量隔离 harness:固定代表性 markdown → mock 流式(本地 rAF 逐字 append,每帧一次,复现 store 合批语义)→ 喂给真实 `<Markdown>` → 页面内 rAF 采样 FPS → URL `?anim=on|off` 切换动画 → on/off 各跑对比。

## 涉及文件

1. **`src/shared/components/markdown/Markdown.tsx`**(改):加 optional prop `streamAnimation?: "auto" | "on" | "off"`,默认 `"auto"`(=现状零影响)。`animated` 行据 prop 计算:
   - `auto`:现状(`isStreaming ? { fadeIn, char, stagger:30 } : false`)
   - `on`:流式时强制开
   - `off`:流式时强制 `false`
2. **`src/app/anim-ab/page.tsx`**(新建,临时):harness 页。
   - 常量 `SAMPLE_MD`(代表性长文本)。
   - `useMockStream(text, charsPerFrame)`:每 rAF append N 字到 `content`,模拟 store「每帧一次」合批;结束置 `isStreaming=false`。
   - `useFpsSampler(active)`:rAF 记帧时间戳,输出 `{ avgFps, minFps, dropped(>20ms), totalMs }`。
   - 读 `searchParams.anim`,传 `streamAnimation`。
   - UI:开始/重置按钮、速率(`charsPerFrame`)滑块、实时 FPS、结束统计、on/off 对照表。

## 数据流

```
SAMPLE_MD ──(useMockStream 每 rAF append)──▶ content
content ──▶ <Markdown content isStreaming streamAnimation=on|off> ──▶ streamdown 重解析 + 动画
rAF ──▶ useFpsSampler 采帧 ──▶ FPS 面板 / 统计
```

## 路由可裸跑性

`src/app/anim-ab/` 须不被 auth middleware 拦截、不触发 server DB 调用(纯前端)。implement 第一步实测;若被拦,fallback 见下。

## 关键设计取舍

- **改 Markdown 加 prop,而非 harness 直接用 `<Streamdown>`**:为测真实渲染路径(含 `STREAMDOWN_COMPONENTS` / `MARKDOWN_CONTROLS` / `.nekusora-md` 样式),隔离的是「动画」这一个变量,不是「整个 Markdown 封装」。prop 默认 `auto` 不影响生产。
- **mock 而非真实模型**:可复现、无网络噪声、不依赖 key/DB。animated 开销正比于「每帧重渲染 DOM 节点数 × 动画字符数」,固定文本能覆盖该变量。
- **掉帧阈值 20ms**(≈50fps):肉眼可感卡顿的下限。

## 兼容性 / 回滚

- `streamAnimation` prop 可选、默认 `auto`,对现有所有 `<Markdown>` 调用零影响。
- 验证后按结论处理:
  - 「关闭」→ 改默认 `animated={false}`,删 prop 与 harness。
  - 「调参」→ 改 stagger 常量,删 prop 与 harness。
  - 「保留」→ 仅删 prop 与 harness,`Markdown.tsx` 回到原样。
- harness 页 `src/app/anim-ab/` 整目录删除。

## Fallback

- 若 `src/app/anim-ab/` 被 middleware/auth 拦截或触发 DB:优先临时跳过该路由认证(本地);不行则把 harness 设为完全 self-contained(不依赖 app layout 的 provider)。
- 若浏览器自动化无法触发/截图:页面自跑自显示统计表,人工触发 + 手动截图读数。
