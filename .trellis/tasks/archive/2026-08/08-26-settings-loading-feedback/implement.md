# 实施计划

1. 路由加载反馈
   - 删除 `(dash)/template.tsx`，新增 `(dash)/loading.tsx`，并由 `panel` / `admin` 子段复用，确保 fallback 直接包住目标页面。
   - 验证：点击长期记忆时旧页面立即被骨架替换；内容返回后无额外淡入等待；reduced-motion 下无脉冲。

2. 指令卡精简
   - 移除 Markdown 正文和 import，整理标题、触发词、描述、使用次数与动作层级。
   - 验证：桌面和 390px 无溢出，CRUD 入口保持，axe 无新增违规。

3. 返回聊天自主提示
   - 新增一个横向双次轻推动画，移动/桌面箭头用 wrapper 接入；保留 hover/focus/active。
   - 同步 `DESIGN.md` 的 Motion Vocabulary 与有限例外。
   - 验证：无 hover 可观察，键盘焦点仍增强，reduced-motion 时停止。

4. 质量检查
   - 运行 Web lint、typecheck 和相关/完整 Vitest。
   - 浏览器复测长期记忆首次/再次导航时间、加载 fallback、桌面、390px、键盘、reduced-motion 与 a11y。

## Rollback Points

- `loading.tsx` / `template.tsx` 可整体回滚，不影响页面数据。
- 指令卡只改展示 JSX，可独立回滚。
- 返回提示由 CSS keyframe + 两处 wrapper 组成，可整体删除。
