# Chat 斜杠命令

## Goal

在输入框内输入 `/` 触发命令 popover，复用现有指令卡（instructionCard）体系，提供快捷指令插入。

## Requirements

- 输入框文本以 `/` 开头（或光标前是 `/` + 词）时弹出命令 popover
- popover 列出可用命令，支持模糊匹配过滤
- 键盘导航：↑↓ 选择、Enter 选中、Esc 关闭
- 选中命令后行为（design 阶段确认组合）：
  - 插入对应指令卡到 composer（等价于从指令卡 picker 选）
  - 或在输入框插入指令的预设文本模板
- 命令来源复用现有指令卡数据源，不重复维护
- `/` 后无词时显示全部；输入词时模糊过滤
- 普通文本输入（不以 / 开头）不触发

## Acceptance Criteria

- [ ] 输入 `/` 弹出命令列表
- [ ] 输入 `/翻` 能模糊匹配到相关指令
- [ ] 键盘 ↑↓ Enter Esc 行为正确
- [ ] 选中后指令卡正确挂到 composer 或模板插入输入框
- [ ] 不以 / 开头的输入不触发 popover
- [ ] 移动端可点击选择（不只键盘）

## Constraints

- 命令解析与过滤为纯函数，易单测
- popover 复用现有 Popover 组件，位置贴输入框上方
- 不破坏现有输入框行为（Enter 发送、Shift+Enter 换行、粘贴附件）

## Notes

- 参考 kivio `slashCommands.ts`（纯函数，可单测，三类合并）
- 参考 AMC-WebUI `SlashCommandMenu.tsx`
- 本任务 PRD-only 即可
