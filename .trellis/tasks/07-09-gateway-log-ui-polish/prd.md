# 网关日志UI打磨与布局统一

## Goal

上一任务（gateway-log-overhaul）完成双表日志后的展示层打磨：时间时区、路由列收敛、key 命中双字段、耗时自适应格式、token 拆分、admin 全部页内容铺满。

## Background

双表日志功能上线后用户反馈：

- 日志时间比东八区**晚 8 小时**（显示成 UTC）。
- 路由相关列冗余（provider / route / upstreamModel 三列重复信息）。
- 缺「命中哪个 key」信息。
- 耗时裸 `1234ms` 不友好；token 只显示 `prompt+completion` 合计，缺缓存读取。
- admin 所有页面 `max-w-5xl`，大屏右侧大片留白。

## Requirements

### R1. 时间跟随浏览器时区
日志时间在用户浏览器正确显示本地时区（不再晚 8 小时）。排查 `createdAt` 序列化 / 存储时区根因，确保 SSR + hydrate 后显示浏览器本地时间。

### R2. 路由列收敛
用量明细表去掉 provider / route / upstreamModel 三列冗余，合并为单一「路由」列 = `服务商·上游模型`；model 列显示对外名。

### R3. key 命中双字段（都展示）
- **上游 provider key**：前3后3中间 `*`（如 `sk-abc***xyz`），写入快照（运行时持明文，不存库）。
- **对外网关 key**：用 `apiKeys.name`（JOIN 取）。

### R4. 耗时自适应格式
`>1s → 1.2s`、`>60s → 2.3m`、`>60m → 1.2h`。latency 与 TTFT 都用。

### R5. token 拆分
输入(prompt) / 输出(completion) / 缓存读取(cacheRead) 三列（替代现在的 prompt+completion 合计）。

### R6. admin 全部页内容铺满
去掉各 admin 页 `max-w-5xl` 限制，内容填满 AppShell 内容区。

## Constraints

- 不破坏上一任务的双表 / 分流 / 数据层脱敏。
- key 脱敏不泄露明文（前3后3，中间 `*`）。
- **panel 用户端错误视图仍脱敏**：key 字段对 panel 隐藏（admin 才见）。
- 双 dialect 对齐（新增 schema 字段 pg/sqlite 同步）。
- DESIGN.md 合规（莫兰迪 / 零影子 / 无彩色粗条）。

## Out of Scope

- panel 页铺满（本期仅 admin）。
- apiKeys 加 keySuffix 字段（上游 key 用前3后3 `*` 从明文算，不存后缀）。

## Acceptance Criteria

- [ ] 时间在浏览器正确显示本地时区（不再晚 8 小时）
- [ ] 用量明细表路由收敛为「服务商·上游模型」单列，无冗余
- [ ] 日志展示上游 key（前3后3 `*`）+ 用户 key name 两个字段
- [ ] 耗时自适应格式（ms/s/m/h），latency 与 TTFT 都生效
- [ ] token 显示输入 / 输出 / 缓存读取三列
- [ ] admin 各页内容铺满（无 max-w-5xl 留白）
- [ ] panel 错误视图仍脱敏（key 等敏感字段不下发）
- [ ] `pnpm check` + `pnpm test` 通过
