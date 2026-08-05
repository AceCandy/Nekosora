/**
 * CoveragePathHash —— 滚动 SHA-256,标识消息路径的唯一性。
 *
 * 借鉴 DEEIX-Chat 的核心设计:哈希覆盖 id:publicId:parentId:role,**不含内容**。
 * 这样:
 *   - 编辑/重发产生新分支 → 路径变 → 旧摘要自动失效
 *   - 同一路径的摘要可复用(幂等)
 *
 * 用途:context_snapshots.coverage_path_hash,校验快照是否覆盖当前分支前缀。
 */
import { createHash } from "node:crypto";

export interface HashableMessage {
  id: string;
  publicId: string;
  parentId: string | null;
  role: string;
}

/** 计算单条消息的路径段哈希(不含内容)。 */
function segmentHash(m: HashableMessage): string {
  const raw = `${m.id}:${m.publicId}:${m.parentId ?? ""}:${m.role}`;
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * 计算消息列表(路径)的 CoveragePathHash。
 * 滚动:hash = sha256(prevHash + segment),使任意位置变更都改变最终值。
 */
export function coveragePathHash(messages: HashableMessage[]): string {
  let acc = "";
  for (const m of messages) {
    acc = createHash("sha256").update(acc + segmentHash(m)).digest("hex");
  }
  return acc;
}

/**
 * 滚动扩展:已知前缀的 hash,追加新段后计算新 hash(无需重算整个前缀)。
 * 用于只加载部分消息窗口时仍能验证快照。
 */
export function extendCoveragePathHash(prevHash: string, segment: HashableMessage): string {
  return createHash("sha256").update(prevHash + segmentHash(segment)).digest("hex");
}
