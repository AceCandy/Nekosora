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

## 补充逻辑
- 日常不需要扫描docs/cankao这个目录下的代码,这里面是参考的开源项目
- 如果涉及到用户要求参考对应项目的逻辑的时候,优先看这个文件下的项目代码
- 扫描代码的codeGraph使用参考 @CODEGRAPH.md
- 关于模型模版这块的缺失优先从https://pi.dev/models 这个网站进行拉取

## 模型目录维护
- `model_catalog` 是模型类型、能力、思考格式和档位映射的唯一事实来源；新增模型不得在前端或路由层另写一份能力判断。
- 只收录当前主流型号。模型 ID、别名、输入能力和推理能力优先核对官方资料；思考档位与兼容格式可参考 `docs/cankao/pi/packages/ai`，不能仅凭模型名或厂商猜测。
- 推理档位与 pi 对齐：`off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`。`thinkingLevelMap` 中 `null` 表示明确不支持，字符串表示供应商值，缺省表示使用该格式默认值；`xhigh` 和 `max` 只有显式配置才可用。
- `thinkingFormat` 描述模型官方请求语义，而不是 Provider URL：`openai`、`anthropic`、`anthropic-adaptive`、`google`、`openrouter`、`deepseek`、`together`、`zai`、`qwen`、`qwen-chat-template`、`agnes`、`string-thinking`、`ant-ling` 或 `fixed`。同一目录模型的多条上游路由必须使用相同模型语义。
- `reasoningEffort` 只在模型官方兼容接口确实接受独立强度字段时设为 `true`；仅支持启停的模型不能发送 `reasoning_effort`。
- `fixed` 用于支持推理但不公开强度控制的模型：只保留一个非 `off` 档位，Chat 显示固定开启且不可关闭，运行时不向上游伪造控制参数。
- Chat 必须从目录动态生成档位：不支持推理则隐藏；只支持开关则只显示 `off` 和唯一开启档；不能关闭则默认最低可用档；支持多少档就显示多少档。会话状态按具体 `modelId` 保存，不能保存成会话全局单值。
- 请求了已失效或不支持的档位时，按 pi 逻辑夹到最近可用档。默认优先 `off`，不支持 `off` 时选择最低可用档。
- 目录数据变更必须提供 PostgreSQL 迁移、同步 Drizzle journal/snapshot，并补模型匹配、档位与请求体翻译测试。

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
