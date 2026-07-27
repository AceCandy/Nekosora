# 网盘式对话分享技术设计

## 1. 边界与原则

- `conversation_shares` 是分享配置和快照的唯一事实源；创建后除 `status/revokedAt/lastAccessedAt` 外不更新配置字段。
- 会话是实时分享内容的唯一事实源。公开读取必须先通过分享状态、到期和密码授权检查，之后才能读取会话与样式。
- 新快照完全从快照 JSON 读取，不再查询实时消息删除状态；旧记录走独立兼容分支，避免改变历史分享的删除语义。
- 客户端只提交配置意图。标题、模型、可见消息、样式定义、状态和所有权都由服务端查询并派生。
- 不复用 Better Auth 登录会话作为匿名分享授权，也不复用用于 API Key 的裸 SHA-256。

## 2. 数据模型

### `conversation_shares` 增量字段

- `mode`: nullable text，新增记录显式写 `snapshot` 或 `live`；历史 `null` 表示 legacy snapshot。
- `expires_at`: nullable `timestamptz`，`null` 表示永久。
- `password_verifier`: nullable text，保存版本化 scrypt 描述串（算法、成本参数、salt、digest），绝不保存明文。
- `render_style_snapshot`: nullable jsonb，类型包含 `sourceId/name/cssClass/css/renderer`。`sourceId` 仅用于审计，渲染只依赖冻结字段。
- 增加 `(conversation_id, created_at)` 索引，支撑当前会话分享列表。

### `conversations` 增量字段

- `message_version_selections`: nullable jsonb，保存“兄弟组 parentId -> 当前 assistant publicId”的映射。
- 版本切换 Server Action 在属主校验后原子更新对应映射；Chat SSR 与实时分享均用该映射解析可见消息。
- 消息不存在、已删除或不再属于该兄弟组时忽略该选择并回退到最新版本，避免陈旧状态阻断读取。

### `conversation_share_unlock_attempts`

- 字段：`id/share_id/scope/client_fingerprint/window_started_at/failure_count/blocked_until/updated_at`。
- `(share_id, scope, client_fingerprint)` 唯一；`share_id` 级联删除。
- `client_fingerprint` 是规范化来源标识的域分离 HMAC，不存原始 IP。缺少可信来源时使用固定 unknown 桶。
- 解锁失败在 PostgreSQL 中通过单条 upsert/事务原子更新两个桶：`share + client` 与 `share global`。达到阈值返回统一错误和 `Retry-After`；成功只清当前客户端桶，不清全局失败历史。
- 旧窗口记录按解锁路径惰性清理，避免引入常驻任务。

## 3. 类型与输入契约

- `CreateShareInput`: `conversationId/mode/expiration/password?/renderStyleId?`。
- `expiration` 使用判别联合：`forever | days(1|7|30) | custom(ISO timestamp)`；zod 校验自定义时间在未来。
- `live` 拒绝独立 `renderStyleId`；`snapshot` 校验样式仍启用，`null` 表示默认样式。
- `ConversationShareMessageSnapshot` 继续只承载只读展示需要的 `publicId/role/content`，不复制 reasoning、工具调用、反馈等交互数据。
- 管理列表返回 DTO：`shareId/mode/createdAt/expiresAt/status/hasPassword`，不返回 verifier、快照正文或 CSS。
- 公开读取使用判别联合：`unavailable | locked | ready`。`unavailable/locked` 不包含标题、模型、消息或样式。

## 4. 可见分支与版本选择

- 从 `getVisibleBranch` 提取不含会话鉴权的内部解析函数；现有登录态 wrapper 仍先校验属主。
- 基础分支继续按当前算法选择最新叶子并回溯主线，再对每个 assistant 兄弟组应用 `message_version_selections` 覆盖，保持与当前 Chat 单条版本替换行为一致。
- `switchVersion` 在更新本地 runtime 的同时等待持久化 action；失败时保留当前错误处理并刷新服务端状态，不能宣称已同步。
- 实时分享在每次请求中使用同一解析函数，因此能跟随编辑、软删除、版本选择和新增消息，不引入轮询或推送。

## 5. 创建与管理数据流

1. Chat Header 打开分享对话框，同时加载当前会话的分享列表和启用样式。
2. 创建 action 校验会话属主和输入。
3. 服务端解析当前可见消息；所有新分享都保存标题、模型和消息的创建时回退快照。快照模式另外冻结所选样式定义；实时模式的新代码在读取时忽略回退快照并解析会话，旧版本回滚时则降级展示该快照。
4. 密码使用异步 Node `crypto.scrypt`、每条随机 salt 和固定成本参数生成版本化 verifier；密码限制 8 至 128 字符。
5. 在一个数据库事务中写入分享记录并返回安全 DTO/`shareId`。
6. 客户端通过现有 `copyToClipboard` 复制 URL，并刷新同一对话框内的列表。
7. 列表 action 按 conversation owner 查询；撤销 action 保留现有属主校验并幂等设置 revoked 状态。

## 6. 公开访问与密码解锁

### 状态检查

- 先读取最小分享状态；`status != active`、`revokedAt != null`、已到期或不存在统一返回 `unavailable`，不读取内容。
- 无密码直接进入 ready；有密码时验证当前分享专属 Cookie，失败返回 `locked`。
- 每次 ready 读取仍重新检查分享状态和到期时间，因此撤销即时生效。

### 密码与 Cookie

- 密码验证先执行数据库原子限流，再用 scrypt 计算并常量时间比较；不存在/不可用链接不进入密码比较。
- 解锁成功签发域分离 HMAC 的 HttpOnly Cookie，载荷只包含 `shareId/exp/nonce/version`，不含密码或 verifier。
- Cookie 设置 `SameSite=Lax`、生产环境 `Secure`、`Path=/share/{shareId}`；到期为 `min(now + 24h, share.expiresAt)`。
- HMAC key 从现有服务端 secret 通过固定上下文派生，避免与 Better Auth Cookie 协议复用。

### 内容解析

- snapshot：只读取 `messageSnapshotsJson`、标题/模型快照和 `renderStyleSnapshot`。
- live：读取会话当前标题/模型、持久化版本选择后的可见消息和当前 render style；样式不存在或禁用时回退默认渲染。
- legacy：保持现有消息删除过滤、快照正文和默认样式行为；`expiresAt/password/mode` 的 null 值分别解释为永久、无密码和旧版快照。
- `lastAccessedAt` 只在 ready 内容成功返回后 best-effort 更新。

## 7. 展示复用

- 从 `ChatMessageItem` 提取无交互的消息正文展示原语，由 Chat 和分享页共同使用：用户消息保留默认气泡/换行规则，助手消息复用 `Markdown`、`ErrorBoundary`、renderer 和 `rs-{cssClass}` 容器。
- `ChatMessageItem` 继续拥有 reasoning、工具调用、版本切换、编辑、删除、反馈等交互；公开页只使用展示原语，不通过一组空回调伪装只读模式。
- 快照页只注入该分享冻结的 CSS；实时页只注入当前有效样式 CSS。CSS 仍沿用管理员可信内容和现有 `.rs-*` 作用域。
- 分享配置使用现有 Modal、OptionPicker、ConfirmDialog 和 Lucide 图标。模式使用分段控件；有效期与样式使用选项菜单；密码使用标准输入；危险撤销需要确认。
- 对话框使用“创建分享/已有分享”两个标签视图；移动端保持控件稳定宽高和可滚动内容，不嵌套卡片。
- 公开页设置 `noindex, nofollow`，锁定和不可用状态使用统一、无元数据的文案。

## 8. 兼容、回滚与风险

- 迁移只追加 nullable 字段/新表/索引，不回填历史敏感数据；新代码通过 `mode == null` 识别旧记录。
- 回滚应用版本时，旧代码会忽略新增字段；新增分享仍保留现有快照字段，使旧代码至少可读取其创建时内容。实时链接在旧代码下会降级为创建时快照，这是可接受的回滚行为。
- 删除整个会话继续级联删除分享，避免本期引入 share owner 冗余和孤儿记录。
- 全球分享桶可能被恶意请求触发而暂时阻止密码尝试；阈值应明显高于单客户端阈值，并通过测试集中定义，后续可按生产指标调整。
- “实时”是请求时一致，不提供已打开页面的主动推送；该边界在创建提示和 PRD 中明确。

## 9. 迁移与测试

- 通过 `pnpm db:generate:pg` 追加 PostgreSQL migration，并提交对应 SQL、`meta/_journal.json` 和新 snapshot；不得改写历史迁移。
- 迁移测试断言新列、索引、解锁尝试表、唯一约束、FK、journal 连续性与 snapshot prevId。
- 行为测试覆盖：输入组合、属主隔离、严格快照、legacy 兼容、live 分支/样式、过期、撤销、列表脱敏、scrypt、Cookie 边界、原子限流和统一不可用响应。
- 组件测试覆盖模式联动、未来内容警告、到期校验、复制 fallback、撤销确认、密码锁定/错误/成功和只读 Markdown。
