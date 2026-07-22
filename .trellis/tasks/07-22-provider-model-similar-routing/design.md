# 服务商模型相似匹配与路由复用：技术设计

## 边界

- `src/lib/model-catalog.ts`：新增纯函数，负责模型 ID 归一、候选评分和稳定排序；不访问数据库，不改变现有 `findCatalogMatch` 行为。
- admin / panel 服务商页面：把当前可管理模型及其目录元数据序列化为轻量候选 DTO，连同已有路由传给 `ProvidersManager`。
- admin / panel actions：新增快速补路由 action，服务端重新校验模型、服务商和重复路由；返回 `created` 或 `exists`。
- `ProvidersManager`：处理点击状态机、候选弹窗、pending 与结果反馈；“新建模型”继续复用现有模型页 query + `ModelFormDialog`。

## 数据契约

### 候选模型 DTO

```ts
interface ProviderModelCandidate {
  id: string;
  name: string;
  displayName?: string;
  catalogId: string;
  catalogName: string;
  canonicalModelId: string;
  aliases: string[];
}
```

### 快速补路由 action

```ts
type AttachProviderModelRouteAction = (
  modelId: string,
  providerId: string,
  upstreamModelName: string,
) => Promise<{ status: "created" | "exists" }>;
```

## 点击状态机

```text
点击 providerId + upstreamModelName
  -> 严格查找 model.name === upstreamModelName.trim()
     -> 命中：调用幂等 action，显示服务端 created/exists
  -> 未命中：rankSimilarModels(...)
     -> 打开候选弹窗（候选可为空）
        -> 选择已有模型：调用幂等 action，显示服务端 created/exists
        -> 选择新建：跳转现有模型新建 URL
```

客户端快照只负责预标记候选状态；每次最终选择都调用服务端 action。即使另一标签页刚新增或删除路由，界面也以 action 返回的 `created` / `exists` 为准。

## 相似度算法

1. 目录命中：用现有 `findCatalogMatch` 将上游 ID 映射到目录，候选 `catalogId` 相同即进入最高置信组。
2. 归一 ID：trim、lowercase、取最后一个 `/` 后内容、空格和 `_` 转 `-`、合并连续 `-`。
3. revision base：仅移除尾部 `latest`、`YYYYMMDD` 或由 `-` 分隔的 `YYYY-MM-DD`。
4. 包含关系：归一后的完整词元边界前缀/后缀扩展进入中等置信组。
5. 词元相似：至少两个公共词元；Dice 系数和归一字符串相似度均过阈值；双方参数规模 token 不同则拒绝。
6. 去重后按匹配层级、综合分数、输入顺序排序，截取 5 条。

算法不硬编码厂商或具体模型名称；能力/档位词不会被删除。

## 权限与一致性

- panel 只传入并允许绑定当前用户自有模型、当前用户自有 provider。
- admin 沿用 `assertModelManageable`；provider 必须属于当前 admin。
- 重复路由按 `modelId + providerId + upstreamModelName` 查询。
- action 不接受客户端提供 owner，插入路由 owner 由服务端模型/当前用户推导。
- 本次不增加数据库迁移；应用层判重满足该交互的幂等反馈，但不宣称解决无唯一约束下的跨事务并发竞态。

## 交互设计

- 使用现有 `Modal`、`Button` 和 lucide 图标，不增加新的浮层体系。
- 候选为紧凑单选列表，显示模型 ID、显示名/模板和“已存在”状态。
- 已存在项仍可点击，点击只显示结果反馈且不写入。
- 操作 pending 时禁用候选，避免当前客户端重复提交。
- 反馈放在弹窗内的 `role="status"` 区域；完全匹配的即时结果也复用同一结果弹窗，避免依赖项目中不存在的 toast 基础设施。
- 新建入口为明确的次级命令，始终可见。

## 回滚

- 删除新增的纯函数、action、DTO props 和候选弹窗接线即可恢复原有直接跳转行为。
- 不涉及 schema 或数据迁移，代码回滚不需要数据库操作。
