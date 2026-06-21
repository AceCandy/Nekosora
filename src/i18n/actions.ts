"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { locales, type Locale } from "@/i18n/request";

/**
 * 切换语言 —— 写入 locale cookie,触发全站 revalidate。
 *
 * cookie 被 middleware + i18n/request.ts 读取,决定渲染 locale。
 * revalidatePath("/", "layout") 确保所有布局层重新渲染。
 */
export async function setLocale(locale: Locale): Promise<void> {
  if (!locales.includes(locale)) return;
  const cookieStore = await cookies();
  cookieStore.set("locale", locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 年
    sameSite: "lax",
    httpOnly: false, // 允许客户端读取(可选)
  });
  revalidatePath("/", "layout");
}
