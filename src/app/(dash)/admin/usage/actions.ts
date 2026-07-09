"use server";
/**
 * 用量页 typeahead 搜索 action(admin)。
 *
 * Combobox 输入时调用,返回候选。鉴权失败返回空数组(不 redirect,
 * 避免 typeahead 频繁调用触发客户端跳转)。级联 filter(userId/providerName)由调用方注入。
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

/** 用量明细 typeahead 候选(admin,可跨用户)。 */
export async function searchUsageCandidatesAction(
  opts: SearchUsageCandidatesOpts,
): Promise<UsageCandidate[]> {
  const s = await getSession();
  if (!s || s.role !== "admin") return [];
  return searchUsageCandidates(opts);
}

/** 错误请求 typeahead 候选(admin,可跨用户)。 */
export async function searchErrorCandidatesAction(
  opts: SearchErrorCandidatesOpts,
): Promise<ErrorCandidate[]> {
  const s = await getSession();
  if (!s || s.role !== "admin") return [];
  return searchErrorCandidates(opts);
}
