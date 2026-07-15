# Markdown 逐 token 动画 A/B 验证

## Goal

用隔离 harness 实测 streamdown 的 `animated`(逐 token fadeIn)开关对流式渲染丝滑度的影响,以可复现的 FPS/掉帧数据给出结论:流式时应**保留**动画、**关闭**动画,还是**调参**(stagger)。

## Background

- 现状:`src/shared/components/markdown/Markdown.tsx:362` 配置 `animated={isStreaming ? { animation: "fadeIn", sep: "char", stagger: 30 } : false}`,代码注释自述「stagger/duration 手感待实测调」。
- 对比项 DEEIX-Chat 流式时 `animated=false`(关闭逐 token 动画),仅靠 50ms 节流 + circle 光标。
- 疑问:逐 token 动画在 token 高频到达时,是否因每帧字符级动画 + DOM 重渲染成为卡顿源?

## Requirements

- **单一变量**:只对比 `animated` 开/关,其余(streamdown 版本、content、流式速率、`isStreaming=true`、`caret=block`)固定。
- **可复现**:固定代表性 markdown 文本 + 固定 mock 流式速率,重跑得到同量级数据。
- **量化指标**:流式全程的 avg FPS、min FPS、掉帧次数(帧间隔 > 20ms ≈ 50fps)、流式总耗时。
- **代表性内容**:覆盖动画开销最大的结构——长段落(中英混排数千字)、大代码块(50+ 行)、多列表格、嵌套列表、标题层级。
- **降噪**:on/off 各跑 ≥ 3 次取中位数。
- **结论可执行**:明确给出「保留 / 关闭 / 调参」之一;若调参,给出推荐 stagger 值。

## Constraints / Out of Scope

- **不依赖真实模型/网络**:用本地 mock 流式(固定文本逐字 append,每帧一次,复现 store 的「每帧 content 全量重解析」语义)。真实网络抖动叠加不在本任务覆盖,结论中标注此边界。
- **只测 streamdown 渲染路径**,不涉及 customRenderer。
- **不动生产默认行为**:实验用临时开关,验证后清理;核心组件改动须可回滚、可解释。
- **不引入新生产依赖**。

## Acceptance Criteria

- [ ] harness 可在本地裸跑(不触发 DB/auth/真实模型),URL 切换 on/off 各能跑通一次完整流式。
- [ ] 产出 on/off 两组数据(avg/min FPS、掉帧数、耗时),每组 ≥ 3 次取中位数,记录在任务结果里。
- [ ] 给出明确结论:保留 / 关闭 / 调参(含推荐 stagger)。
- [ ] 临时 harness 已删除;`Markdown.tsx` 残留改动要么是结论驱动的正式调整、要么已回滚,无实验残留。
- [ ] 结论已沉淀到 `.trellis/spec/`(frontend / chat 流式渲染相关)。
- [ ] `pnpm check`(lint + typecheck)通过。

## Notes

- `prd.md` 只放需求/约束/验收;技术设计见 `design.md`,执行清单见 `implement.md`。
