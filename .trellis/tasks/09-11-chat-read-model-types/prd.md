# 收敛聊天页面与分享数据类型

## Goal
恢复服务查询类型并统一聊天选项映射，降低真实维护风险。

## Requirements
恢复 output-modes/render-styles 与分享读取的 Database/Schema 类型；收敛两个聊天页面重复选项投影，避免宽泛 Record 与整体强转丢失约束。只改数据契约，不改 UI、缓存与错误降级。

## Evidence
apps/web/src/features/chat/actions/share.ts:91,162；apps/web/src/lib/render-styles/service.ts:35,67；apps/web/src/lib/output-modes/service.ts:24；apps/web/src/app/chat/page.tsx:29；apps/web/src/app/chat/[id]/page.tsx:44

## Acceptance Criteria
- [x] 服务输出与页面消费受静态类型约束；新会话/历史会话选项映射一致；快照/实时/旧分享、密码/过期/版本选择测试通过；公开输出不增加私密字段。
- [x] 实现后独立审阅 diff，记录已验证与未验证项。

## Out of Scope
不改变业务策略，不升级依赖，不删除正常兼容路径。用户已于 2026-09-11 确认父任务最终规划并批准执行。
