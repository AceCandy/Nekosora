# 执行清单

- [x] 用户确认最新父任务规划后激活本子任务；加载 trellis-before-dev 对应规范。
- [x] 读取即将修改的完整代码、调用方与已有测试，先建立针对性回归。
- [x] 按 design.md 最小实施，不合并无关重构。
- [x] 验证：node --test scripts/*.test.mjs；pnpm check；pnpm test；隔离本机 PostgreSQL 可用时 pnpm test:pg。
- [x] 使用 trellis-check，独立复核权限、返回字段与 diff。
- [x] 记录环境缺口、更新任务验收项。
- [x] 分批提交计划获确认，工作提交已完成；归档见任务状态。
