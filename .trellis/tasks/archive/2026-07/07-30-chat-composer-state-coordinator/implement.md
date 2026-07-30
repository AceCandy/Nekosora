# Chat Composer State Coordinator Execution Plan

## Phase 0: Baseline And Characterization

- [ ] 锁定 clean worktree，记录 ChatComposer 七类选择、六条持久化入口、SSR 初始化、新会话 create/adopt 和 send/ask/edit 路径。
- [ ] 运行 conversations、chatStreamStore、ChatInputBox、reasoning 现有定向测试，保存重构前基线。
- [ ] 先写会失败的 characterization tests：card/KB 交错 payload、同选项快速开关、JSON reasoning/card 丢失更新和 A/B 状态复用。
- Gate：失败原因必须对应现有竞态，不用实现细节构造伪红灯。

## Phase 1: Pure State And Writer Contracts

- [x] 新增 ComposerSelectionState、initial snapshot builder 与纯 reducer，覆盖全部七类选择。
- [x] 新增同步 snapshot ref/adapter，证明连续 dispatch 后 send 可在重新 render 前读取最新组合。
- [x] 实现每实例 single-flight、latest-only writer，覆盖 deferred promise 下的合并、顺序、失败、retry 和旧 callback fencing。
- [x] 实现 draft scope adoption：create snapshot 相同时不补写，创建期间有新变化时采用 ID 后只写最新快照。
- Gate：纯单测能确定性证明任意 promise 完成顺序下最终写入等于最后 snapshot。

## Phase 2: Atomic Server Action

- [x] 定义完整 persisted snapshot DTO 与 zod 边界校验，保留属主隔离。
- [x] 用一次 conversations UPDATE 写 modelName、outputModeId、renderStyleId、webSearch 和完整 composerState。
- [x] 扩展 conversations tests：合法完整快照、null/空数组、非法输入、非属主、一次 UPDATE 和无预读 JSON。
- [x] 搜索并迁移六条旧 Composer setter 的全部调用方；确认无调用后删除旧 exports。
- Gate：不存在 composerState read-modify-write 或字段级 fire-and-forget Action。

## Phase 3: React Coordinator Integration

- [x] 新增局部 coordinator hook，把 reducer、同步 snapshot、writer、scope adopt 与 sync status 接入 React 生命周期。
- [x] ChatComposer 删除七组分散 selection state/updater 和 useTransition persistence，所有 picker handler 只 dispatch 领域 transition。
- [x] send 与 selection ask 从一次 coordinator snapshot 派生参数；edit/regenerate/continue 保持消息模型语义。
- [x] 扩展内部 `/api/chat` body，显式发送 outputModeId 与 clamped reasoning；route 校验后优先使用 body，缺省才回退数据库。
- [x] 新会话创建回调同时更新 runtime active ID 与 coordinator scope，处理 create 期间追加变化。
- [x] `chat/[id]/page.tsx` 用 conversation ID key 显式隔离 A/B；空白 `/chat` 继续使用默认 snapshot。
- Gate：删除任一旧 closure persistence 逻辑后无 selection 行为缺口。

## Phase 4: Failure UX And Component Tests

- [x] 在现有输入框 top content 错误区增加独立 sync error，使用本地化“未同步”与重试命令、role=alert 和现有图标/token。
- [x] 失败时保持选择，retry/后续 transition 只写最新 snapshot；成功只清 sync error，不误清 send error。
- [x] 新增 ChatComposer 交互测试，覆盖 card+KB 交错、快速双 toggle、send/ask snapshot、失败重试和 per-model reasoning。
- [x] 扩展 route/store tests，覆盖 null/off 显式值、非法 snapshot 字段、body 优先、旧请求 DB fallback 与公开 `/v1/*` 无变化。
- [x] 覆盖 A pending callback 与 B component state 隔离、新会话默认/创建/adopt 连续性。
- Gate：Toolbar/ChatInputBox props、键盘与移动端结构无无关变化。

## Phase 5: Quality, Browser And Spec Review

- [x] 运行定向 tests、lint、typecheck、全量 tests 与 build。
- [ ] 启动临时 dev server，用桌面与 390px 移动视口验证选择、失败/重试、A/B、新会话和发送；检查无重叠、无横向溢出、错误可读可操作，完成后关闭本次服务。
- [x] 更新 frontend state-management/hook spec 与 backend chat generation spec，记录 Composer single-writer、完整快照、请求优先级和 draft adopt 契约。
- [x] 独立复核 reducer/writer、Server Action/属主边界、组件生命周期、交互/无障碍、隐私和 scope drift。
- [x] 检查 diff、git status、临时文件、日志和本地缓存；确认无旧 setter、diff 空白错误或遗留调试服务。
- [x] 提交前展示 commit plan 并获得用户批准。

## Validation Commands

```bash
pnpm exec vitest run \
  src/features/chat/model/composerState.test.ts \
  src/features/chat/model/composerPersistence.test.ts \
  src/features/chat/actions/conversations.test.ts \
  src/features/chat/components/ChatComposer.test.tsx \
  src/features/chat/store/chatStreamStore.test.ts \
  src/app/api/chat/route.test.ts \
  src/lib/reasoning.test.ts
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

浏览器验证使用临时端口；若已有其他窗口服务，不停止他人进程，只关闭本任务启动的 PID。

## Verification Record

- 定向 Vitest：6 个测试文件，53/53 用例通过；writer/store/component 复测 3 个文件，35/35 用例通过。
- 全量 Vitest：117 个文件通过、2 个文件跳过；978 个用例通过、17 个用例跳过。
- `pnpm lint`、`pnpm typecheck`、`pnpm build` 均通过；build 完成 19 个静态页面并生成 `.next/BUILD_ID`。
- 独立静态复核覆盖 coordinator/writer、完整快照 Action、route/store 请求契约、A/B scope 隔离、失败重试与无障碍状态，未发现当前业务链路的确定性缺陷。
- 未验证：认证后的聊天页桌面与 390px 浏览器交互回归。临时服务只能进入登录页，公开默认账号认证失败；未读取或创建本地凭据，浏览器会话与本任务服务均已关闭。
- 历史证据缺口：未保留可审计的重构前测试命令输出和 red-first 执行顺序，因此 Phase 0 的对应过程项不事后勾选；当前自动化结果只能证明重构后状态。
- 剩余风险：真实浏览器中的选择、失败/重试、A/B 导航、新会话 create/adopt 及移动端布局尚未完成认证后回归；多标签页并发仲裁仍按 PRD 保持在范围外。

## Rollback Points

- Phase 1 只新增纯模块和测试，可无数据影响回滚。
- Phase 2/3 必须在同一产品提交中完成，禁止保留新旧 Action 双写。
- 无数据库迁移；若完整快照 Action 不能覆盖既有语义，回滚产品提交，不写兼容字段。
