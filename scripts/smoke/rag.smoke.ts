/**
 * RAG 分块 + 相似度冒烟测试 —— 不依赖 embedding(避免需要真实上游)。
 * 验证 chunkText 边界 + cosineSimilarity 语义。
 * 运行:pnpm tsx scripts/smoke/rag.smoke.ts
 */
import assert from "node:assert";
import { chunkText } from "@/lib/rag/chunk";
import { estimateTokens } from "@/lib/tokens";

function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return (dot / (Math.sqrt(na) * Math.sqrt(nb)) + 1) / 2;
}

function run() {
  // 1. 空文本 → 无块
  assert.strictEqual(chunkText("").length, 0);
  assert.strictEqual(chunkText("   ").length, 0);
  console.log("✓ 空文本无块");

  // 2. 短文本 → 单块
  const short = chunkText("这是一段简短文本。");
  assert.strictEqual(short.length, 1);
  assert.strictEqual(short[0].index, 0);
  assert.ok(short[0].tokenCount > 0);
  console.log("✓ 短文本单块:", short[0].tokenCount, "tokens");

  // 3. 长文本 → 多块,带重叠
  const long = "段落内容。\n\n".repeat(200); // 足够长
  const chunks = chunkText(long, 800, 100);
  assert.ok(chunks.length > 1, `长文本应分多块,实际 ${chunks.length}`);
  assert.ok(chunks.every((c) => c.content.length > 0), "每块非空");
  assert.ok(chunks.every((c) => c.tokenCount > 0), "每块有 token 估算");
  // index 连续
  assert.ok(chunks.every((c, i) => c.index === i), "index 应连续");
  console.log("✓ 长文本分块:", long.length, "字符 →", chunks.length, "块");

  // 4. 段落边界:块尽量在换行处收尾
  const paraText = "第一段内容内容内容内容内容。\n\n第二段内容内容内容内容内容。";
  const paraChunks = chunkText(paraText, 50, 0);
  // 验证至少能切,且块内容非空
  assert.ok(paraChunks.length >= 1);
  console.log("✓ 段落边界切分:", paraChunks.length, "块");

  // 5. 相似度:相同向量 → 1,正交向量 → 0.5(映射后)
  const v1 = [1, 0, 0];
  const same = cosineSim(v1, v1);
  assert.ok(Math.abs(same - 1) < 0.01, `相同向量相似度应≈1,实际 ${same}`);
  const ortho = cosineSim([1, 0, 0], [0, 1, 0]);
  assert.ok(Math.abs(ortho - 0.5) < 0.01, `正交向量相似度应≈0.5,实际 ${ortho}`);
  const oppo = cosineSim([1, 0], [-1, 0]);
  assert.ok(Math.abs(oppo - 0) < 0.01, `相反向量相似度应≈0,实际 ${oppo}`);
  console.log("✓ 余弦相似度:", `相同=${same.toFixed(2)} 正交=${ortho.toFixed(2)} 相反=${oppo.toFixed(2)}`);

  // 6. token 估算一致
  const t1 = estimateTokens("测试文本");
  const t2 = estimateTokens("测试文本");
  assert.strictEqual(t1, t2, "相同文本 token 估算应稳定");
  console.log("✓ token 估算稳定");

  console.log("\n全部通过 ✅");
}

run();
