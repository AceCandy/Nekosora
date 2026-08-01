# Chat Composer 状态协调

## Goal

为 Chat Composer 建立单一 selection transition/persistence coordinator。所有会话级生成选择都从同一快照更新、发送和持久化，使快速交错操作、失败重试、新会话创建与会话切换最终收敛到用户最后可见状态。

用户价值：快速切换模型、指令卡、知识库、联网、输出模式、输出样式或推理档位时，界面不会回跳，刷新后不会丢失另一项选择，发送请求也不会读取旧闭包。

## Confirmed Facts

- `ChatComposer.tsx:88-115,192-290` 分别持有 model、card IDs、KB IDs、web search、output mode、render style 和 per-model reasoning，并用六条独立 Server Action 路径持久化。
- `ChatComposer.tsx:275-289` 的 card updater 使用闭包中的 KB IDs，KB updater 对称使用闭包中的 card IDs；React 批处理下可生成混合新旧值的完整 payload。
- `conversations.ts:269-311` 对 `composerState` 的 card/KB 与 reasoning 分别执行读改写；并发请求可基于同一旧 JSON 互相覆盖。
- `chatStreamStore.ts:413-437` 已用首次发送快照创建会话，并把 `__new__` runtime 迁移到真实 ID；`useChatRuntime.ts:118-122` 通过 `history.replaceState` 静默采用真实 ID，不触发 RSC 重挂。
- `api/chat/route.ts:354-381` 从请求读取 card/KB/web search，却从会话行读取 outputModeId 与 reasoningByModelId；若持久化异步失败，现有请求无法保证使用点击发送时的完整 Composer 快照。
- `ChatComposer` 的初始化 props 只在首次 `useState` 执行时消费；`chat/[id]/page.tsx:111-130` 未用 conversation ID 作为 key，A/B 导航是否复用组件不能成为状态隔离的隐含前提。
- 当前 Vitest 环境是 Node，复杂组件测试使用轻量 React hook harness；纯 reducer 和持久化队列可在无浏览器环境下确定性测试。

## Requirements

- R1. modelId、cardIds、kbIds、webSearch、outputModeId、renderStyleId 与 reasoningByModelId 必须由一个显式 state/reducer 拥有。输入文本、附件、浮层显隐、消息流和 artifact panel 不进入该状态边界。
- R2. 每个 selection transition 必须同步更新一个权威 snapshot；普通发送和选区追问都读取该 snapshot，不得再从多个 render closure 或数据库旧值拼装参数。
- R3. 已有会话只通过一个完整快照 Server Action 持久化 modelName、独立列和完整 composerState。Action 必须校验属主与输入，并在一次 `UPDATE` 中原子写入，不再对 JSON 执行多条读改写。
- R4. 客户端每个 Composer 最多一个持久化请求在途；在途期间的新变化只保留最新完整快照，当前请求完成后再写最新快照。旧请求或旧回调不能覆盖更新状态。
- R5. 进入空白 `/chat` 时使用默认选择，不继承上一会话。首次发送前的本地选择作为创建快照；临时 ID 切换为真实会话 ID 时保留该选择，若创建期间又有变化，则采用 ID 后补写最新快照。
- R6. 会话 A 与 B 使用不同 coordinator 生命周期和持久化目标。A 的在途写可以完成到 A，但其响应、错误或重试不能修改 B；A/B 导航必须显式重建 Composer 状态，不能依赖框架碰巧重挂。
- R7. 持久化失败不回滚用户选择。Coordinator 保持最新 dirty snapshot，显示紧凑、可访问的“未同步”状态与重试命令；重试和后续选择变化都只提交最新快照，不记录 raw error。
- R8. reasoningByModelId 继续按 conversationId + modelId 保存；当前请求档位继续通过模型目录 capability 解析和 clamp，不退化为会话全局单值。
- R9. 现有 Toolbar/Composer 操作、键盘行为、移动端布局、附件、发送/停止与 edit/regenerate/continue 保持不变。内部 WebChat `/api/chat` 请求新增可选 `outputModeId` 与已 clamp 的 `reasoning`；新客户端必须发送，旧请求缺省时继续回退数据库。公开 `/v1/*` wire contract 不变。
- R10. 本任务不新增数据库列或迁移；继续使用 conversations 的现有 modelName、outputModeId、renderStyleId、webSearch 与 composerState 字段。

## Acceptance Criteria

- [x] card A 与 KB B 任意交错操作时，UI 与最终持久化快照均为最后可见组合；同一选项快速开关也不被旧请求覆盖。
- [x] 模型、联网、输出模式、输出样式、card、KB 和 per-model reasoning 全部通过同一 reducer 与单写队列，没有旧独立持久化路径。
- [x] 服务端一次原子 `UPDATE` 写入完整 Composer 快照，属主失败和非法输入均不写库；card/KB/reasoning 不再发生 JSON 丢失更新。
- [x] 持久化失败时选择保持不变并显示可访问错误；重试或后续操作提交最新快照，成功后清除 dirty/error 状态。
- [x] 空白 `/chat` 不继承上一会话；首次发送前的选择在创建与 ID 采用后保持不变，创建期间追加变化会补写到新 ID。
- [x] 会话 A 的 pending persistence、响应和错误不能影响 B；A/B 切换后各自从 SSR snapshot 初始化。
- [x] send/ask 使用 coordinator 的同一最新 snapshot；reasoning 仍按具体 modelId clamp/persist；edit/regenerate/continue 既有模型语义不变。
- [x] `/api/chat` 对 snapshot 字段做运行时校验，显式 null/off 不被缺省逻辑吞掉；新请求使用 body snapshot，旧请求缺省时保持数据库 fallback。
- [x] reducer、latest-only writer、Server Action 与 ChatComposer 交互测试覆盖交错、失败、重试、ID 采用和会话隔离。
- [ ] 定向测试、lint、typecheck、全量测试、build 与桌面/移动端交互回归通过，现有 UI 无非预期视觉变化。

最后一项仅剩认证后浏览器交互回归未完成；自动化测试、lint、typecheck 与 build 已通过，详见 `implement.md` 的 Verification Record。

## Dependencies

- `07-30-chat-completion-transaction-boundary` 已完成并归档；本任务不改变其消息/run/SSE 完成协议。

## Out Of Scope

- Chat 视觉重设计、Toolbar 信息架构或新增生成选项。
- 输入文本草稿、附件上传、浮层、artifact panel 或 chat stream Zustand store 重构。
- 服务端消息/run/SSE 事务、Gateway execution、RAG 状态机或模型目录规则。
- 多浏览器标签页之间的 Composer 冲突仲裁；本任务保证单个 Composer 生命周期内的顺序与会话隔离。
- 新增 composer revision、数据库迁移、后台无限自动重试或离线同步。

## Key Decisions

- 空白新会话从默认选择开始，不继承上一会话；首次发送前的本地选择成为创建快照。
- 失败保留最新乐观选择，显示未同步状态并允许重试，不自动回滚。
- 使用单客户端写队列加服务端完整快照原子更新；不为单界面顺序问题引入数据库 revision。
- 内部 WebChat 请求显式携带 outputModeId 与 clamped reasoning，使生成不依赖异步持久化是否已经完成；公开 `/v1/*` 不变。
