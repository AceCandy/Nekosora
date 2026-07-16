---
name: strip-conversation-images
description: 当 resume Claude Code 会话因含图片报错（切换到不支持图片识别的模型如 glm 系列）、或 Read 工具读过的截图/PNG 阻塞会话加载时使用。列出会话、选择并清除其中的 image block，保留文字上下文使会话可被 resume。
version: "1.0.0"
license: MIT
metadata:
  hermes:
    tags: [claude-code, session, images, maintenance]
---

# 清除会话历史中的图片

## 概述

Claude Code 会话存于 `~/.claude/projects/<项目编码>/*.jsonl`。Read 工具读图片（PNG 截图等）会在消息里留下 image block。切换到**不支持图片识别**的模型（如 glm 系列）后，resume 这些会话会因 API 拒绝图片而报错，无法继续之前的任务。

本工具递归把会话 JSON 里的 image block 替换为文本占位，**保留全部文字对话**，让会话能被 resume。原文件自动备份（备份名不以 `.jsonl` 结尾，不会被当成会话再次扫描）。

## 何时使用

- resume 会话报"模型不支持图片 / image / vision"相关错误
- 切换到 glm 等非多模态模型后无法恢复旧会话
- 会话文件因含大量 base64 图片数据过大、加载缓慢

**不适用**：想保留图片给支持多模态的模型看--清除后 AI 看不到原图，但对话上下文完整，必要时可重新 Read。

## 使用

> 脚本按**当前工作目录**定位项目会话（cwd 编码为 `~/.claude/projects/<编码>`）。务必在**项目根目录**执行，不要 `cd` 进 skill 子目录——否则 cwd 编码后对应的项目目录不存在，`--session` / 交互模式 / `--list` / `--all-images` 都会报"未找到匹配的会话"。

```bash
# 在项目根目录执行
PY=.claude/skills/strip-claude-code-conversation-images/strip_conversation_images.py

python $PY                              # 交互：列当前项目会话，选序号清理
python $PY --list                       # 仅列出当前项目会话（标记图片数）
python $PY --session <id>               # 清理指定会话（id 前缀）
python $PY --all-images                 # 清理当前项目所有含图片会话
python $PY --dry-run --all-images       # 预览不写
python $PY --all-projects --list        # 跨所有项目列出（不依赖 cwd）
python $PY --project=-vol1-1000-ssd-workai-Nekosora --list  # 指定项目：用编码名（以 - 开头需用 =）
```

输出示例（`#` 列是交互选择的序号；`图片` 列非 `-` 即含图片）：

```
 #  修改时间            大小    图片   行数  会话ID
--------------------------------------------------------------------------------
 0  2026-07-12 23:00  3.6M     13   1424  db63f078-a73d-465a-8bb3-8ecd8a6c65a3
 1  2026-07-12 11:13   38K      -     12  731b145a-6e0b-4c68-8041-17dc97954243
```

清理后用 `claude --resume <session-id>` 恢复。

## 它做了什么

对每个含图片会话文件：

1. **备份**原文件为 `<name>.jsonl.backup-<时间戳>`（不以 `.jsonl` 结尾，Claude Code 不会扫到）
2. 逐行解析 JSON，递归替换两种 image block：
   - `message.content` 里的 `{"type":"image","source":{"base64":...}}` → `{"type":"text","text":"[图片内容已移除…]"}`
   - `toolUseResult` 字段的 `{"type":"image","file":{"base64":...}}` → 字符串占位
3. 坏 JSON 行原样保留；行数不变；写回用 LF 换行
4. 复检：剩余 image block = 0、PNG/JPEG base64 头 = 0

## 常见错误

| 现象 | 原因 / 处理 |
|------|------------|
| 清理后仍 resume 失败 | 可能是别的会话；用 `--all-projects --list` 找全部含图片会话 |
| `未找到匹配的会话` | 多因在 skill 子目录执行（cwd 不是项目根）；回项目根再跑，或用 `--project=<编码名>` 指定。也可能是前缀不唯一/不存在，先 `--list` 看 id |
| 列表 `图片` 列有数但清理报 0 | 字符串扫描会误报文本里出现的 `"type":"image"`（如代码讨论）；以清理时的 `清理图片块: N` 为准 |
| 想还原 | 用备份 `<name>.jsonl.backup-<ts>` 覆盖回原文件名即可 |

## 测试

```bash
python .claude/skills/strip-claude-code-conversation-images/test_strip.py   # 22 项 unittest（标准库，无需 pytest）
```

覆盖：image block 识别、嵌套替换、toolUseResult 处理、文件级备份/dry-run/坏行保留/行数不变、项目路径编码。

## 实现要点

- 备份名**不能以 `.jsonl` 结尾**，否则 Claude Code 会把它当会话扫描
- 写回必须用 LF（`newline="\n"`），Windows 默认会转 CRLF
- `message.content` 里 image block 降级为 `text` block（Anthropic API 合法），不能删除整个 content 块
