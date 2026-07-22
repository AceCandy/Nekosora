# 服务商模型相似匹配与路由复用：实施计划

1. 在 `model-catalog.test.ts` 添加相似候选红灯用例，再在 `model-catalog.ts` 实现归一、评分、排除和 top-5 稳定排序。
   - 验证：`pnpm vitest run src/lib/model-catalog.test.ts`
2. 在 panel/admin actions 增加快速补路由 action，复用现有权限边界并在插入前按三字段判重。
   - 验证：补充 action 定向测试，覆盖 created、exists、模型越权、provider 越权。
3. 扩展两套 providers 页面数据映射，将轻量候选 DTO 和快速 action 传入共享 `ProvidersManager`。
   - 验证：TypeScript props 可序列化、admin/panel 候选范围与现有管理权限一致。
4. 在 `ProvidersManager` 实现点击状态机和候选/结果 Modal，保留现有新建 URL。
   - 验证：完全匹配两分支、候选选择两分支、无候选新建、pending 与键盘焦点路径。
5. 更新 `messages/zh-CN.json` 与 `messages/en.json`。
   - 验证：键集合对齐，无硬编码用户可见文案。
6. 运行定向测试、`pnpm check`、相关测试，再独立检查 `git diff`。
7. 启动本地服务，用浏览器在桌面与窄屏验证弹窗布局和交互；验证后关闭服务。

## 风险与回滚点

- 相似度阈值过宽会产生噪声候选：由纯函数测试锁定明确正反例，且候选永不自动写入。
- 页面数据增加：只传轻量 DTO，不传 Date 或数据库行对象。
- 服务端无唯一索引：action 二次判重并返回真实状态；跨事务极端并发仍作为已知剩余风险。
- 第 4 步前可单独回滚 UI 接线，不影响新增纯函数和 action。
