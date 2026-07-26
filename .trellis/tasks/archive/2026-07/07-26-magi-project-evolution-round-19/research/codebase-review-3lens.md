# 三路只读代码审查（2026-07-26）

三个只读子代理并行审查：①后端运行时与数据层、②前端与交互质量、③架构一致性与可维护性。共 27 条发现（5 高、13 中、9 低）。5 条高严重度已由主会话抽验属实（熔断器副作用转换、超时字段无消费方、verifyKey 不含 user.status、zod 仅 2 文件、按钮反色落在页面背景）。

本文件是后续进化轮次的候选池；round-19 已规划的 best-effort 有界等待与 heartbeat 修复不在此列。

---

## 一、后端运行时与数据层

### B1.【高】熔断器 half-open 探测名额"有借无还"，provider 可被永久禁用
- 位置：`src/lib/circuit-breaker.ts:71-81`、`src/lib/routing.ts:187-190`、`src/lib/stream.ts:318,328-331,356-358`
- `isProviderAllowed` 在路由解析时带副作用地把 open→half-open 并消耗唯一探测名额；回报点只有真正执行成功的 `recordSuccess` 与 failoverable 失败的 `recordFailure`。名额被消耗但不回报的路径：①该路由排后、前序路由成功；②客户端中止（isAbortError 分支不记成功也不记失败）；③非 failoverable 错误；④ image-gen 等能力路由完全不接回报。half-open 无超时回退，之后恒拒绝——存在其他健康 provider 时该 provider 永久跳过，直到重启。
- 方向：half-open 名额加租约超时；或状态转换移到"实际发起请求时"，保证所有终止路径归还名额。

### B2.【高】provider 的 connectTimeoutMs/readTimeoutMs 从未生效，上游调用无超时
- 位置：`src/lib/providers/registry.ts`（全文件无超时逻辑）、`src/lib/routing.ts:48-49`、`src/db/schema/pg.ts:192-193`、`src/app/v1/chat/completions/route.ts:210`
- 字段在 schema 定义、被装进 ResolvedProvider，但 registry 的 fetch 层完全未消费；非流式路径连 abortSignal 都不传。上游 hang 时唯一兜底是 undici 默认 headersTimeout（约 300 秒），failover 在 hang 场景实际失效。
- 方向：registry custom fetch 层用 AbortController 实现建连/读超时，超时归类 network_error 参与 failover。

### B3.【高】管理端"禁用用户"完全不生效
- 位置：`src/app/(dash)/admin/actions.ts:754-758`、`src/lib/session.ts:15-31`、`src/lib/keys.ts:126-168`、`src/app/api/chat/route.ts:52-55`
- `toggleUserStatus` 只改列；getSession 返回 status 但无鉴权路径校验；verifyKey 只查 apiKeys.enabled 不关联 user.status；禁用也不吊销 session/key。被禁用用户 WebChat 与网关 sk 照常可用。
- 方向：getSession / verifyKey 统一拒绝 `status !== "active"`，禁用动作吊销活跃 session。

### B4.【中】MCP sse/http client 生命周期错乱
- 位置：`src/lib/mcp/registry.ts:299-304,208-214,55,137-155`、`src/lib/stream.ts:874-893`、`src/app/api/chat/route.ts:420`
- callMcpTool finally 会真关 sse/http client → 同一 run 第二次调用该 server 的工具必失败；未被调用的 server 连接无 close 路径纯泄漏；stdioPool 只 set 无淘汰，配置变更仍复用旧进程。
- 方向：连接生命周期上收到一次 run，run 收尾统一 close；stdioPool 补 idle 淘汰与配置指纹。

### B5.【中】isAbortError 子串匹配过宽，上游故障被误判为客户端中止
- 位置：`src/lib/stream.ts:121-125,328-331`
- 裸 `/aborted/i` 子串命中 node `Error: aborted`、ECONNABORTED、代理 502 正文等；命中后不记失败、不换 key、不转移、不上报熔断，usage 记 interrupted，无 error 帧照发 [DONE]——观测黑洞 + failover 旁路。
- 方向：以 `opts.abortSignal?.aborted === true` 为主条件，消息匹配仅辅助。

### B6.【中】网关流式断开 usage 计量竞态，interrupted 记录可能整条丢失
- 位置：`src/app/v1/chat/completions/route.ts:103-104,116`、`src/lib/stream.ts:398-434`
- `break` 使 generator 提前 return()，finally 走"只补 metrics 不写日志"分支；同一断开行为依时序产生两种计量结果。frame() 直接 enqueue 无 try/catch（对比 /api/chat 的 safeEnqueue）。
- 方向：finally 对"未成功、未 abort、无失败记录"的提前终止补 interrupted 终态日志；网关 frame 改 safeEnqueue。

### B7.【中低】图像生成无故障转移、不回报熔断
- 位置：`src/lib/providers/multimodal/image-gen.ts:12,65-96`
- 头注释称逐条路由尝试，实现只取 routes[0]；全程无 recordSuccess/recordFailure，还是 B1 的贡献路径。
- 方向：按 streamChat 模式逐条尝试并回报熔断。

### B8.【低】热路径缺索引
- tool_calls 无 (run_id, tool_call_id)（流式事件循环内 update）、ops_error_logs 无 request_id（前端按其聚合）、api_keys 无 key_prefix（注释声称有 prefix 索引）。
- 位置：`src/db/schema/pg.ts:417-430,864-871,105-126`、`src/lib/chat/run-lifecycle.ts:307-315`、`src/lib/keys.ts:139-142`
- 方向：补三个 btree 索引随迁移落地。

### B9.【低】uncaughtException/unhandledRejection 全量吞掉
- 位置：`src/lib/infra/process-guards.ts:46-60`
- 未知异常仅 console.error，不退出不告警，进程带病服务。
- 方向：非 allowlist 异常记录后优雅退出或至少接告警指标。

---

## 二、前端与交互质量

### F1.【高】用户消息"展开/收起"按钮在明暗两主题下均不可读
- 位置：`src/features/chat/components/ChatMessageItem.tsx:409-425`（样式 413 行）
- 按钮在气泡 div 之外、落在页面背景上，却沿用气泡内反色 `text-white/70 dark:text-black/60`：亮色白字压近白背景、暗色黑字压近黑背景。长消息折叠后唯一显式展开入口失明。
- 方向：改用页面背景上的常规中性色，或移入气泡内部。

### F2.【中】新会话首次发送失败时，错误/停止标记拼进用户气泡
- 位置：`src/features/chat/store/chatStreamStore.ts:423-429`（assistant 占位 341-348 才创建）
- createConversation 抛错或该窗口内点停止时，lastMessageIdx 指向用户消息，`[错误]`/`[已停止生成]` 拼进用户正文且重试时进上下文。
- 方向：catch 里校验目标 `role === "assistant"`，否则插独立错误占位。

### F3.【中】打开历史会话触发 N 条冗余 getMessageSiblings
- 位置：`src/features/chat/components/ChatComposer.tsx:145-153`、`src/app/chat/[id]/page.tsx:62`、`chatStreamStore.ts:649-664`
- effect 挂载必执行，对每条 assistant 消息各发一个 server action（串行），而 SSR versionMap 已注入同样数据；流结束后又全量重跑。
- 方向：挂载时信任 SSR 跳过；流结束只刷新本轮涉及的 publicId。

### F4.【中】ChatMessageItem 的 memo 被逐帧新建回调击穿
- 位置：`src/features/chat/components/ChatMessageList.tsx:168-184,264`、memo 在 `ChatMessageItem.tsx:60`
- handleRegenerate/handleEdit/onRequestDelete 引用不稳定 → 流式每帧、打字每键全列表重渲染，store 层 rAF 合批被整体抵消。
- 方向：useCallback 稳定三个回调。

### F5.【中】写操作失败普遍只 console.error，无用户可见反馈（无 toast 机制）
- 位置：`ChatComposer.tsx:180/200/212/225/237/248`、`Sidebar.tsx:268-279`、`ChatHeader.tsx:35-37`、`chatStreamStore.ts:561-563,644-646`
- 乐观更新失败后本地 state 保持已改状态（刷新回跳）或点击无动静；全仓无 toast 基础设施。
- 方向：引入轻量全局提示，或失败回滚 + 行内错误。

### F6.【中】多处用户可见文案硬编码中文绕过 next-intl
- 可见文本：`Button.tsx:50`"加载中..."、`ChatToolbar.tsx:214`、`ChatOutline.tsx:143`、`Sidebar.tsx:505-506`、`sse.ts:143/146`（[已停止生成]/[错误] 直接进消息正文）、`chatStreamStore.ts:375/427`、`chat/[id]/page.tsx:29`
- aria：`ChatInputBox.tsx:211`、`ChatMessageItem.tsx:515`、`Sidebar.tsx:385/386/398/522`、`ChatToolbar.tsx:113/128/180/206`、`Modal.tsx:92`、`Combobox.tsx:171`、`structured-blocks/index.tsx:28`
- messages 文件本身 key/ICU 完全对齐；问题在绕过 t() 的散落字符串。
- 方向：收敛到 chat/common 命名空间；流式错误标记由渲染层按 locale 翻译而非写死进 content。

### F7.【低】主输入框静止态 shadow-sm 违反 DESIGN.md 零影子规则
- 位置：`src/features/chat/components/ChatInputBox.tsx:102`
- 方向：去静止 shadow，层次交给边框与 focus-within。

### F8.【低】历史消息思考耗时恒显示"已思考 1 秒"
- 位置：`ChatMessageItem.tsx:146-161`；Math.max(1,…) 钳出编造值，耗时未持久化。
- 方向：无持久化耗时不显示秒数，或后端补存 duration。

### F9.【低】对话大纲无法键盘触达
- 位置：`ChatOutline.tsx:119-159`；仅 mouseenter/touchstart 打开，圆点不可聚焦；聊天区又刻意隐藏滚动条。
- 方向：触发区加可聚焦按钮，focus 时展开。

---

## 三、架构一致性与可维护性

### A1.【高】API 边界普遍无 zod 校验，违反 type-safety spec 明文契约
- 位置：`src/app/v1/chat/completions/route.ts:53-77`、`src/app/api/chat/route.ts:57-99`；契约 `.trellis/spec/frontend/type-safety.md:26-28`
- 全仓引用 zod 仅 2 文件（share.ts、structured-blocks/schema.ts）。对外网关入口全是手写 as 断言；畸形值穿透到 streamText/Drizzle，失败面貌变 5xx 而非 400，错误归因不可控。
- 方向：至少 /v1/* 与 /api/chat 入口补 zod，失败映射 REQUEST_INVALID_JSON / REQUEST_MISSING_FIELD。

### A2.【中】validateEnv() 从未被调用
- 位置：`src/lib/infra/env.ts:1-2,29`、`src/instrumentation.ts:22-46`
- 头注释承诺启动校验，实际 register()/worker main() 均未接线；DATA_ENCRYPTION_KEY 等要到首次使用才炸。`skRandomLength`（env.ts:23）无消费方。
- 方向：instrumentation NODE 分支与 worker 启动调用 validateEnv()；清理 skRandomLength。

### A3.【中】首个管理员用硬编码默认凭据自动创建，生产无拦截
- 位置：`src/lib/infra/db/bootstrap.ts:495-504`
- 未配 SEED_ADMIN_PASSWORD 时以 `admin@nekusora.local` / `change-me-on-first-login` 创建 admin，无"生产必须显式配置"校验（crypto.ts 对弱密钥有生产拦截，此处未对齐）。
- 方向：生产缺省时拒绝创建或生成随机密码打印一次。

### A4.【中】模型可见性谓词在 5 文件 7+ 处内联复制
- 位置：`src/lib/chat/orchestrator.ts:159-183,424-443`、`src/features/chat/actions/conversations.ts:44-71,77-102`、`src/app/(dash)/admin/actions.ts:503-504`、`src/lib/routing.ts:274-278`（+114 行内存判断形态）
- 可见性规则演进时极易漏改一处形成越权或不可见 bug。
- 方向：下沉为共享查询构造函数统一消费。

### A5.【中】网关热路径 ctx: any 丢弃已有 CallContext 类型
- 位置：`src/app/v1/chat/completions/route.ts:93-94,200-201`；verifyKey 返回类型完备（keys.ts:126-129）。
- 方向：直接标 CallContext，删两处 eslint-disable。

### A6.【中】网关档位翻译与非流式路径零测试
- 位置：`src/lib/reasoning.ts:211`（resolveReasoningLevel 唯一调用方是 v1 route，无测试）、`route.test.ts:35-118` 仅 4 用例，无 reasoning 关键词，nonStreamResponse 零覆盖。
- AGENTS.md 明文要求档位与请求体翻译测试。
- 方向：补 reasoning_effort 各取值 → irRequest 断言与 nonStreamResponse 成功/错误路径。

### A7.【低】确认的 dead code
- `src/lib/routing.ts:257-288` listModelsByCapability 零引用（且内含第 8 处可见性谓词副本）；`src/app/v1/mcp/route.ts:126-127` 占位动态 import；env.ts:23 skRandomLength。
- 方向：删除或真正接入。

### A8.【低】getSchema() as any 93 处未统一
- 36 文件 93 处；spec 认可的 `const S = () => getSchema() as any` helper 形态仅 5 文件使用，其余逐函数复制两行样板。getSchema 返回值本就是 Record<string, any>，断言零效果。
- 方向：短期收敛为单一 S() 取用点；长期让 getSchema 返回真实 schema 类型收回编译期检查。

### A9.【低】Number(env) || default 使 0/非法配置静默失效
- 位置：`src/lib/circuit-breaker.ts:39-41`；与 db/index.ts:58-61 对 DB_POOL_MAX 的显式 throw 风格不一致。
- 方向：与 DB_POOL_MAX 对齐，非法值抛错或 warn。

---

## 三路整体印象（合成）

- 后端：日志分流、脱敏体系、run 租约、行锁事务扎实；短板集中在"失败路径状态回报未与成功路径对称闭环"（熔断名额、超时、abort 判定、断开计量本质是同一问题）。
- 前端：store 按会话隔离、rAF 合批限速、SSE 消费器抽离都好；短板是"乐观更新+静默失败"反馈闭环缺失、渲染优化被不稳定回调抵消、散落硬编码文案。
- 架构：model_catalog 唯一事实来源纪律全仓落实到位，迁移三件套严格对齐，i18n 双语 940 叶子键同步；债务在"spec 写了但入口层没执行的 zod/any 契约"与可见性查询复制漂移。

## 建议的分轮主题（候选）

1. 可用性闭环轮：B1 熔断名额 + B2 超时 + B5 abort 判定 + B6 断开计量 + B7 图像回报（同一主题：failover 真正可用）。
2. 权限与边界轮：B3 禁用用户 + A1 zod 边界 + A3 seed admin + A2 validateEnv。
3. 前端体验轮：F1 按钮可读性 + F2 错误串气泡 + F4 memo + F5 反馈机制 + F3 冗余请求。
4. 清理轮：B8 索引 + A4 可见性下沉 + A5/A7/A8/A9 + F6 文案收敛 + F7/F8/F9。
