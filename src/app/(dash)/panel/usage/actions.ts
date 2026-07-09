"use server";
/**
 * 用量页 typeahead 搜索 action(panel)。
 *
 * userId 强制为当前用户(数据隔离)。panel 不渲染用户 Combobox(固定自己),
 * 故 opts.type 实际不会是 users。鉴权失败返回空。
 */
import { getSession } from "@/lib/session";
import {
  searchUsageCandidates,
  type SearchUsageCandidatesOpts,
  type UsageCandidate,
} from "@/lib/usage-aggregate";
import {
  searchErrorCandidates,
  type SearchErrorCandidatesOpts,
  type ErrorCandidate,
} from "@/lib/repositories/error-log-repository";

/** 用量明细 typeahead 候选(panel,userId 强制自己)。 */
export async function searchPanelUsageCandidatesAction(
  opts: SearchUsageCandidatesOpts,
): Promise<UsageCandidate[]> {
  const s = await getSession();
  if (!s) return [];
  return searchUsageCandidates({ ...opts, userId: s.id });
}

/** 错误请求 typeahead 候选(panel,userId 强制自己)。 */
export async function searchPanelErrorCandidatesAction(
  opts: SearchErrorCandidatesOpts,
): Promise<ErrorCandidate[]> {
  const s = await getSession();
  if (!s) return [];
  return searchErrorCandidates({ ...opts, userId: s.id });
}
