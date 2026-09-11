# 技术债审计（2026-09-11）

## 范围与方法
基线 4cc490a，初始工作区干净。只读抽查 apps/web、apps/gateway、apps/worker、packages、scripts 与 CI；CodeGraph 定位后复核关键源码/配置，并进行服务端与 Web 独立探索。本次是跨层风险审计，不是逐行安全认证。排除 docs/cankao、依赖/构建目录与私密配置。审计阶段未运行服务、数据库、上游、浏览器或测试；批准后的实际验证见各子任务 check.md 与父任务 check.md。

## 已确认发现与任务映射

| ID / 优先级 | 证据与实际影响 | 任务 |
|---|---|---|
| D1 / 高 | `packages/core/src/http/v1/mcp.ts:74` 仅断言 JSON，`:80` 在 try 外解构；JSON null 可造成未受控异常。`:103` 工具参数无结构校验。 | http-input-boundaries |
| D2 / 高 | `packages/core/src/http/api/chat.ts:107` 接受任意 JSON，`:112` 直接访问属性，`:140` 直接读取消息 role；null body 或 null 消息可引发异常。`packages/core/src/http/api/image-generate.ts:29` 同类问题，`:44,54` 重复 n 截断且不校验类型。尚未证明数据污染或越权，不作此类结论。 | http-input-boundaries |
| D3 / 中 | `packages/core/src/lib/repositories/route-repository.ts:13` Row=Record<string,any>，`:47` 等 schema 强转；`packages/core/src/lib/routing.ts:133,148` 丢失模型与路由字段约束。影响 schema 变更时的编译保护，不代表当前路由已错误。 | route-repository-types |
| D4 / 中 | `apps/web/src/features/chat/actions/share.ts:91,162` 保留 any 查询边界；`apps/web/src/lib/render-styles/service.ts:35,67` 和 `apps/web/src/lib/output-modes/service.ts:24` 查询后整体强转，消费者无法发现字段漂移。 | chat-read-model-types |
| D5 / 中 | `apps/web/src/app/chat/page.tsx:29` 与 `apps/web/src/app/chat/[id]/page.tsx:44` 重复 ModelOption、mode/style 投影，增加双点同步成本。 | chat-read-model-types |
| D6 / 高（验证链） | `packages/core/src/lib/gateway-governance/analytics.pg.test.ts:21` 默认跳过，`apps/web/scripts/test-file-processing-lease-pg.ts:81` runner 列表未包含该文件；根 `package.json` 的 test:pg 未调用 `apps/worker/package.json:16` 的 test:queue-pg。`.github/workflows/quality.yml:70` 只执行根入口，因此两项不在该 CI 检查链内。 | pg-test-coverage |

## 保留的后续债，不计入本批清零
- 其他领域仍有 schema any：`packages/core/src/lib/repositories/error-log-repository.ts:96`、`packages/core/src/lib/usage-aggregate.ts:42`、`packages/core/src/lib/chat/run-lifecycle.ts:186`、`packages/core/src/lib/compact/service.ts:74`、`packages/core/src/lib/conversation-title/service.ts:65`、`packages/core/src/lib/web-search/registry.ts:154`、`packages/core/src/lib/rag/context.ts:40`、`packages/core/src/lib/memory/jobs.ts:45`，以及 `apps/web/src/app/(dash)/admin/actions.ts:31`、`apps/web/src/app/(dash)/panel/actions.ts:33`。已确认存在类型逃逸，具体改造范围需各域完整调用链评估，不能整仓机械替换。本轮四批之后复审并拆下一组任务。
- `apps/web/src/app/chat/[id]/page.tsx:25,30` 把读取失败降级为空消息/新会话；新聊天页和 layout 也有可选数据降级。缺少可观测性的迹象已确认，但是否改变阻断/降级行为是产品决定，本批不改。

## 排除项与纠正
- CI 已有 PostgreSQL 服务、迁移、集成测试和三应用构建，不能说没有 PG 验证体系。
- `packages/core/src/lib/infra/metrics.test.ts:30` 起已有真实指标标签检查；不能因 observability 没有独立 test 脚本认定为完全无测试。其 workspace exception 的“无独立行为”措辞可后续校准，但不是本批高优先问题。
- Drizzle 工具入口、HTTP 回滚路由、包内兼容转发有实际职责，未发现足以删除的证据。
- 未做视觉设计审计、依赖漏洞扫描、压力测试或线上事故排查；没有证据声称系统已无缺陷。

## 实施顺序与决策
先 D6 补回归执行入口，再 D1/D2 请求边界，然后 D3 路由类型，最后 D4/D5 Web 读取类型。每批独立验证与复核。拒绝错误输入会改变此前偶然接受的非法请求行为：建议 HTTP 400、MCP -32600/-32602，合法 n 继续 1–4 截断，数字字符串/小数 n 拒绝；用户已于 2026-09-11 确认，四批实现及验证完成，待提交归档。
