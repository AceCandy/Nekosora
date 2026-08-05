/**
 * CoveragePathHash 冒烟测试 —— 验证滚动哈希的分支安全性。
 * 运行:pnpm tsx scripts/smoke/compact.smoke.ts
 */
import assert from "node:assert";
import { coveragePathHash, extendCoveragePathHash, type HashableMessage } from "@/lib/compact/coverage";

function mk(id: string, publicId: string, parentId: string | null, role: string): HashableMessage {
  return { id, publicId, parentId, role };
}

function run() {
  const a = mk("1", "p1", null, "user");
  const b = mk("2", "p2", "1", "assistant");
  const c = mk("3", "p3", "2", "user");

  // 1. 相同路径 → 相同哈希(确定性)
  const h1 = coveragePathHash([a, b, c]);
  const h2 = coveragePathHash([a, b, c]);
  assert.strictEqual(h1, h2, "相同路径哈希应一致");
  console.log("✓ 确定性:相同路径 → 相同哈希");

  // 2. 不同顺序 → 不同哈希
  const h3 = coveragePathHash([c, b, a]);
  assert.notStrictEqual(h1, h3, "不同顺序应不同哈希");
  console.log("✓ 顺序敏感:不同顺序 → 不同哈希");

  // 3. 前缀不同 → 不同(压缩安全性)
  const h4 = coveragePathHash([a, b]);
  assert.notStrictEqual(h1, h4, "不同长度前缀应不同哈希");
  console.log("✓ 前缀敏感:不同长度 → 不同哈希");

  // 4. 内容变更不影响(只看 id:publicId:parentId:role)
  //    模拟"编辑内容":同 id 但若 publicId 变了 → 哈希变(分支安全)
  const aEdited = mk("1", "p1-edited", null, "user"); // 编辑产生新 publicId
  const h5 = coveragePathHash([aEdited, b, c]);
  assert.notStrictEqual(h1, h5, "publicId 变更(编辑/重发)应使哈希失效");
  console.log("✓ 编辑安全:publicId 变更 → 旧快照失效");

  // 5. 滚动扩展一致:extendCoveragePathHash([a,b]) + c == coveragePathHash([a,b,c])
  const hPrefix = coveragePathHash([a, b]);
  const hExtended = extendCoveragePathHash(hPrefix, c);
  assert.strictEqual(h1, hExtended, "滚动扩展应等价于全量计算");
  console.log("✓ 滚动一致:extend([a,b], c) == hash([a,b,c])");

  // 6. parentId 变更(分支切换)→ 哈希变
  const cFork = mk("3", "p3", "different-parent", "user");
  const h6 = coveragePathHash([a, b, cFork]);
  assert.notStrictEqual(h1, h6, "parentId 变更(分支切换)应使哈希失效");
  console.log("✓ 分支安全:parentId 变更 → 哈希失效");

  // 7. 空列表
  assert.strictEqual(coveragePathHash([]), "", "空列表应返回空串");
  console.log("✓ 空列表处理");

  console.log("\n全部通过 ✅");
}

run();
