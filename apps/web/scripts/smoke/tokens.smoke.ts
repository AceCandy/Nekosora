import assert from "node:assert";
import { estimateTokens, estimateMessagesTokens, trimToTokenBudget } from "@/lib/tokens";

function run() {
  // CJK 估算:中文每字约 1.33 token(2/3)
  const zh = estimateTokens("你好世界测试"); // 6 字 → ceil(6*2/3)=4
  assert.ok(zh >= 4 && zh <= 5, `中文估算应≈4,实际 ${zh}`);
  console.log("✓ 中文 token 估算:", zh, "(6字)");

  // 英文:每 4 字符约 1 token
  const en = estimateTokens("hello world"); // 11 字符 → ceil(11/4)=3
  assert.ok(en >= 2 && en <= 4, `英文估算应≈3,实际 ${en}`);
  console.log("✓ 英文 token 估算:", en, "(11字符)");

  // 消息列表
  const msgs = [
    { role: "system", content: "你是助手" },
    { role: "user", content: "你好" },
    { role: "assistant", content: "你好!有什么可以帮你?" },
  ];
  const total = estimateMessagesTokens(msgs);
  assert.ok(total > 0);
  console.log("✓ 消息列表估算:", total);

  // 裁剪:预算极小时只保留 system + recent
  const long = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `消息${i}` }));
  const trimmed = trimToTokenBudget(long, 30, 4);
  assert.ok(trimmed.length < long.length, "应裁剪掉部分消息");
  assert.ok(trimmed.length >= 4, "至少保留 recent 4 条");
  console.log("✓ 上下文裁剪:", long.length, "→", trimmed.length);

  console.log("\n全部通过 ✅");
}
run();
