# API Key 数据路径加固实施计划

## 1. 测试先行

- [x] 为 `listKeys/getMyKeys` 增加字段投影与运行时序列化测试：底层假数据包含 `keyHash/parentId`，返回结果和 `KeysManager` props 均不得包含这些字段。
- [x] 保留并补齐 legacy/current prefix 鉴权测试，确保 owner 状态、Key 状态和常量时间 hash 路径不变。
- [x] 增加 Drizzle schema 与 migration 合同测试，断言 prefix 索引存在、parent 列和索引移除、journal/snapshot 连续。
- [x] 增加隔离 PostgreSQL 测试：写入至少 20,000 条高选择性 prefix 数据并 `ANALYZE`，递归断言 JSON 计划以 Index/Index Only/Bitmap Index Scan 引用 `api_keys_key_prefix_idx`，不得关闭 seq scan。

## 2. Core 与前端边界

- [x] 在 Key 模块定义最小展示 DTO，`listKeys` 使用显式 `.select({...})`。
- [x] 页面与 `KeysManager` 复用 DTO 字段类型，移除掩盖额外运行时字段的断言。
- [x] `getBindableModels` 与页面边界仅投影 `id/name/displayName`，并用含敏感模型字段的运行时测试防回归。
- [x] 从 Key 记录类型和创建路径移除 `parentId`，保持 master/sub 与绑定逻辑不变。
- [x] 更新 `keys.test.ts` 及所有受影响 fixture、注释和类型断言，确保不遗留父子关系假设。

## 3. Schema 与迁移

- [x] 更新 `packages/db/src/schema.ts`：增加 `api_keys_key_prefix_idx`，移除 `parentId` 和 `api_keys_parent_idx`。
- [x] 使用项目 Drizzle 生成流程产生下一份 SQL migration、journal 与 snapshot，再人工核对只包含预期 DDL。
- [x] 在任务设计中保留维护窗口、连接排空、备份/账本核验、锁风险和两阶段回滚说明，不修改既有自动迁移框架。
- [x] PostgreSQL runner 从 0010 存量库执行 0011，覆盖非空 `parent_id` 行保留与临时资源清理。

## 4. 规范与复核

- [x] 更新 API Key 所属后端规范，记录索引、展示 DTO、平面 master/sub 权限模型和部署顺序。
- [x] 独立复核鉴权兼容、RSC 数据边界、迁移元数据、维护窗口/旧版本兼容风险和测试有效性。

## 5. 验证命令

- [x] 定向 Vitest：Key、routing、schema、migration 合同测试。
- [x] 隔离 PostgreSQL 定向测试：迁移、schema、legacy/current Key、`EXPLAIN`。
- [x] `pnpm check`
- [x] `pnpm test`
- [x] `pnpm build`
- [x] `pnpm build:gateway`
- [x] `git diff --check`
- [x] Trellis task validate。

## 6. 回滚点

- Core/DTO 改动可独立回滚，不依赖新索引。
- 迁移执行前可直接回滚应用。
- 迁移后且恢复流量前，以一致性数据库备份同时恢复 schema、原始父子元数据和迁移账本，再启动旧应用。
- 恢复流量后只做前向修复；紧急旧版本兼容只能人工恢复 nullable 列/索引并跳过自动迁移，不得声称恢复了原始关系数据。
