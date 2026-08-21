# 实施计划

1. 删除数据库当前 schema 中两项能力的表/字段，生成 `0001` 前向迁移并加入 `composer_state - 'kbIds'` 数据清理。
   - 验证：SQL 仅删除目标对象；journal 新增一条；新 snapshot 不含目标结构且 `prevId` 指向 `0000`。
   - 回滚点：迁移生成物与 schema 可作为一个独立 diff 回退；不得修改 `0000`。
2. 删除模板与知识库专属 core/web 文件、种子脚本、路由和导出。
   - 验证：专属模块无入口；contracts、gateway、Web route 一致移除 `/api/knowledge/search`。
3. 从 Chat API、orchestrator、Chat 页面、Composer、store/runtime 和会话持久化中删除相关字段与分支。
   - 验证：`templateId`、`templateVars`、`knowledgeBaseIds`、`kbIds` 不再进入运行时；指令卡与附件链保留。
4. 清理导航、文案、配置 alias、无用导入及相关测试，并将保留测试改为六类 Composer 选择。
   - 验证：目标专属路径/符号的 `rg` 结果只允许出现在历史迁移与本任务文档；无无效模块映射。
5. 更新 `.trellis/spec/frontend/state-management.md` 与 `.trellis/spec/backend/chat-generation-params.md` 的 Composer 契约。
   - 验证：规范不再要求 `kbIds`，仍保持完整快照/latest-only 约束。
6. 独立复核和质量门禁。
   - 定向测试：Composer state/组件、conversation actions、chat store、数据库 bootstrap 及受影响 core tests。
   - 静态检查：相关 workspace typecheck/lint，随后 `pnpm check`。
   - 全量测试：`pnpm test`；若环境依赖导致不能执行，记录具体未验证项。
   - 最终检查：`git diff --check`、`git status --short`、目标符号负向 `rg`、人工复核共享指令卡/附件代码。
