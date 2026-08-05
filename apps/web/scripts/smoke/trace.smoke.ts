/**
 * process_trace 构造器冒烟测试 —— 验证 block 推断 + token 汇总。
 * 运行:pnpm tsx scripts/smoke/trace.smoke.ts
 */
import assert from "node:assert";
import { buildTrace } from "@/lib/trace";

function run() {
  // 1. 纯 system + user 消息 → 2 blocks
  const t1 = buildTrace([
    { role: "system", content: "你是助手" },
    { role: "user", content: "你好" },
  ]);
  assert.ok(t1.blocks!.length >= 2, `应有 ≥2 blocks,实际 ${t1.blocks!.length}`);
  assert.strictEqual(t1.sentMessageCount, 2);
  assert.ok((t1.totalTokenEstimate ?? 0) > 0);
  console.log("✓ 基础消息:", t1.blocks!.length, "blocks,", t1.totalTokenEstimate, "tokens");

  // 2. 带 slot 标记的 system → 推断 kind
  const t2 = buildTrace([
    {
      role: "system",
      content: "默认提示\n\n---\n\n[先前对话摘要]\n摘要内容\n\n---\n\n[用户偏好]\n用中文",
    },
    { role: "user", content: "问题" },
  ]);
  const kinds = t2.blocks!.map((b) => b.kind);
  assert.ok(kinds.includes("system"), "应含 system block");
  assert.ok(kinds.includes("compaction"), "应含 compaction block");
  assert.ok(kinds.includes("memory_preference"), "应含 memory_preference block");
  console.log("✓ slot 推断:", kinds.join(","));

  // 3. RAG 文件上下文标记
  const t3 = buildTrace([
    { role: "system", content: "以下是与当前问题相关的文件参考:\n文件内容" },
    { role: "user", content: "查文件" },
  ]);
  assert.ok(t3.blocks!.some((b) => b.kind === "file_context"), "应含 file_context block");
  console.log("✓ RAG 上下文推断: file_context");

  // 4. 空消息
  const t4 = buildTrace([]);
  assert.strictEqual(t4.blocks!.length, 0);
  assert.strictEqual(t4.sentMessageCount, 0);
  console.log("✓ 空消息处理");

  console.log("\n全部通过 ✅");
}

run();
