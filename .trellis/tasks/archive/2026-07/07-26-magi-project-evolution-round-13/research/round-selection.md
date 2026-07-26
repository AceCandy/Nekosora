# 第 13 轮候选审视与选题

## 审视范围

本轮分别审视聊天运行态并发、服务端鉴权隔离、网关与计费、后台任务、文件与外部资源边界、模型目录到请求翻译。候选只在具备当前代码证据、明确触发链和可验证修复边界时进入排序。

## 候选排序

| 优先级 | 候选 | 证据与影响 | 本轮结论 |
| --- | --- | --- | --- |
| P1 | 管理端 Provider 属主校验缺失 | `admin/actions.ts:519-558,566-582,697-710` 接受任意 `providerId`；公共路由列表会暴露该 ID；运行时 `route-repository.ts:79-99` 直接关联 Provider，`routing.ts:126-153` 解密并使用密钥。可造成跨管理员上游密钥和成本滥用。 | 选中 |
| P1 | Embedding 设置可绑定 foreign Provider | `admin/settings/ModelConfigSection.tsx:107-115` 直接保存客户端 `provider_id`；`rag/embedding.ts:57-72` 按全局 ID 读取并解密 Provider。可使后台 embedding 使用其他管理员密钥。 | 独立复核新发现，下一轮首选 |
| P1 | 流式已输出后仍故障转移 | `stream.ts:306-345,534-545` 可能把首路由部分文本与后续路由结果拼接，并漏记失败尝试用量。 | 后续优先候选 |
| P1/P2 | `conversations.generating` 并发误清 | `api/chat/route.ts:314-315,559-563` 每个请求独立写 true/false；同会话并发时先结束者可清除仍运行状态。 | 后续候选 |
| P2 | 后台 consumer 吞异常 | `rag/process.ts:106-113`、`memory/extract.ts:41-50`、`conversation-title/service.ts:93-104` 正常返回失败，worker 会确认任务且不触发 pg-boss 重试。 | 需先统一可重试错误策略 |
| P2 | 非流式生成丢失推理档位翻译 | `stream.ts:641-656` 未像流式路径 `:472-510` 一样传递 reasoning/providerOptions。 | 边界清晰，后续候选 |
| P2 | 文件与外部资源边界 | 未发现确定的跨用户读取、SSRF 或软删除泄露；私有 S3 Range 重定向和多模态全量读取为条件性风险。 | 不进入本轮 |

## 选中问题的确定证据

1. `.trellis/spec/backend/gateway-routing.md` 与统一资源模型设计明确规定 Provider 无公开可见性，仅 owner 可查看和管理。
2. `admin/actions.ts:505-516` 的公共路由管理列表返回完整 route，其他管理员可合法获得 foreign `providerId`。
3. `createModel` 仅按 Provider ID 查询；`createRoute` 和 `updateRoute` 不查询 Provider 属主，均可建立 foreign Provider 关联。
4. `attachProviderModelRoute:586-621` 已使用 `providerId + ownerUserId`，证明同类入口的预期行为是 owner-only。
5. `testRoute:438-465` 未调用 `assertRouteManageable`，知道私有路由 ID 的管理员可以使服务端读取加密密钥并发起探测。
6. 运行时故意不检查 Provider 与模型的同一 owner，因为合法公共模型允许跨 owner 关联；因此不能依赖消费侧拦截，必须在创建/修改关联时授权调用者提交的 Provider。

## 选择依据

该问题跨越明确的私有资源边界，客户端输入可直接触发，后果包括使用他人的上游凭据、产生费用和扰动熔断状态。修复只需收紧既有 Server Action 授权并补测试，无 schema、协议或产品语义变化，风险与回滚面均小于其他候选，因此本轮优先处理。
