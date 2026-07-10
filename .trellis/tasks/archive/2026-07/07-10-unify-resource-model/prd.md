# 统一资源模型:服务商/模型/路由合并 + 可见性

## 背景

现状「全局 / 个人」是两套完全镜像的表:`global_providers`/`user_providers`、`global_models`/`user_models`、`global_routes`/`user_routes`。字段高度重复(name/displayName/vendor/capabilities/systemPrompt/enabled/sortOrder 等),管理端与用户端各维护一套,同一份模型定义要在两边各填一遍。

更深层的问题:全局模型与个人模型的**真正差异是「谁能看见、谁的 key/谁付费」**,而不是模型定义本身。这套语义用「双轨镜像表」表达是错配的——它把「可见性」这个本该是字段的维度,硬拆成了两张表。

## 目标

把三对镜像表合并成三张统一表,用 `ownerUserId` + `visibility` 表达归属与可见性:

| 现状(双轨) | 合并后 | 新增维度字段 |
|---|---|---|
| global_providers / user_providers | `providers` | `ownerUserId` + `visibility`(public/private) |
| global_models / user_models | `models` | `ownerUserId` + `visibility` |
| global_routes / user_routes | `routes` | `ownerUserId`(跟随所属模型) |
| usage_logs | 不动 | 已是文本快照(model/providerName/routeId 均为字符串),本就统一 |

**统一可见性规则(三表一致)**:
```
可见 = visibility=public  ∪  (visibility=private && ownerUserId=自己)
```

## 关键决策(已与用户确认)

1. **不管历史数据**:项目未上线,直接删旧表建新表,**不写任何数据搬迁 / 历史兼容迁移逻辑**。
2. **服务商 key 模型**:合并后统一为「多 key + 轮询策略」(取 global_providers 现状的 `apiKeysEnc` + `keyStrategy` 超集),不再保留 user_providers 的单 key `apiKeyEnc`。
3. **public 资源改权**:`visibility=public` 的资源,任意 `role=admin` 用户都可改;`visibility=private` 仅 `ownerUserId` 本人可改。
4. **后台路径统一到 `/panel`**:admin 与普通用户同路径,靠 `role` 区分能力(admin 多出「发布到全局」);`/admin` 废弃并重定向。
5. **普通用户的权限边界**:只能创建/管理 `visibility=private` 的自己的资源;**看不到 public 资源的后台管理界面**(不能改、不能看 key);仅在 chat 选择器里能选到 public 模型。
6. **发布权限**:`role=admin` 才能把 private 资源标记为 public 发布(复用现有 `user.role`,无需新建权限体系)。

## 范围

**纳入**:
- 三对镜像表合并(drizzle 双方言 sqlite + pg schema + 迁移)
- 网关路由解析统一(`route-repository` + `routing.ts`):分流方法合并、两个 resolve 函数合一、`toResolvedProvider` 去掉 keyField 参数
- `key_model_bindings` 收敛:`scope` + `globalModelId` + `userModelId` → 单 `modelId`
- service / server actions 合并:admin 与 byo 两套 service/actions 收敛成带 owner+visibility 参数的一套
- chat 可见模型查询:`getVisibleModels` 从「查两表 union」变「单表 where」
- 后台 UI:ModelsManager / ProvidersManager / 路由表单去掉 `variant: "global"|"byo"` 双分支;`/panel` 加「发布到全局」开关;`/admin` 重定向
- i18n:models/providers 命名空间随 UI 改造同步

**不纳入(非目标)**:
- 历史数据迁移 / 向后兼容(明确不做)
- usage_logs 结构改动(文本快照,本就统一,仅可能的查询过滤调整)
- 输出模式 / 输出样式等其他列表(本次只动 provider/model/route 三类资源)
- 新增权限角色 / RBAC 体系(复用现有 `role`)

## 验收标准

1. **数据层**:三张统一表在 sqlite + pg 双方言 schema 中定义一致;迁移为纯 DDL(drop 旧六表 + create 新三表 + key_model_bindings 改造),无数据搬迁语句。
2. **可见性**:任意资源(providers/models/routes)的读取,都满足 `visibility=public ∪ (private && owner=自己)`;普通用户无法读取到他人 private 资源或 public 资源的敏感字段(如 key)。
3. **权限**:普通用户创建资源时 `visibility` 强制为 private;非 admin 调用「发布为 public」被拒;public 资源任意 admin 可改、private 仅 owner 可改。
4. **网关**:请求路由解析结果与改造前等价(同一模型名 → 同一上游路由链,含 priority/weight 加权与熔断故障转移);模型来源(public/private,或全局/个人归属)在 usage 记录中保持可区分。
5. **chat**:用户在 chat 模型选择器看到的集合 = public 模型 ∪ 自己的 private 模型,顺序规则沿用(个人在前、全局在后,或按 sortOrder)。
6. **后台**:统一路径 `/panel` 下,admin 能看到自己创建的全部资源(含 public)并发布;普通用户只看到自己的 private;`/admin/*` 访问重定向到 `/panel`。
7. **质量**:`pnpm lint` + `pnpm typecheck` + `pnpm test` 全绿;网关路由链路有覆盖测试守住等价性。

## 风险与约束

- **网关是核心命脉**:路由解析直接决定请求能否打通。核心算法(orderRoutes/weightedShuffle/filterByCircuitBreaker/pickWeightedKey/parseKeyBundle)与表结构解耦,改动应只落在「数据来源」,但必须有等价性验证。
- **子 key 绑定语义**:`key_model_bindings` 收敛成单 modelId 后,子 key 的模型绑定/鉴权逻辑需同步改造,不能漏判。
- **双方言一致性**:sqlite 与 pg 的 schema/迁移必须保持同构(项目既有约定)。
- **未上线**:无历史包袱,允许破坏性 schema 变更,这是降低风险的关键有利条件。
