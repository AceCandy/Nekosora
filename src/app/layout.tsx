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
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icon.svg" }],
    shortcut: [{ url: "/icon.svg" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfdff" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0f14" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

const themeScript = `
(() => {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const syncTheme = () => document.documentElement.classList.toggle("dark", query.matches);
  syncTheme();
  query.addEventListener("change", syncTheme);
})();`;

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
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
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
