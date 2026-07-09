<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

# CodeGraph
本项目已初始化 CodeGraph。分析代码结构、调用链、影响范围、模块关系时，优先使用 CodeGraph MCP 工具。

优先顺序：
1. 先用 `codegraph_explore` 理解相关功能、符号和调用链。
2. CodeGraph 结果不足时，再用 `rg` 精确搜索。
3. 不要对整个 `node_modules`、`dist`、`build` 目录做全量递归 grep。

## 补充逻辑
- 日常不需要扫描docs/cankao这个目录下的代码,这里面是参考的开源项目
- 如果涉及到用户要求参考对应项目的逻辑的时候,优先看这个文件下的项目代码


## Design Context

本项目 **Nekusora (星枢)** 是一套融合了聊天工作台与高可用 API 模型网关的混合型全栈平台。
我们遵循以下设计与品牌原则，所有 AI 助手在为此项目编写/修改前端代码时必须严格遵守：

- **设计主线 (Creative North Star)**: 「星枢天流 (The Astral Skyline)」。
- **风格 register**: `product`（设计服务于任务与效率）。
- **色彩策略 (Color Strategy)**: 「暮色微澜黑与星云纯白」。背景带有极细微的冷调倾向（天空蓝/紫），绝对不使用公式化的奶油色/暖沙色。
- **设计原则 (Design Principles)**:
  1. **天空般的开阔与治愈** (聊天界面追求大呼吸感与纯文字排版)。
  2. **温和对话与精密控制的双面平衡** (聊天侧温和治愈，管理网关侧莫兰迪灰调严谨专业)。
  3. **克制与纯粹** (严禁侧边彩色粗条、Eyebrow 眉标等 AI 模板痕迹，静止状态无投影)。
- **设计规范**: 详细设计参数与约定见根目录 [DESIGN.md](file:///Users/mac/Documents/workspace/test/Nekusora/DESIGN.md)。

