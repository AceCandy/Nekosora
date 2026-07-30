# Chat Composer Coordinator Evidence

## Current Owners

- `src/features/chat/components/ChatComposer.tsx:88-115`：model、card IDs、KB IDs、web search、output mode、render style 与 active conversation ID 是分散的 useState。
- `src/features/chat/components/ChatComposer.tsx:192-205`：reasoningByModelId 独立 state，当前档位通过 `resolveReasoningForModel` 解析。
- `src/features/chat/components/ChatComposer.tsx:214-290`：七类选择分别 set state，并启动六条独立异步持久化路径。

## Reproduced Risk Shape

- `ChatComposer.tsx:275-289`：card functional updater 组合闭包 `selectedKbIds`；KB updater 组合闭包 `selectedCardIds`。同一 React batch 内两者都能看到另一侧旧值。
- `ChatComposer.tsx:265-271`：每次组合都独立 `startTransition` 调完整 cardIds/kbIds Action，没有队列、合并或 sequence。
- `conversations.ts:269-311`：card/KB 与 reasoning 分别 select 旧 composerState 后 update；两个请求可读到同一旧值并以各自 merge 覆盖另一请求。
- 其他 model/web/output/render Action 虽写独立列，仍可因同一控件的请求乱序落到旧值。

## Send And Create Flow

- `ChatComposer.tsx:162-190`：send/ask 从多个 render closure 读取 model/cards/KB/web/output/render/reasoning。
- `src/app/api/chat/route.ts:354-381`：card/KB/web 来自 body，但 outputModeId 与 reasoning 来自会话行；异步持久化失败时会混用点击快照与数据库旧值。
- `chatStreamStore.ts:413-426`：新会话首次发送把当次选择作为 create options。
- `chatStreamStore.ts:427-437` 与 `useChatRuntime.ts:118-122`：创建后先迁移 `__new__` runtime，再静默 replace URL 并回调真实 ID。
- `ChatComposer.tsx:114-115`：activeConvId 只在 mount 从 prop 初始化；新会话回调是唯一内部更新入口。

## Conversation Navigation

- `src/app/chat/[id]/page.tsx:111-130`：SSR 把会话 composer snapshot 作为 initial props 传入 ChatComposer，但没有 `key={id}`。
- ChatComposer 的 selection initial props 均只作为 useState initializer，没有 prop-change rebase。A/B 导航必须显式定义重建或 rebase，不能依赖 Next/React 是否保留同一 client instance。
- `state-management.md` 要求新会话使用 `history.replaceState` 保持流式组件不重挂，因此 null -> real ID 必须通过 coordinator adopt，而不是强制刷新。

## Persistence Shape

- `conversations.ts:142-170`：createConversation 已能写 modelName、独立选择列和 composerState JSON。
- `conversations.ts:202-212,371-403`：ConversationComposerState 已是 SSR 完整聚合 DTO。
- PostgreSQL schema `src/db/schema/pg.ts:308-322` 已有 modelName、outputModeId、renderStyleId、webSearch、composerState；本任务不需要 schema 变更。

## Test And UX Baseline

- `vitest.config.ts` 使用 Node environment；现有复杂 client component tests 用 mock React hook harness。
- `ChatComposer.tsx:424-429` 已在 ChatInputBox top content 使用 `role="alert"`、AlertCircle 与 caption error token 展示 send error，可并列承载独立 sync error。
- `messages/*` 已有通用 retry 文案，但需新增 Chat namespace 的稳定“设置未同步”文案。

## Product Decisions

- 空白 `/chat` 使用默认选择，不继承上一会话；首次发送前选择成为创建快照，采用真实 ID 后继续保留。
- 持久化失败保留最新选择，显示未同步状态；用户重试或后续选择变化只提交最新完整快照，不回滚。
- 内部 WebChat `/api/chat` 增加可选 outputModeId/reasoning snapshot；新请求显式发送，旧请求缺省回退数据库，公开 `/v1/*` 不变。

## Design Constraints

- 单个 Composer 生命周期内要求最终收敛；多标签页冲突仲裁不在本任务。
- 不引入新状态库、队列依赖、数据库 revision 或迁移。
- edit/regenerate/continue 当前使用消息自身模型，不能被当前 Composer snapshot 改写。

## Implementation Evidence

- `src/features/chat/model/composerState.ts`：`ComposerStateMachine` 通过纯 reducer 同步维护七类选择；`resolveComposerSnapshot` 继续从模型目录能力解析并 clamp 当前模型 reasoning。
- `src/features/chat/model/composerPersistence.ts`：`LatestSnapshotWriter` 实现 single-flight、latest-only pending、失败阻塞/retry、generation scope fencing 和 draft adopt；`dispose/resume` 支持 Strict Mode effect 重放。
- `src/features/chat/hooks/useComposerCoordinator.ts` 与 `ChatComposer.tsx`：所有 picker 只 dispatch transition；send/ask 在事件发生时读取 `getSnapshot()`；新会话保存创建快照并在真实 ID 回调中先 adopt、后切活动 ID。
- `src/features/chat/actions/conversations.ts`：`saveConversationComposerState` 经 zod 校验后执行单次 `UPDATE ... WHERE conversationId AND userId RETURNING id`，原子写独立列与完整 `composerState`，不再预读 JSON。
- `src/app/api/chat/route.ts` 与 `chatStreamStore.ts`：新调用显式发送 `outputModeId`/`reasoning`，显式 `null`/`off` 优先；旧调用字段缺省时回退会话数据。新会话创建携带完整 `reasoningByModelId`。
- `src/app/chat/[id]/page.tsx`：`key={id}` 明确隔离历史会话 A/B 的 Composer 生命周期；空白新会话仍通过 coordinator adopt 保持连续性。

## Verification Evidence

- 定向 Vitest：6 个文件、53/53 用例通过；writer/store/component 复测：3 个文件、35/35 用例通过。
- 全量 Vitest：117 个文件通过、2 个文件跳过；978 个用例通过、17 个用例跳过。
- `pnpm lint`、`pnpm typecheck`、`pnpm build` 均通过；build 完成 19 个静态页面并生成 `.next/BUILD_ID`。
- 独立静态复核覆盖 reducer/writer、Action 属主与原子边界、route/store 兼容、React 生命周期、交互/无障碍和隐私；未发现当前业务链路的确定性缺陷。

## Unverified And Residual Risk

- 认证后的聊天页桌面与 390px 浏览器交互未验证：临时服务只能进入登录页，公开默认账号认证失败；未读取或创建本地凭据。
- 浏览器会话与端口 3317 的本任务临时服务均已关闭，没有遗留调试进程。
- 真实浏览器中的选择、失败/重试、A/B 导航、新会话 create/adopt 和移动端布局仍有回归风险；多标签页并发仲裁按 PRD 保持在范围外。
- 未保留重构前测试命令输出或 red-first 执行顺序，不能事后补证；当前证据只证明重构后结果。
