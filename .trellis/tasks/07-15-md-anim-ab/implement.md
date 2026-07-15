# Implement — Markdown 逐 token 动画 A/B 验证

## 执行清单

1. **可裸跑性探针** → 新建空 `src/app/anim-ab/page.tsx`,启动 `pnpm dev`,浏览器访问该路由能裸跑(无 auth 跳转、无 DB 报错)。失败走 design 的 fallback。 → verify:页面 200 返回
2. **加 streamAnimation prop** → 改 `Markdown.tsx`:加 prop + 改 `animated` 行。 → verify:`pnpm check` 通过;默认 `auto` 下现有调用行为不变
3. **写 harness** → `src/app/anim-ab/page.tsx`:`SAMPLE_MD` + `useMockStream` + `useFpsSampler` + on/off 切换 UI + 统计对照。 → verify:能跑完整流式,FPS 面板有数字
4. **采集 on 组** → `?anim=on`,固定速率,跑 ≥ 3 次,记录 avg/min FPS、掉帧、耗时(取中位数)。
5. **采集 off 组** → `?anim=off`,同文本同速率,跑 ≥ 3 次,记录。
6. **出结论** → 对比数据,判定 保留/关闭/调参;若调参给推荐 stagger。
7. **应用结论** → 按结论改 `Markdown.tsx`(默认 animated/stagger,或保持),移除实验 prop。
8. **清理** → 删 `src/app/anim-ab/`;确认 `Markdown.tsx` 无实验残留。
9. **沉淀** → 结论写进 `.trellis/spec/`(frontend,markdown/流式渲染相关)。
10. **收尾验证** → `pnpm check`;git diff 确认只剩结论驱动的正式改动。

## 验证命令

- `pnpm check`(lint + typecheck)
- `pnpm dev` + 浏览器访问 `/anim-ab?anim=on|off`

## Review Gates

- 步骤 1 后:harness 能裸跑(否则走 fallback,可能影响方案)。
- 步骤 6 后:结论明确且有数据支撑,再决定步骤 7 的正式改动。

## 回滚点

- prop 默认 `auto`,任何阶段删 harness + prop 即回到原状。
- 步骤 7 若改默认值,git 可直接 revert 单文件。
