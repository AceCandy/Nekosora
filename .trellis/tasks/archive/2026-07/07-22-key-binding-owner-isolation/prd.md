# 子密钥绑定属主隔离

## Goal

阻止已登录用户读取、禁用或修改其他用户的 API key 模型绑定，并防止通过绑定任意模型 ID 绕过 private 模型可见性。

## Background

- `disableKey` 只校验登录，随后由 `setKeyEnabled(keyId, false)` 按全局 key ID 更新。
- `getBindings`、`bindModel` 和 `unbindBinding` 只校验登录，未验证 key 或绑定所属用户。
- 子 key 绑定是网关授权依据；`/v1/models` 与路由解析会信任绑定的 `modelId`。
- UI 允许绑定的集合是已启用 public 模型与当前用户已启用 private 模型，但 `bindModel` 未在服务端执行同等校验。

## Requirements

- `disableKey` 只能禁用当前用户拥有的 key。
- `getBindings` 只能返回当前用户 key 的绑定；非属主请求必须失败且不返回绑定元数据。
- `bindModel` 仅接受当前用户拥有的 sub key。
- `bindModel` 仅接受已启用 public 模型，或当前用户拥有且已启用的 private 模型。
- `unbindBinding` 必须通过绑定关联的 key 验证当前用户属主后再删除。
- 越权与非法模型请求必须在 insert、update 或 delete 前失败。
- 保持现有 UI、schema 和 public/本人 private 模型绑定行为不变。

## Acceptance Criteria

- [x] 回归测试覆盖禁用他人 key、读取他人绑定、给他人 key 绑定和删除他人绑定。
- [x] 回归测试覆盖拒绝他人 private 模型，并允许 public 模型与本人 private 模型。
- [x] 所有拒绝场景均断言未执行对应数据库写操作。
- [x] lint、typecheck、完整测试、生产构建和 `git diff --check` 通过。

## Out Of Scope

- 修改 key/model/binding schema 或数据库迁移。
- 改变网关对 public 模型的既有绑定与路由语义。
- 重构密钥生成、校验或模型路由仓储。
