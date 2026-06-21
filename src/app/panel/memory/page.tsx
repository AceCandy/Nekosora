import { getMemories, addMemory, deleteMemory } from "@/lib/memory/service";
import { requireSession } from "@/lib/session";
import { Trash2, Plus, BrainCircuit } from "lucide-react";
import { clsx } from "clsx";

export default async function MemoryPage() {
  const user = await requireSession();
  const memories = await getMemories(user.id);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold mb-1 flex items-center gap-2">
          <BrainCircuit className="w-5 h-5 text-blue-500" />
          <span>长期记忆配置</span>
        </h1>
        <p className="text-sm text-neutral-500">
          跨会话存储的用户画像与系统偏好，模型生成回复时将自动读取该记忆注入上下文，提供更具个性化的治愈伴读体验。
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-10 gap-8 items-start">
        {/* Left Table (6 lg cols) */}
        <div className="lg:col-span-6 space-y-4">
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0d0f14] overflow-hidden transition-colors duration-150">
            <table className="w-full text-sm text-left">
              <thead className="bg-neutral-50/70 dark:bg-neutral-900/50 border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400 font-mono text-xs uppercase">
                <tr>
                  <th className="p-3.5 font-medium">分类范围</th>
                  <th className="p-3.5 font-medium">记忆详情</th>
                  <th className="p-3.5 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800/60">
                {memories.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-10 text-center text-xs text-neutral-400 dark:text-neutral-500">
                      暂无记忆，请在右侧表单添加第一条长期记忆。
                    </td>
                  </tr>
                )}
                {memories.map((m) => (
                  <tr
                    key={m.id}
                    className="hover:bg-neutral-50/50 dark:hover:bg-neutral-900/10 transition-colors"
                  >
                    <td className="p-3.5 whitespace-nowrap">
                      <span
                        className={clsx(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold border uppercase tracking-wider",
                          m.scope === "preference"
                            ? "bg-blue-500/[0.03] border-blue-500/20 text-blue-600 dark:text-blue-400"
                            : m.scope === "profile"
                            ? "bg-amber-500/[0.03] border-amber-500/20 text-amber-600 dark:text-amber-400"
                            : "bg-neutral-100 dark:bg-neutral-800 border-neutral-250 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400"
                        )}
                      >
                        {m.scope === "preference" ? "偏好 (Pref)" : m.scope === "profile" ? "画像 (Prof)" : "自定义"}
                      </span>
                    </td>
                    <td className="p-3.5 text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed max-w-[250px] break-words">
                      {m.content}
                    </td>
                    <td className="p-3.5 text-right">
                      <form action={deleteMemory.bind(null, user.id, m.id)} className="inline">
                        <button
                          type="submit"
                          className="inline-flex items-center justify-center p-2 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                          title="删除记忆"
                        >
                          <Trash2 size={15} />
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Form (4 lg cols) */}
        <div className="lg:col-span-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0d0f14] p-5 space-y-4">
          <div className="border-b border-neutral-100 dark:border-neutral-800/80 pb-3">
            <h3 className="text-sm font-bold text-neutral-800 dark:text-white flex items-center gap-1.5">
              <Plus className="w-4 h-4 text-blue-500" />
              <span>添加新记忆</span>
            </h3>
          </div>

          <form
            action={async (formData: FormData) => {
              "use server";
              await addMemory(
                user.id,
                formData.get("scope") as "preference" | "profile" | "custom",
                String(formData.get("content") ?? ""),
              );
            }}
            className="space-y-4"
          >
            <label className="block">
              <span className="block text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-1">
                记忆分类 (Scope)
              </span>
              <select
                name="scope"
                className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0f121a] px-3.5 py-2 text-sm focus:outline-none focus:border-blue-500 dark:focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 text-neutral-800 dark:text-neutral-200 transition-all duration-150"
              >
                <option value="preference">preference (用户偏好 - 注入偏好槽, 限400字)</option>
                <option value="profile">profile (用户画像 - 自动注入背景)</option>
                <option value="custom">custom (自定义标签 - 自由流式检索)</option>
              </select>
            </label>

            <label className="block">
              <span className="block text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-1">
                记忆内容 (Content)
              </span>
              <textarea
                name="content"
                required
                placeholder="例如: 我喜欢更简洁的回答，遇到长公式时请换行，交流时用中文回复。"
                rows={4}
                className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0f121a] px-3.5 py-2 text-sm focus:outline-none focus:border-blue-500 dark:focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 text-neutral-800 dark:text-neutral-200 transition-all duration-150 resize-none"
              />
            </label>

            <button
              type="submit"
              className="w-full rounded-md bg-neutral-900 dark:bg-white dark:text-black font-semibold text-white hover:bg-neutral-800 dark:hover:bg-neutral-100 py-2.5 text-xs transition-colors shadow-none flex items-center justify-center gap-1"
            >
              <Plus className="w-4 h-4" />
              <span>添加记忆条目</span>
            </button>
          </form>

          <div className="rounded p-3 bg-neutral-50 dark:bg-neutral-900/30 text-[10px] text-neutral-400 dark:text-neutral-500 leading-normal space-y-1">
            <p className="font-semibold text-neutral-500 dark:text-neutral-400">💡 写入指南：</p>
            <p>1. <strong>preference</strong>：适合存储模型语气风格、语言喜好等，系统会常驻注入上下文首位。</p>
            <p>2. <strong>profile / custom</strong>：适合记录工作岗位、技术栈背景、项目描述等个人画像信息。</p>
          </div>
        </div>
      </div>
    </div>
  );
}

