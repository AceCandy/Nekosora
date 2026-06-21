import Link from "next/link";
import { requireSession } from "@/lib/session";
import { Plus, Key, Settings2 } from "lucide-react";

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSession();

  return (
    <div className="flex min-h-screen bg-[#fcfdff] text-[#0f121a] dark:bg-[#0d0f14] dark:text-[#f1f3f7] transition-colors duration-200">
      <aside className="w-60 border-r border-neutral-200 dark:border-neutral-800 p-4 flex flex-col justify-between shrink-0 bg-[#fcfdff] dark:bg-[#090b0e]">
        <div className="space-y-4">
          <div className="px-2 py-1">
            <Link href="/" className="font-bold text-lg tracking-tight text-neutral-900 dark:text-white block">
              Nekusora
            </Link>
            <div className="text-[10px] text-neutral-400 dark:text-neutral-500 font-mono mt-0.5 truncate">
              {user.email}
            </div>
          </div>
          
          <Link
            href="/chat"
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900 px-3 py-2 text-sm font-semibold text-neutral-700 dark:text-neutral-200 transition-all duration-150 ease-out"
          >
            <Plus className="w-4 h-4 text-blue-500" />
            <span>新会话</span>
          </Link>
        </div>

        <div className="pt-3 border-t border-neutral-200 dark:border-neutral-800 space-y-1.5">
          <Link
            href="/panel/keys"
            className="inline-flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 transition-all duration-150"
          >
            <Key className="w-3.5 h-3.5" />
            <span>API Keys 密钥管理</span>
          </Link>
          {user.role === "admin" && (
            <Link
              href="/admin"
              className="inline-flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 transition-all duration-150"
            >
              <Settings2 className="w-3.5 h-3.5" />
              <span>控制台管理后台</span>
            </Link>
          )}
        </div>
      </aside>
      <main className="flex-1 flex flex-col min-w-0">{children}</main>
    </div>
  );
}
