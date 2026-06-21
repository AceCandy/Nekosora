import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nekusora",
  description: "AI 聊天工作台 + OpenAI 兼容模型网关",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}{/* impeccable-live-start */}
<script async src="http://localhost:8400/live.js"></script>
{/* impeccable-live-end */}
</body>
    </html>
  );
}
