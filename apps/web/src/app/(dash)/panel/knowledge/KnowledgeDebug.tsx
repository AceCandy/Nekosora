"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Search, Loader2 } from "lucide-react";

interface Chunk {
  fileId: string;
  filename: string;
  chunkIndex: number;
  content: string;
  similarity: number;
}

/** 检索调试:输入 query,在用户全部知识库下查看召回块。 */
export default function KnowledgeDebug({ kbIds }: { kbIds: string[] }) {
  const t = useTranslations("panel.knowledge");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [status, setStatus] = useState<string>("");

  const handleSearch = async () => {
    if (!query.trim() || kbIds.length === 0) return;
    setLoading(true);
    setChunks([]);
    try {
      const res = await fetch("/api/knowledge/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim(), kbIds }),
      });
      const data = await res.json();
      setChunks(data.chunks ?? []);
      setStatus(data.status ?? "");
    } catch {
      setStatus("error");
    } finally {
      setLoading(false);
    }
  };

  if (kbIds.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="text-ui-caption font-semibold uppercase tracking-wider text-neutral-400">{t("debugTitle")}</div>
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder={t("debugPlaceholder")}
          className="flex-1 rounded-md border border-neutral-200 dark:border-neutral-800 bg-transparent px-3 py-2 text-ui-body focus:outline-none focus:border-sora-blue"
        />
        <button
          onClick={handleSearch}
          disabled={loading || !query.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-sora-blue hover:bg-sora-blue-hover text-white px-4 py-2 text-ui-body font-semibold disabled:opacity-40 cursor-pointer"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          <span>{t("search")}</span>
        </button>
      </div>

      {status && (
        <div className="text-ui-caption text-neutral-400 font-mono">
          {t("debugStatus")}: {status} · {chunks.length} {t("chunks")}
        </div>
      )}

      <div className="space-y-2">
        {chunks.map((c, i) => (
          <div key={i} className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0d0f14] p-3">
            <div className="flex items-center justify-between text-ui-caption text-neutral-400 mb-1.5 font-mono">
              <span className="truncate">{c.filename} #{c.chunkIndex}</span>
              <span className="text-sora-blue shrink-0 ml-2">{(c.similarity * 100).toFixed(0)}%</span>
            </div>
            <p className="text-ui-caption text-neutral-600 dark:text-neutral-400 line-clamp-4">{c.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
