import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import RegisterSW from "./RegisterSW";
import ScrollActivity from "@/shared/components/ScrollActivity";
import { inter, jetbrainsMono, notoSansSC } from "@/shared/fonts";

export const metadata: Metadata = {
  title: "Nekusora · 星枢",
  description: "AI 聊天工作台 + OpenAI 兼容模型网关",
  applicationName: "Nekusora",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Nekusora",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { url: "/favicon.ico", type: "image/x-icon", sizes: "16x16 32x32 48x48" },
      { url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" },
    ],
    shortcut: [{ url: "/favicon.ico", type: "image/x-icon" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#fcfdff",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
        lang={locale}
        suppressHydrationWarning
        className={`${inter.variable} ${jetbrainsMono.variable} ${notoSansSC.variable}`}
      >
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
        <ScrollActivity />
        <RegisterSW />
      </body>
    </html>
  );
}
