# strip-conversation-images

> English · [中文](README.md)

Remove image blocks from Claude Code conversation history — keeping the text context intact so sessions can be resumed after switching to a model that doesn't support image/vision (e.g. the GLM series).

## Why

Claude Code stores sessions as JSONL under `~/.claude/projects/<encoded-project>/*.jsonl`. When you use the **Read** tool on an image (PNG screenshot, etc.) the message gets an `image` block. If you then switch to a **non-multimodal** model, resuming that session fails — the API rejects the image and the conversation can't continue.

This tool recursively replaces every `image` block in the session JSON with a short text placeholder, **preserving the full text conversation**, so the session resumes cleanly. Original files are backed up automatically (backup names don't end in `.jsonl`, so Claude Code won't scan them as sessions).

## When to use

- Resuming a session errors with "model does not support images / image / vision"
- You switched to a non-multimodal model (GLM, etc.) and can't restore old sessions
- A session file is huge from base64 image data and loads slowly

**Not for:** keeping images for a multimodal model to see — after stripping, the AI can't see the original image, but the text context is intact and you can always Read it again.

## Requirements

- Python 3.10+ (uses `str | None` union syntax)
- Standard library only — no dependencies to install

## Usage

```bash
python strip_conversation_images.py                  # interactive: list current project's sessions, pick by number
python strip_conversation_images.py --list           # list only (marks image counts)
python strip_conversation_images.py --session <id>   # clean a specific session (id prefix)
python strip_conversation_images.py --all-images     # clean all sessions that contain images
python strip_conversation_images.py --dry-run --all-images  # preview, no writes
python strip_conversation_images.py --all-projects --list   # list across all projects
python strip_conversation_images.py --project <path|encoded-name|dir> --list
```

The `#` column is the index for interactive selection; a non-`-` value in the `img` column means the session contains images:

```
 #  修改时间             大小  图片    行数  会话ID
--------------------------------------------------------------------------------
 0  2026-07-12 23:00     3.6M    13    1424  db63f078-a73d-465a-8bb3-8ecd8a6c65a3
 1  2026-07-12 11:13      38K     -      12  731b145a-6e0b-4c68-8041-17dc97954243
--------------------------------------------------------------------------------
共 2 个会话，其中 1 个含图片
```

After cleaning, resume with `claude --resume <session-id>`.

## What it does

For each session file that contains images:

1. **Backs up** the original to `<name>.jsonl.backup-<timestamp>` (the non-`.jsonl` suffix means Claude Code won't pick it up as a session).
2. Parses each line as JSON and recursively replaces two image-block formats:
   - `{"type":"image","source":{"base64":...}}` in `message.content` → `{"type":"text","text":"[image content removed…]"}` (valid Anthropic API shape)
   - `{"type":"image","file":{"base64":...}}` in `toolUseResult` → a string placeholder
3. Lines that fail to parse as JSON are kept verbatim; line count is unchanged; files are written with LF newlines.

The `img` count in `--list` is a fast string-scan approximation (may false-positive on text that literally contains `"type":"image"`, e.g. code discussions). The authoritative count is `清理图片块: N` reported during cleaning, which is structural and exact.

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| Still can't resume after cleaning | Probably a different session — run `--all-projects --list` to find all sessions with images |
| `未找到匹配的会话` (no matching session) | The `--session` prefix isn't unique or doesn't exist — run `--list` first to see the ids |
| `--list` shows an image count but cleaning reports 0 | The string scan false-positived on text containing `"type":"image"` — trust the cleaning-time count |
| Want to undo | Copy the backup `<name>.jsonl.backup-<ts>` back over the original filename |

## Tests

```bash
python test_strip.py   # 22 unittest cases (standard library, no pytest needed)
```

Covers: image-block detection, nested replacement, `toolUseResult` handling, file-level backup / dry-run / bad-line preservation / line-count invariance, and project-path encoding.

## Implementation notes

- Backup names **must not** end in `.jsonl`, or Claude Code will scan them as sessions.
- Writes must use LF (`newline="\n"`); on Windows the default would translate to CRLF.
- An image block in `message.content` is downgraded to a `text` block (valid Anthropic API) — the whole `content` entry is never deleted.

## License

MIT.
