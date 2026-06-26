import { redirect } from "next/navigation";

/**
 * /panel 默认入口:侧栏首项为「API 密钥管理」,直接重定向过去,
 * 避免裸访问 /panel 落到 Next.js not-found。
 */
export default function PanelIndexPage() {
  redirect("/panel/keys");
}
