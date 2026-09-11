# 收敛 HTTP 请求校验边界

## Goal
为 MCP、聊天与图像请求补结构校验和无副作用回归，降低真实维护风险。

## Requirements
解析 JSON 后先校验结构，再访问字段及进入 DB/上游流程。覆盖 MCP envelope/tools 参数、Chat 消息与标识字段、图像 model/prompt/n/size。保留合法客户端请求、鉴权及限流次序；不扩展完整 MCP 协议。

## Evidence
packages/core/src/http/v1/mcp.ts:74,80,103；packages/core/src/http/api/chat.ts:107,112,140；packages/core/src/http/api/image-generate.ts:25,29,44,54

## Acceptance Criteria
- [x] null、数组及错误字段类型产生可预期客户端错误，不进入业务数据库写入或上游请求；合法多模态/重试/编辑/续写保持通过；n 的合法整数仍按原 1–4 截断规则。
- [x] 实现后独立审阅 diff，记录已验证与未验证项。

## Out of Scope
不改变业务策略，不升级依赖，不删除正常兼容路径。用户已于 2026-09-11 确认父任务最终规划并批准执行。
