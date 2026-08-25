# 完整设置中心实施计划

## 1. 共享导航与搜索

- [ ] 扩展 `nav-config.ts` 的导航元数据，加入主页面关键词与稳定的主要设置目标；继续由 role 过滤后的 groups 控制可见范围。
- [ ] 将 `/admin/settings` 现有搜索逻辑迁移为 `SidebarNav` 内的常规导航过滤结果，复用现有 Link、图标、分组和移动抽屉。
- [ ] 补中英文搜索占位、结果归属、无结果及主要设置项文案。
- [ ] 新增最小测试，覆盖个人/管理员结果、页面/字段匹配、空查询与无结果。
- [ ] 验证：定向 vitest + 键盘 Tab/Enter/Escape；普通用户结果中不存在 `/admin/*`。

## 2. 共享页面骨架

- [ ] 逐个核对十个目标页面的外层容器，只统一页头间距、`min-w-0` / `min-h-0` 和明确存在的页面级溢出。
- [ ] 保留现有 `PageHeader`、Manager、筛选和 Server Action；不新增通用 PageFrame。
- [x] 统一服务商、模型、账号、输出模式与输出样式的状态开关，并移除重复启停动作或空余操作列。
- [ ] 验证：页面 diff 中每一处变更都能对应共享节奏或响应式问题；无业务组件重写。

### 2.1 指令卡用户归属

- [x] 删除指令卡 `scope` 类型、服务分支、Action 入参和前端范围控件；所有读写按当前用户隔离。
- [x] 新增 PostgreSQL 迁移：删除无属主旧卡、移除 scope 索引和列、将 user_id 设为非空，并同步 Drizzle journal/snapshot。
- [x] 补服务权限与迁移产物测试，验证他人卡不能被列表或聊天 ID 查询读取。

## 3. 系统设置信息架构

- [ ] 从 `SettingsTabs` 删除内容区搜索和相关客户端状态，只保留系统设置领域导航。
- [ ] 解析 `tab/view/range`，保留旧 tab alias 与字段锚点。
- [ ] 输出体验增加 modes/styles URL 子视图并一次只渲染一个 Section。
- [x] 移除输出样式列表上方的常驻预览，改为行内小眼睛触发预览 Modal。
- [ ] 流量治理增加 policy/history URL 子视图；非历史视图不查询历史分析数据。
- [ ] 模型配置用可见分组明确 Embedding 与后台任务模型；网关协议保持单工作区。
- [ ] 更新搜索目标 href 与 `SettingsTabs` 测试。
- [ ] 验证：所有旧 URL 映射、浏览器前进后退、直接深链和移动 select。

## 4. 草稿发布体验

- [ ] 调整 `SettingsChangeControl`：常态只保留发布记录入口；有草稿时显示待发布状态条与审核/放弃动作。
- [ ] 移除常规界面的 `currentRevision` / `draftSummary` revision 文案，保留历史、回滚与冲突所需 revision。
- [ ] 将系统设置局部成功文案统一为“已保存到待发布草稿”，同步中英文。
- [ ] 保留审核/历史 Modal、差异分组、长值查看和 Modal 内错误反馈契约。
- [ ] 更新控制组件测试，验证空闲态、草稿态、发布审查、放弃、历史和冲突反馈。

## 5. 静态质量门

- [ ] 运行相关组件测试：

```bash
pnpm --filter @nekusora/web exec vitest run \
  'src/shared/components/SidebarNav.test.tsx' \
  'src/app/(dash)/admin/settings/SettingsTabs.test.tsx' \
  'src/app/(dash)/admin/settings/SettingsChangeControl.test.tsx' \
  'src/features/render-styles/RenderStylesManager.test.tsx'
```

- [ ] 运行 Web lint 与 typecheck：

```bash
pnpm --filter @nekusora/web lint
pnpm --filter @nekusora/web typecheck
```

- [ ] 运行中英文 key 对齐检查、Impeccable 静态检测与 diff 检查：

```bash
node .agents/skills/impeccable/scripts/detect.mjs --json \
  apps/web/src/shared/components \
  'apps/web/src/app/(dash)/panel' \
  'apps/web/src/app/(dash)/admin'
git diff --check
```

## 6. 浏览器验收

- [ ] 启动 Web 调试服务；若启动失败，保留不含敏感信息的原始错误。
- [ ] 普通用户：只看到 7 个个人入口，搜索无法发现管理员页面。
- [ ] 管理员：看到全部 10 个入口，页面/设置项搜索跳转正确。
- [ ] 320 / 390 / 768 / 1280px：移动抽屉、桌面展开/收起、表单、Manager、表格和发布状态无页面级横向溢出。
- [ ] 键盘：侧栏搜索、结果链接、系统 Tab/子视图、审核与历史 Modal 的焦点顺序和可见焦点正确。
- [ ] 系统设置：旧链接兼容，输出/治理一次只显示一个工作区，常态无 revision，有草稿时发布入口可持续访问。
- [ ] 调试结束前关闭服务并确认端口无残留。

## 7. 独立复核与回滚点

- [ ] 使用独立审查核对权限过滤、URL 兼容、表单草稿反馈、i18n、响应式与 orphan 清理。
- [ ] 若共享导航回归，先回滚导航元数据和 Sidebar 搜索；系统设置重排可保留。
- [ ] 若系统设置重排回归，恢复原 tab 渲染；不得回滚或修改底层 revision/发布服务。
- [ ] 最终确认未产生缓存、截图、临时导出、调试日志或敏感文件。
