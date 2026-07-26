# MAGI 项目进化第 13 轮

## Goal

修复管理端模型与路由操作对客户端提交的 `providerId` 缺少属主校验的问题，防止管理员把其他管理员的私有 Provider 绑定到自己可管理的模型，并阻止未获授权的私有路由探测使用他人的上游密钥。

## Background

- `providers` 没有公开可见性，项目契约要求仅属主能够查看和管理；公共模型及路由可以由任意管理员管理，但这不授予其使用其他管理员私有 Provider 的权限。
- `src/app/(dash)/admin/actions.ts:505-516` 会向管理员返回公共模型的路由，其中包含 `route.providerId`，因此其他管理员的 Provider ID 可从正常管理界面获得。
- `src/app/(dash)/admin/actions.ts:519-558` 的 `createModel`、`:566-582` 的 `createRoute` 和 `:697-710` 的 `updateRoute` 接受 `providerId`，但未同时限定 `providers.ownerUserId = admin.id`。
- `src/app/(dash)/admin/actions.ts:438-465` 的 `testRoute` 只按路由 ID 读取路由和 Provider，未执行现有的路由管理权校验，随后会解密并使用 Provider 密钥发起上游探测。
- `src/lib/repositories/route-repository.ts:79-99` 与 `src/lib/routing.ts:126-153` 在运行时按路由直接关联并解密 Provider，不再补做属主校验；因此非法绑定会实际使用受害者密钥，而不是形成无效数据。
- `attachProviderModelRoute` 已正确要求 Provider 属于当前管理员，可作为同类操作的一致行为基准；现有测试只覆盖该入口。

## Requirements

- 所有管理端模型或路由操作在接受客户端提供的 `providerId` 时，必须在读取或写入前确认 Provider 属于当前管理员。
- `createModel` 在同时创建初始路由时只能绑定当前管理员的 Provider；校验失败必须回滚模型和路由创建。
- `createRoute` 和 `updateRoute` 只能写入当前管理员拥有的 Provider；校验失败不得插入路由或改变原路由。
- `attachProviderModelRoute` 保持现有属主校验和返回语义，并与其他入口复用同一校验规则。
- Provider 不存在或不属于当前管理员时统一按“服务商不存在”拒绝，不能向调用方泄露其真实存在性。
- `testRoute` 必须先按现有公共/私有模型权限规则校验路由管理权，再读取 Provider、解析密钥或发起探测；其他管理员的私有路由不得触发任何上游请求或熔断状态更新。
- 保持既有协作语义：任意管理员仍可管理公共模型及其路由，并可主动把自己拥有的 Provider 绑定到可管理的公共模型；其他人的私有模型和路由仍仅属主可管理。
- 保持现有表结构、Server Action 签名、表单字段、前端交互、运行时路由解析和正常正向行为不变。

## Acceptance Criteria

- [x] `createModel` 收到其他管理员的 `providerId` 时抛出“服务商不存在”，且模型和路由均未写入；当前管理员的 Provider 仍可正常创建模型和初始路由。
- [x] `createRoute` 收到其他管理员的 `providerId` 时拒绝且不写入；当前管理员仍可给自己的私有模型或可管理的公共模型添加路由。
- [x] `updateRoute` 收到其他管理员的 `providerId` 时拒绝且保留原路由；使用当前管理员 Provider 的更新保持正常。
- [x] `attachProviderModelRoute` 继续拒绝其他管理员的 Provider，现有成功、重复和模型权限测试保持通过。
- [x] `testRoute` 对其他管理员的私有路由在密钥解析和上游探测前失败；自己的私有路由和可管理的公共路由仍能正常探测。
- [x] 聚焦测试覆盖 `createModel`、`createRoute`、`updateRoute`、`attachProviderModelRoute` 和 `testRoute`，并验证失败路径没有数据库写入、上游探测或熔断副作用。
- [x] lint、typecheck、全量测试、生产构建和 `git diff --check` 通过，独立复核未发现遗漏入口或权限回归。

## Out Of Scope

- 改变“公共模型与路由可由任意管理员管理”的既有权限策略。
- 隐藏公共路由的 Provider ID 或 Provider 名称。
- 为 Provider 增加 `visibility`、共享授权表或新的角色/RBAC 能力。
- 修改 WebChat、网关路由解析、用量归属、Provider 密钥加密或数据库 schema。
- 同轮修复流式故障转移拼接、聊天 `generating` 并发状态、后台任务重试或非流式推理档位翻译。

## Risks And Deferred Items

- 公共模型仍允许任意管理员更新或删除，这是已确认的既有产品策略，不属于本轮漏洞。
- 管理员把自己拥有的 Provider 主动绑定到他人拥有的公共模型时，路由 `ownerUserId` 仍跟随模型属主；本轮保持该既有语义。
- 其他审视候选已记录在 `research/round-selection.md`，后续轮次按影响和证据重新排序。
