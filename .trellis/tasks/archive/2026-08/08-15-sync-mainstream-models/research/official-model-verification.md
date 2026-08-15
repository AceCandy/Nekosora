# 0015 新增模型官方核对

核对日期：2026-08-15。pi snapshot 只用于发现候选；以下字段决定 `0015_model_catalog_sync.sql` 最终保留的目录数据。

| 模型 | 官方来源与关键证据 | 迁移采用 | 未采用 |
| --- | --- | --- | --- |
| `gemini-3.7-flash` | [Google 模型页](https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash)：Model code `gemini-3.7-flash`；Inputs `Text, Image, Video, Audio, and PDF`；Input token limit `1,048,576`；Output token limit `65,536`；Thinking `low, medium, high`，minimal 不支持 | ID、名称、vision、context `1048576`、max output `65536`、Google thinking low/medium/high | 无 |
| `glm-5.3` | [Z.AI 模型页](https://docs.z.ai/guides/llm/glm-5.3)：Input/Output Modalities `Text`；Context Length `1M`；Maximum Output Tokens `128K`；页面与路径标识 GLM-5.3 | ID、名称、context `1000000`、max output `131072` | 页面未列完整 thinking 档位，迁移不写 reasoning bundle |
| `grok-4.6` | [xAI 模型目录](https://docs.x.ai/developers/models) 的公开模型对象：`name: grok-4.6`；input `TEXT, IMAGE`；`maxPromptLength: 500000`；reasoning efforts `low, medium, high, xhigh` | ID、名称、vision、context `500000` | `maxPromptLength` 不是最大输出；请求格式未核实，因此不写 max output 或 reasoning bundle |
| `qwen3.8-max` | [阿里云百炼模型列表](https://help.aliyun.com/zh/model-studio/models)：明确列出模型 ID `qwen3.8-max` | ID、名称 | 官方列表未提供输入模态、reasoning、context 或 max output，迁移不写这些字段 |

`zai/glm-5.2-highspeed` 在 Z.AI 模型页、导航和发布资料中均未找到官方型号依据，并且属于 highspeed 专项变体，因此未收录。

四条新增均使用已确认的业务默认 `enabled=true`、`tools=true`、`systemPrompt=true`；不自动创建 Provider、模型实例或 route。
