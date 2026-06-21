"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import {
  listCards,
  createCard,
  updateCard,
  deleteCard,
  type InstructionCard,
  type CardScope,
} from "@/lib/instruction-cards/service";

/**
 * 指令卡管理 server actions(供 /panel/cards 调用)。
 *
 * 所有 action 都 requireSession 获取 userId,转交 service 层。
 * 成功后 revalidatePath 刷新面板列表。
 */

export async function listMyCards(): Promise<InstructionCard[]> {
  const user = await requireSession();
  return listCards(user.id);
}

export async function createMyCard(input: {
  scope: Exclude<CardScope, "builtin">;
  trigger: string;
  title: string;
  description?: string;
  markdown: string;
}): Promise<InstructionCard> {
  const user = await requireSession();
  const card = await createCard(user.id, input);
  revalidatePath("/panel/cards");
  return card;
}

export async function updateMyCard(
  id: string,
  patch: Partial<
    Pick<InstructionCard, "trigger" | "title" | "description" | "markdown" | "scope" | "enabled" | "sortOrder">
  >,
): Promise<InstructionCard> {
  const user = await requireSession();
  const card = await updateCard(user.id, id, patch);
  revalidatePath("/panel/cards");
  return card;
}

export async function deleteMyCard(id: string): Promise<void> {
  const user = await requireSession();
  await deleteCard(user.id, id);
  revalidatePath("/panel/cards");
}
