# 上游模型列表拉取加固实施计划

## Step 1: Lock Failing Cases

- 在 `probe.test.ts` 增加受控流、重定向链和模型数量用例。
- 先确认新增用例因当前 `Response.json()` 与自动重定向行为失败。

Verify:

```bash
pnpm --filter @nekusora/core exec vitest run src/lib/providers/probe.test.ts
```

## Step 2: Harden Shared Fetch

- 在 `fetchUpstreamModels` 内加入 5 次同 origin 手动重定向。
- 只把单个十进制非负整数 `Content-Length` 用于快速拒绝；其他形式忽略并流式累计实际字节到 4 MiB。
- 受限读取完成后解析 JSON；复用现有协议分支。
- 清理模型 ID，并在第 2001 个有效唯一 ID 时失败。

Verify: 重跑 `probe.test.ts`，确认正常 Provider 与现有 timeout 用例不回归。

## Step 3: Review Callers And Cache

- 定位 admin/panel 调用，确认没有绕过共享函数。
- 以失败 fixture 验证缓存写入 helper 未被调用，旧缓存保持。
- 检查错误文本中无 key、query 和认证头 sentinel。

## Step 4: Quality Gate

```bash
pnpm --filter @nekusora/core typecheck
pnpm --filter @nekusora/core exec vitest run src/lib/providers/probe.test.ts
git diff --check
```

独立复核重定向次数、origin 比较、reader 取消、timeout 清理和边界值。

## Rollback Point

`probe.ts` 与 `probe.test.ts` 可整体回滚；无持久格式或调用方迁移。
