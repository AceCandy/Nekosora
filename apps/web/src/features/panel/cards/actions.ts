"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { cacheWrap, cacheDel } from "@/lib/infra/cache";
import {
  listCards,
  createCard,
  updateCard,
  deleteCard,
  type InstructionCard,
} from "@/lib/instruction-cards/service";

/**
 * 指令卡管理 server actions(供 /panel/cards 调用)。
 *
 * 所有 action 都 requireSession 获取 userId,转交 service 层。
 * 成功后 revalidatePath 刷新面板列表。
 */

/** 当前用户指令卡列表的缓存键(per-user;用户写操作主动失效,TTL 兜底)。 */
const cardsKey = (userId: string) => `chat:cards:${userId}`;

export async function listMyCards(): Promise<InstructionCard[]> {
  const user = await requireSession();
  return cacheWrap(cardsKey(user.id), () => listCards(user.id));
}

export async function createMyCard(input: {
  trigger: string;
  title: string;
  description?: string;
  markdown: string;
}): Promise<InstructionCard> {
  const user = await requireSession();
  const card = await createCard(user.id, input);
  await cacheDel(cardsKey(user.id)).catch(() => {});
  revalidatePath("/panel/cards");
  return card;
}

export async function updateMyCard(
  id: string,
  patch: Partial<
    Pick<InstructionCard, "trigger" | "title" | "description" | "markdown" | "enabled" | "sortOrder">
  >,
): Promise<InstructionCard> {
  const user = await requireSession();
  const card = await updateCard(user.id, id, patch);
  await cacheDel(cardsKey(user.id)).catch(() => {});
  revalidatePath("/panel/cards");
  return card;
}

export async function deleteMyCard(id: string): Promise<void> {
  const user = await requireSession();
  await deleteCard(user.id, id);
  await cacheDel(cardsKey(user.id)).catch(() => {});
  revalidatePath("/panel/cards");
}
